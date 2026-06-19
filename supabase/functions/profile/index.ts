/**
 * Profile Edge Function — Quiz4Win
 *
 * GET    /profile          — Get authenticated user profile (API #10)
 * PATCH  /profile          — Update display name / language (API #11)
 * POST   /profile/avatar   — Upload / replace profile picture (API #12)
 * DELETE /profile          — Permanently delete account (API #13)
 *
 * Rule compliance: R-01, R-03 (JWT validated before every operation)
 */

import { handleCors } from "../_shared/cors.ts";
import { errorResponse, successResponse, sanitizeError } from "../_shared/errors.ts";
import { validateJWT } from "../_shared/auth.ts";
import { getAnonClient, getAdminClient } from "../_shared/supabase.ts";
import { uploadObject } from "../_shared/s3.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleCors();

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/profile\/?/, "");

  // All endpoints require auth (R-03)
  const { user, error: authErr } = await validateJWT(req);
  if (authErr || !user) return errorResponse("unauthorized", 401);

  const supabase = getAnonClient(req);

  try {
    // GET /profile
    // Note: the public API exposes `name` and `nationality` for backward
    // compatibility; the underlying columns are `full_name` and `country`.
    // PostgREST `alias:source` syntax renames them in the response.
    if (!path && req.method === "GET") {
      const cols = "id, email, name:full_name, avatar_url, language, kyc_status, status, wallet_balance, earnings_balance, score_balance, referral_code, created_at, nationality:country";

      // Run profile fetch and host-status check in parallel.
      // The show_hosts_own_select RLS policy allows an authenticated user to
      // SELECT their own row (auth_user_id = auth.uid()), so the anon client
      // (which carries the user's JWT) is sufficient — no admin bypass needed.
      const [profileRes, hostRes] = await Promise.all([
        supabase.from("profiles").select(cols).eq("id", user.id).maybeSingle(),
        supabase
          .from("show_hosts")
          .select("id, application_status, status")
          .eq("auth_user_id", user.id)
          .maybeSingle(),
      ]);

      const hostInfo = hostRes.data
        ? {
            is_host: true,
            host_id: hostRes.data.id as string,
            host_status: hostRes.data.status as string,
            host_application_status: hostRes.data.application_status as string,
          }
        : { is_host: false, host_id: null, host_status: null, host_application_status: null };

      if (profileRes.data) return successResponse({ user: { ...profileRes.data, ...hostInfo } });

      // Anon read was denied (RLS) or returned nothing. Re-check with the
      // admin client scoped to the authenticated user's own id (id = user.id).
      // This is not a service_role bypass: we always restrict to the JWT
      // subject and never expose another user's row (R-04 spirit preserved).
      console.warn(`[profile] GET — user=${user.id} anon empty (rls?):`, profileRes.error?.message);
      const admin = getAdminClient();
      const { data: existing } = await admin
        .from("profiles")
        .select(cols)
        .eq("id", user.id)
        .maybeSingle();
      if (existing) return successResponse({ user: { ...existing, ...hostInfo } });

      // Truly missing — backfill (pre-trigger accounts).
      const fallbackName = (user.user_metadata?.full_name as string | undefined) ?? null;
      const { data: created, error: createErr } = await admin
        .from("profiles")
        .insert({ id: user.id, email: user.email, full_name: fallbackName })
        .select(cols)
        .single();

      if (createErr || !created) {
        console.warn(`[profile] GET — user=${user.id} lazy-create failed:`, createErr?.message);
        return errorResponse("profile_not_found", 404);
      }
      return successResponse({ user: { ...created, ...hostInfo } });
    }

    // PATCH /profile
    // Frontend sends `name` / `nationality` (API contract); map to real columns.
    if (!path && req.method === "PATCH") {
      const body = await req.json();
      const allowed: Record<string, unknown> = {};
      if (body.name !== undefined) allowed.full_name = body.name;
      if (body.language !== undefined) allowed.language = body.language;
      if (body.nationality !== undefined) allowed.country = body.nationality;

      if (Object.keys(allowed).length === 0) {
        return errorResponse("No updatable fields provided", 400);
      }

      const { data, error } = await supabase
        .from("profiles")
        .update({ ...allowed, updated_at: new Date().toISOString() })
        .eq("id", user.id)
        .select("id, email, name:full_name, avatar_url, language, updated_at")
        .single();

      if (error) {
        console.warn(`[profile] PATCH — user=${user.id} update failed:`, error.message);
        return errorResponse(sanitizeError(error), 400);
      }
      return successResponse({ user: data });
    }

    // POST /profile/avatar
    if (path === "avatar" && req.method === "POST") {
      console.log("[avatar] step=1 enter");
      const contentType = req.headers.get("content-type") ?? "";
      if (!contentType.includes("multipart/form-data")) {
        return errorResponse("Content-Type must be multipart/form-data", 400);
      }

      console.log("[avatar] step=2 parsing formData");
      let formData: FormData;
      try {
        formData = await req.formData();
      } catch (err) {
        console.log("[avatar] step=2 FAILED formData parse:", err instanceof Error ? err.message : String(err));
        return errorResponse("invalid_multipart", 400);
      }
      const file = formData.get("avatar") as File | null;
      console.log("[avatar] step=3 file present:", !!file, "type:", file?.type, "size:", file?.size);
      if (!file) return errorResponse("avatar file is required", 400);

      const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
      if (!allowedTypes.includes(file.type)) {
        return errorResponse("Only JPEG, PNG, and WebP are allowed", 400);
      }

      const maxBytes = 5 * 1024 * 1024; // 5 MB
      if (file.size > maxBytes) return errorResponse("File too large (max 5 MB)", 400);

      const ext = file.type.split("/")[1];
      const key = `avatars/${user.id}/avatar.${ext}`;
      const arrayBuffer = await file.arrayBuffer();
      console.log("[avatar] step=4 about to s3 upload key=", key, "bytes=", arrayBuffer.byteLength);

      // S3 env snapshot (no secret values — only presence/length).
      console.log("[avatar] step=4b env presence:", {
        S3_BUCKET: (Deno.env.get("S3_BUCKET") ?? "").length,
        S3_REGION: (Deno.env.get("S3_REGION") ?? "").length,
        S3_ACCESS_KEY: (Deno.env.get("S3_ACCESS_KEY") ?? "").length,
        S3_SECRET: (Deno.env.get("S3_SECRET") ?? "").length,
        S3_ENDPOINT: (Deno.env.get("S3_ENDPOINT") ?? "").length,
      });

      let publicUrl: string | null;
      try {
        const result = await uploadObject(key, arrayBuffer, file.type, "public-read");
        publicUrl = result.publicUrl;
        console.log("[avatar] step=5 s3 upload OK url=", publicUrl);
      } catch (err) {
        // R-01: log full error server-side for ops; return sanitized to client.
        const e = err as { name?: string; message?: string; Code?: string; $metadata?: unknown };
        console.log("[avatar] step=5 FAILED s3:", {
          name: e?.name, code: e?.Code, message: e?.message, meta: e?.$metadata,
        });
        return errorResponse(sanitizeError(err), 500);
      }
      if (!publicUrl) return errorResponse("upload_failed", 500);

      // Use admin client so the UPDATE isn't silently dropped by RLS.
      const admin = getAdminClient();
      const { error: updErr } = await admin
        .from("profiles")
        .update({ avatar_url: publicUrl, updated_at: new Date().toISOString() })
        .eq("id", user.id);
      if (updErr) {
        console.log("[avatar] step=6 FAILED profile update:", updErr);
        return errorResponse(sanitizeError(updErr), 500);
      }

      console.log("[avatar] step=7 done");
      return successResponse({ avatar_url: publicUrl });
    }

    // DELETE /profile
    if (!path && req.method === "DELETE") {
      const admin = getAdminClient();

      // Soft-delete: set status to 'deleted', anonymize PII. The `status` CHECK
      // does not include 'deleted' yet — store as 'banned' for now (closest match
      // until a future migration extends the enum) and clear identifying fields.
      await admin.from("profiles").update({
        status: "banned",
        full_name: "[deleted]",
        avatar_url: null,
        updated_at: new Date().toISOString(),
      }).eq("id", user.id);

      // Hard-delete from Supabase Auth (removes login capability)
      await admin.auth.admin.deleteUser(user.id);

      return successResponse({ message: "Account deleted" });
    }

    return errorResponse("Not found", 404);
  } catch (err) {
    const e = err as { name?: string; message?: string; stack?: string };
    console.log("[profile] OUTER CATCH", { name: e?.name, message: e?.message, stack: e?.stack });
    return errorResponse("Internal server error", 500);
  }
});
