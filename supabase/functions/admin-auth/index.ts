/**
 * Admin Auth Edge Function — Quiz4Win
 *
 * POST  /admin/auth/signin                  — Admin sign in (API #58)
 * POST  /admin/auth/token                   — Admin token refresh (API #59)
 * POST  /admin/auth/signout                 — Admin sign out (API #60)
 * GET   /admin/auth/me                      — Get admin profile (API #61)
 * GET   /admin/auth/admins                  — List admin users (API #62)
 * POST  /admin/auth/admins                  — Create admin user (API #63)
 * PATCH /admin/auth/admins/:admin_id        — Update admin user (API #64)
 * GET   /admin/auth/admins/:admin_id        — Admin detail (row 167)
 * POST  /admin/auth/admins/:admin_id/reset-mfa       — Reset MFA (row 168)
 * POST  /admin/auth/admins/:admin_id/revoke-sessions — Force logout (row 169)
 *
 * Rule compliance: R-01, R-03, R-04
 */

import { handleCors } from "../_shared/cors.ts";
import { errorResponse, successResponse, sanitizeError } from "../_shared/errors.ts";
import { validateJWT, requireAdminRole } from "../_shared/auth.ts";
import { getAnonClient, getAdminClient } from "../_shared/supabase.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleCors();

  const url = new URL(req.url);
  const parts = url.pathname.replace(/^\/admin\/auth\/?/, "").split("/").filter(Boolean);
  const resource = parts[0] ?? "";
  const resourceId = parts[1] ?? null;

  const admin = getAdminClient();

  try {
    // POST /admin/auth/signin
    if (resource === "signin" && req.method === "POST") {
      const { email, password } = await req.json();
      if (!email || !password) return errorResponse("email and password are required", 400);

      const supabase = getAnonClient(req);
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) return errorResponse("invalid_credentials", 401);

      // Verify admin account exists and is active
      const { adminUser, error: adminErr } = await requireAdminRole(data.user.id);
      if (adminErr || !adminUser) return errorResponse(adminErr ?? "forbidden", 403);

      // Update last login
      await admin.from("admin_users").update({ last_login_at: new Date().toISOString() }).eq("id", data.user.id);

      return successResponse({
        access_token: data.session?.access_token,
        refresh_token: data.session?.refresh_token,
        expires_in: data.session?.expires_in ?? 3600,
        admin: { id: adminUser.id, name: adminUser.name, email: adminUser.email, role: adminUser.role },
      });
    }

    // POST /admin/auth/token
    if (resource === "token" && req.method === "POST") {
      const { refresh_token } = await req.json();
      if (!refresh_token) return errorResponse("refresh_token is required", 400);
      const supabase = getAnonClient(req);
      const { data, error } = await supabase.auth.refreshSession({ refresh_token });
      if (error) return errorResponse("token_invalid", 401);
      return successResponse({ access_token: data.session?.access_token, refresh_token: data.session?.refresh_token });
    }

    // POST /admin/auth/signout
    if (resource === "signout" && req.method === "POST") {
      const { user, error: authErr } = await validateJWT(req);
      if (authErr || !user) return errorResponse("unauthorized", 401);
      const supabase = getAnonClient(req);
      await supabase.auth.signOut();
      return successResponse({ message: "Signed out" });
    }

    // GET /admin/auth/me
    if (resource === "me" && req.method === "GET") {
      const { user, error: authErr } = await validateJWT(req);
      if (authErr || !user) return errorResponse("unauthorized", 401);
      const { adminUser, error: adminErr } = await requireAdminRole(user.id);
      if (adminErr || !adminUser) return errorResponse(adminErr ?? "forbidden", 403);
      return successResponse({ admin: adminUser });
    }

    // GET /admin/auth/admins — super_admin only
    if (resource === "admins" && !resourceId && req.method === "GET") {
      const { user, error: authErr } = await validateJWT(req);
      if (authErr || !user) return errorResponse("unauthorized", 401);
      const { adminUser, error: adminErr } = await requireAdminRole(user.id, ["super_admin"]);
      if (adminErr || !adminUser) return errorResponse(adminErr ?? "forbidden", 403);

      const { data, error } = await admin.from("admin_users")
        .select("id, name, email, role, status, mfa_enabled, created_at, last_login_at")
        .order("created_at", { ascending: false });
      if (error) return errorResponse("Failed to list admins", 500);
      return successResponse({ admins: data ?? [] });
    }

    // POST /admin/auth/admins — super_admin only
    if (resource === "admins" && !resourceId && req.method === "POST") {
      const { user, error: authErr } = await validateJWT(req);
      if (authErr || !user) return errorResponse("unauthorized", 401);
      const { adminUser, error: adminErr } = await requireAdminRole(user.id, ["super_admin"]);
      if (adminErr || !adminUser) return errorResponse(adminErr ?? "forbidden", 403);

      const { email, name, role, password } = await req.json();
      if (!email || !name || !role || !password) return errorResponse("email, name, role, and password are required", 400);

      const { data: newUser, error: createErr } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (createErr) return errorResponse(sanitizeError(createErr), 400);

      const { data: newAdmin, error: insertErr } = await admin.from("admin_users")
        .insert({ id: newUser.user.id, name, email, role, status: "active", mfa_enabled: false, created_at: new Date().toISOString() })
        .select("id, name, email, role, status")
        .single();
      if (insertErr) return errorResponse(sanitizeError(insertErr), 500);

      return successResponse({ admin: newAdmin }, 201);
    }

    const subAction = parts[2] ?? null;

    // GET /admin/auth/admins/:admin_id — detail (row 167)
    if (resource === "admins" && resourceId && !subAction && req.method === "GET") {
      const { user, error: authErr } = await validateJWT(req);
      if (authErr || !user) return errorResponse("unauthorized", 401);
      const { adminUser, error: adminErr } = await requireAdminRole(user.id, ["super_admin"]);
      if (adminErr || !adminUser) return errorResponse(adminErr ?? "forbidden", 403);

      const [profileRes, auditRes] = await Promise.all([
        admin.from("admin_users").select("id, name, email, role, status, mfa_enabled, created_at, last_login_at, updated_at").eq("id", resourceId).single(),
        admin.from("admin_audit_log").select("id, action, target_type, target_id, created_at").eq("admin_id", resourceId).order("created_at", { ascending: false }).limit(50),
      ]);
      if (profileRes.error || !profileRes.data) return errorResponse("admin_not_found", 404);
      return successResponse({ admin: profileRes.data, recent_activity: auditRes.data ?? [] });
    }

    // POST /admin/auth/admins/:admin_id/reset-mfa (row 168)
    if (resource === "admins" && resourceId && subAction === "reset-mfa" && req.method === "POST") {
      const { user, error: authErr } = await validateJWT(req);
      if (authErr || !user) return errorResponse("unauthorized", 401);
      const { adminUser, error: adminErr } = await requireAdminRole(user.id, ["super_admin"]);
      if (adminErr || !adminUser) return errorResponse(adminErr ?? "forbidden", 403);

      // Remove all MFA factors via auth admin API
      try {
        const factors = await admin.auth.admin.mfa.listFactors({ userId: resourceId });
        for (const f of (factors.data?.factors ?? [])) {
          await admin.auth.admin.mfa.deleteFactor({ userId: resourceId, id: f.id });
        }
      } catch (e) {
        console.error("[admin-auth] mfa factor cleanup failed:", e);
      }
      await admin.from("admin_users").update({ mfa_enabled: false, updated_at: new Date().toISOString() }).eq("id", resourceId);
      await admin.from("admin_audit_log").insert({ admin_id: user.id, action: "admin_mfa_reset", target_type: "admin_user", target_id: resourceId, created_at: new Date().toISOString() });
      return successResponse({ message: "MFA reset; admin must re-enroll on next login" });
    }

    // POST /admin/auth/admins/:admin_id/revoke-sessions (row 169)
    if (resource === "admins" && resourceId && subAction === "revoke-sessions" && req.method === "POST") {
      const { user, error: authErr } = await validateJWT(req);
      if (authErr || !user) return errorResponse("unauthorized", 401);
      const { adminUser, error: adminErr } = await requireAdminRole(user.id, ["super_admin"]);
      if (adminErr || !adminUser) return errorResponse(adminErr ?? "forbidden", 403);

      // Sign out the user from all sessions
      try {
        await admin.auth.admin.signOut(resourceId, "global");
      } catch (e) {
        console.error("[admin-auth] signOut failed:", e);
      }
      await admin.from("admin_audit_log").insert({ admin_id: user.id, action: "admin_sessions_revoked", target_type: "admin_user", target_id: resourceId, created_at: new Date().toISOString() });
      return successResponse({ message: "All sessions revoked" });
    }

    // PATCH /admin/auth/admins/:admin_id
    if (resource === "admins" && resourceId && req.method === "PATCH") {
      const { user, error: authErr } = await validateJWT(req);
      if (authErr || !user) return errorResponse("unauthorized", 401);
      const { adminUser, error: adminErr } = await requireAdminRole(user.id, ["super_admin"]);
      if (adminErr || !adminUser) return errorResponse(adminErr ?? "forbidden", 403);

      const body = await req.json();
      const allowed: Record<string, unknown> = {};
      if (body.name) allowed.name = body.name;
      if (body.role) allowed.role = body.role;
      if (body.status) allowed.status = body.status;

      const { data, error } = await admin.from("admin_users")
        .update({ ...allowed, updated_at: new Date().toISOString() })
        .eq("id", resourceId)
        .select("id, name, email, role, status")
        .single();
      if (error) return errorResponse(sanitizeError(error), 400);
      return successResponse({ admin: data });
    }

    return errorResponse("Not found", 404);
  } catch (err) {
    console.error("[admin-auth] unhandled error:", err);
    return errorResponse("Internal server error", 500);
  }
});
