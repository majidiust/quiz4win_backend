/**
 * Admin Users Edge Function — Quiz4Win
 *
 * GET   /admin/users                          — List users (API #72)
 * GET   /admin/users/:id                      — User detail (API #73)
 * PATCH /admin/users/:id/status               — Update status (API #74)
 * POST  /admin/users/:id/wallet/adjust        — Adjust wallet (API #75)
 * GET   /admin/users/:id/transactions         — User transactions (API #76)
 * GET   /admin/users/:id/games               — User game history (API #77)
 * POST  /admin/users/:id/notify               — Send notification (API #78)
 * GET   /admin/users/:id/kyc                  — KYC documents (API #79)
 * POST  /admin/users/:id/kyc/review           — Review KYC (API #80)
 * GET   /admin/users/export                    — Bulk user export CSV (row 106)
 *
 * Rule compliance: R-01, R-02, R-03, R-05
 */

import { handleCors } from "../_shared/cors.ts";
import { errorResponse, successResponse, sanitizeError } from "../_shared/errors.ts";
import { validateJWT, requireAdminRole } from "../_shared/auth.ts";
import { getAdminClient } from "../_shared/supabase.ts";
import { csvResponse, toCsv, todayStamp } from "../_shared/csv.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleCors();

  const url = new URL(req.url);
  const parts = url.pathname.replace(/^\/admin\/users\/?/, "").split("/").filter(Boolean);
  const userId = parts[0] ?? null;
  const action = parts[1] ?? null;
  const subAction = parts[2] ?? null;

  const { user: adminUserAuth, error: authErr } = await validateJWT(req);
  if (authErr || !adminUserAuth) return errorResponse("unauthorized", 401);
  const { error: adminErr } = await requireAdminRole(adminUserAuth.id, ["super_admin", "admin", "support", "finance"]);
  if (adminErr) return errorResponse(adminErr, 403);

  const admin = getAdminClient();

  try {
    // GET /admin/users/export — CSV (row 106)
    if (userId === "export" && !action && req.method === "GET") {
      const status = url.searchParams.get("status");
      const kyc = url.searchParams.get("kyc_status");
      const search = url.searchParams.get("q");
      let q = admin
        .from("profiles")
        .select("id, name, email, nationality, status, kyc_status, wallet_balance, created_at")
        .order("created_at", { ascending: false })
        .limit(10000);
      if (status) q = q.eq("status", status);
      if (kyc) q = q.eq("kyc_status", kyc);
      if (search) q = q.or(`name.ilike.%${search}%,email.ilike.%${search}%`);
      const { data, error } = await q;
      if (error) return errorResponse("Failed to export users", 500);
      const csv = toCsv(data ?? [], [
        { header: "id", value: (r) => r.id },
        { header: "name", value: (r) => r.name },
        { header: "email", value: (r) => r.email },
        { header: "nationality", value: (r) => r.nationality },
        { header: "status", value: (r) => r.status },
        { header: "kyc_status", value: (r) => r.kyc_status },
        { header: "wallet_balance_cents", value: (r) => r.wallet_balance ?? 0 },
        { header: "created_at", value: (r) => r.created_at },
      ]);
      await admin.from("admin_audit_log").insert({ admin_id: adminUserAuth.id, action: "users_exported", target_type: "users", details: { count: data?.length ?? 0, filters: { status, kyc, search } }, created_at: new Date().toISOString() });
      return csvResponse(csv, `users-${todayStamp()}.csv`);
    }

    // GET /admin/users
    if (!userId && req.method === "GET") {
      const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1"));
      const limit = Math.min(100, parseInt(url.searchParams.get("limit") ?? "20"));
      const search = url.searchParams.get("q");
      const status = url.searchParams.get("status");
      const kyc = url.searchParams.get("kyc_status");
      const offset = (page - 1) * limit;

      let query = admin
        .from("profiles")
        .select("id, name, email, status, kyc_status, wallet_balance, created_at", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);

      if (search) query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%`);
      if (status) query = query.eq("status", status);
      if (kyc) query = query.eq("kyc_status", kyc);

      const { data, error, count } = await query;
      if (error) return errorResponse("Failed to list users", 500);
      return successResponse({ users: data ?? [], pagination: { page, limit, total: count ?? 0, total_pages: Math.ceil((count ?? 0) / limit) } });
    }

    // GET /admin/users/:id
    if (userId && !action && req.method === "GET") {
      const { data, error } = await admin.from("profiles").select("*").eq("id", userId).single();
      if (error || !data) return errorResponse("user_not_found", 404);
      return successResponse({ user: data });
    }

    // PATCH /admin/users/:id/status
    if (userId && action === "status" && req.method === "PATCH") {
      const { status, reason } = await req.json();
      const valid = ["active", "suspended", "banned"];
      if (!status || !valid.includes(status)) return errorResponse(`status must be one of: ${valid.join(", ")}`, 400);

      const { data, error } = await admin.from("profiles").update({ status, updated_at: new Date().toISOString() }).eq("id", userId).select("id, status").single();
      if (error) return errorResponse(sanitizeError(error), 500);

      // Audit log
      await admin.from("admin_audit_log").insert({ admin_id: adminUserAuth.id, action: `user_status_changed_to_${status}`, target_type: "user", target_id: userId, details: { reason }, created_at: new Date().toISOString() });
      return successResponse({ user: data });
    }

    // POST /admin/users/:id/wallet/adjust
    if (userId && action === "wallet" && subAction === "adjust" && req.method === "POST") {
      const { amount_cents, type, reason } = await req.json();
      if (!amount_cents || !type || !reason) return errorResponse("amount_cents, type, and reason are required", 400);
      const validTypes = ["credit", "debit"];
      if (!validTypes.includes(type)) return errorResponse("type must be credit or debit", 400);

      await admin.rpc(type === "credit" ? "credit_wallet" : "debit_wallet", {
        p_user_id: userId,
        p_amount_cents: Math.abs(amount_cents),
        p_reference_id: `admin-${adminUserAuth.id}`,
        p_type: "admin_adjustment",
      });

      await admin.from("admin_audit_log").insert({ admin_id: adminUserAuth.id, action: `wallet_${type}`, target_type: "user", target_id: userId, details: { amount_cents, reason }, created_at: new Date().toISOString() });
      return successResponse({ message: `Wallet ${type} applied` });
    }

    // GET /admin/users/:id/transactions
    if (userId && action === "transactions" && req.method === "GET") {
      const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1"));
      const limit = Math.min(100, parseInt(url.searchParams.get("limit") ?? "20"));
      const offset = (page - 1) * limit;
      const { data, error, count } = await admin.from("transactions").select("*", { count: "exact" }).eq("user_id", userId).order("created_at", { ascending: false }).range(offset, offset + limit - 1);
      if (error) return errorResponse("Failed to fetch transactions", 500);
      return successResponse({ transactions: data ?? [], pagination: { page, limit, total: count ?? 0 } });
    }

    // GET /admin/users/:id/games
    if (userId && action === "games" && req.method === "GET") {
      const { data, error } = await admin.from("game_participants").select("game_id, score, rank, prize_amount, prize_credited, joined_at, games(title, mode, status)").eq("user_id", userId).order("joined_at", { ascending: false }).limit(50);
      if (error) return errorResponse("Failed to fetch game history", 500);
      return successResponse({ games: data ?? [] });
    }

    // POST /admin/users/:id/notify
    if (userId && action === "notify" && req.method === "POST") {
      const { title, body, type = "admin_message" } = await req.json();
      if (!title || !body) return errorResponse("title and body are required", 400);

      await admin.from("notifications").insert({ user_id: userId, type, title, body, is_read: false, created_at: new Date().toISOString() });
      return successResponse({ message: "Notification sent" });
    }

    // GET /admin/users/:id/kyc
    if (userId && action === "kyc" && !subAction && req.method === "GET") {
      const { data, error } = await admin.from("kyc_requests").select("*").eq("user_id", userId).order("submitted_at", { ascending: false });
      if (error) return errorResponse("Failed to fetch KYC", 500);
      return successResponse({ kyc_requests: data ?? [] });
    }

    // POST /admin/users/:id/kyc/review
    if (userId && action === "kyc" && subAction === "review" && req.method === "POST") {
      const { decision, rejection_reason } = await req.json();
      if (!["approve", "reject"].includes(decision)) return errorResponse("decision must be approve or reject", 400);
      if (decision === "reject" && !rejection_reason) return errorResponse("rejection_reason is required when rejecting", 400);

      const status = decision === "approve" ? "approved" : "rejected";
      const { data: latestKyc } = await admin.from("kyc_requests").select("id").eq("user_id", userId).eq("status", "pending").order("submitted_at", { ascending: false }).limit(1).single();
      if (!latestKyc) return errorResponse("No pending KYC request found", 404);

      await admin.from("kyc_requests").update({ status, rejection_reason: rejection_reason ?? null, reviewed_by: adminUserAuth.id, reviewed_at: new Date().toISOString() }).eq("id", latestKyc.id);
      await admin.from("profiles").update({ kyc_status: decision === "approve" ? "verified" : "rejected", updated_at: new Date().toISOString() }).eq("id", userId);

      // Notify user
      await admin.from("notifications").insert({ user_id: userId, type: "kyc_update", title: decision === "approve" ? "KYC Approved" : "KYC Rejected", body: decision === "approve" ? "Your identity has been verified." : `KYC rejected: ${rejection_reason}`, is_read: false, created_at: new Date().toISOString() });
      await admin.from("admin_audit_log").insert({ admin_id: adminUserAuth.id, action: `kyc_${decision}d`, target_type: "user", target_id: userId, details: { rejection_reason }, created_at: new Date().toISOString() });

      return successResponse({ message: `KYC ${decision}d`, kyc_status: decision === "approve" ? "verified" : "rejected" });
    }

    return errorResponse("Not found", 404);
  } catch (err) {
    console.error("[admin-users] unhandled error:", err);
    return errorResponse("Internal server error", 500);
  }
});
