/**
 * Admin Referrals Edge Function — Quiz4Win
 *
 * GET    /admin/referrals               — List all referral codes (API #132)
 * POST   /admin/referrals/promo         — Create promo code (API #133)
 * DELETE /admin/referrals/promo/:code   — Deactivate promo code (API #134)
 *
 * Rule compliance: R-01, R-03
 */

import { handleCors } from "../_shared/cors.ts";
import { errorResponse, successResponse, sanitizeError } from "../_shared/errors.ts";
import { validateJWT, requireAdminRole } from "../_shared/auth.ts";
import { getAdminClient } from "../_shared/supabase.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleCors();

  const url = new URL(req.url);
  const parts = url.pathname.replace(/^\/admin\/referrals\/?/, "").split("/").filter(Boolean);
  const resource = parts[0] ?? null; // null | "promo"
  const code = parts[1] ?? null;

  const { user, error: authErr } = await validateJWT(req);
  if (authErr || !user) return errorResponse("unauthorized", 401);
  const { error: adminErr } = await requireAdminRole(user.id, ["super_admin", "admin"]);
  if (adminErr) return errorResponse(adminErr, 403);

  const admin = getAdminClient();

  try {
    // GET /admin/referrals — list all codes
    if (!resource && req.method === "GET") {
      const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1"));
      const limit = Math.min(200, parseInt(url.searchParams.get("limit") ?? "50"));
      const offset = (page - 1) * limit;

      const { data, error, count } = await admin
        .from("referral_codes")
        .select("id, code, user_id, is_active, is_promo, use_count, max_uses, expires_at, bonus_amount, bonus_currency, created_at, profiles!user_id(name, email)", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) return errorResponse("Failed to list referral codes", 500);
      return successResponse({ referral_codes: data ?? [], pagination: { page, limit, total: count ?? 0 } });
    }

    // POST /admin/referrals/promo — create promo code
    if (resource === "promo" && !code && req.method === "POST") {
      const { code: promoCode, bonus_amount, bonus_currency = "USD", max_uses, expires_at, description } = await req.json();
      if (!promoCode || !bonus_amount) return errorResponse("code and bonus_amount are required", 400);

      const { data, error } = await admin
        .from("referral_codes")
        .insert({
          code: promoCode.toUpperCase(),
          user_id: null, // promo codes are not user-owned
          is_active: true,
          is_promo: true,
          use_count: 0,
          max_uses: max_uses ?? null,
          expires_at: expires_at ?? null,
          bonus_amount: bonus_amount, // R-02: integer cents
          bonus_currency,
          description: description ?? null,
          created_by: user.id,
          created_at: new Date().toISOString(),
        })
        .select("id, code, bonus_amount, max_uses, expires_at, is_active")
        .single();

      if (error) return errorResponse(sanitizeError(error), 400);
      await admin.from("admin_audit_log").insert({ admin_id: user.id, action: "promo_code_created", target_type: "referral_code", target_id: data.id, created_at: new Date().toISOString() });
      return successResponse({ promo_code: data }, 201);
    }

    // DELETE /admin/referrals/promo/:code — deactivate
    if (resource === "promo" && code && req.method === "DELETE") {
      const { data, error } = await admin
        .from("referral_codes")
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq("code", code.toUpperCase())
        .eq("is_promo", true)
        .select("id, code")
        .single();

      if (error || !data) return errorResponse("Promo code not found", 404);
      await admin.from("admin_audit_log").insert({ admin_id: user.id, action: "promo_code_deactivated", target_type: "referral_code", details: { code }, created_at: new Date().toISOString() });
      return successResponse({ message: `Promo code ${code} deactivated` });
    }

    return errorResponse("Not found", 404);
  } catch (err) {
    console.error("[admin-referrals] unhandled error:", err);
    return errorResponse("Internal server error", 500);
  }
});
