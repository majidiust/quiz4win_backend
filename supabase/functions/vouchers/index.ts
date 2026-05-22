/**
 * Vouchers Edge Function — Quiz4Win
 *
 * POST /vouchers/redeem          — Redeem a voucher code (API #155)
 * GET  /games/:id/active-voucher — Active voucher for a game (API #156)
 * POST /vouchers/validate        — Validate without redeeming (API #157)
 * GET  /vouchers/my-redemptions  — My redemption history (API #158)
 *
 * Rule compliance: R-01, R-02, R-03, R-05
 */

import { handleCors } from "../_shared/cors.ts";
import { errorResponse, successResponse, sanitizeError } from "../_shared/errors.ts";
import { validateJWT } from "../_shared/auth.ts";
import { getAnonClient, getAdminClient } from "../_shared/supabase.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleCors();

  const url = new URL(req.url);
  const rawPath = url.pathname;

  const { user, error: authErr } = await validateJWT(req);
  if (authErr || !user) return errorResponse("unauthorized", 401);

  const supabase = getAnonClient(req);
  const admin = getAdminClient();

  try {
    // POST /vouchers/validate — check without consuming
    if (rawPath.endsWith("/vouchers/validate") && req.method === "POST") {
      const { code, game_id } = await req.json();
      if (!code) return errorResponse("code is required", 400);

      const { data: voucher } = await admin
        .from("vouchers")
        .select("id, code, status, reward_type, reward_amount, reward_currency, valid_from, valid_until, max_redemptions, redemption_count, usage_policy, eligibility_rules")
        .eq("code", code.toUpperCase())
        .single();

      if (!voucher) return successResponse({ valid: false, reason: "Code not found" });
      if (voucher.status !== "active") return successResponse({ valid: false, reason: `Voucher is ${voucher.status}` });
      if (voucher.valid_until && new Date(voucher.valid_until) < new Date()) {
        return successResponse({ valid: false, reason: "Voucher expired" });
      }
      if (voucher.max_redemptions !== null && voucher.redemption_count >= voucher.max_redemptions) {
        return successResponse({ valid: false, reason: "Redemption limit reached" });
      }

      // Check if user already redeemed this voucher (if single-use-per-user policy)
      const { data: existing } = await admin
        .from("voucher_redemptions")
        .select("id")
        .eq("voucher_id", voucher.id)
        .eq("user_id", user.id)
        .single();
      if (existing) return successResponse({ valid: false, reason: "Already redeemed by this user" });

      return successResponse({
        valid: true,
        voucher: {
          code: voucher.code,
          reward_type: voucher.reward_type,
          reward_amount: voucher.reward_amount, // R-02: integer cents
          reward_currency: voucher.reward_currency,
          valid_until: voucher.valid_until,
        },
      });
    }

    // POST /vouchers/redeem
    if (rawPath.endsWith("/vouchers/redeem") && req.method === "POST") {
      const { code, game_id } = await req.json();
      if (!code) return errorResponse("code is required", 400);

      // Re-validate
      const { data: voucher } = await admin
        .from("vouchers")
        .select("id, code, status, reward_type, reward_amount, reward_currency, valid_until, max_redemptions, redemption_count")
        .eq("code", code.toUpperCase())
        .single();

      if (!voucher || voucher.status !== "active") return errorResponse("invalid_voucher", 400);
      if (voucher.valid_until && new Date(voucher.valid_until) < new Date()) return errorResponse("voucher_expired", 400);
      if (voucher.max_redemptions !== null && voucher.redemption_count >= voucher.max_redemptions) {
        return errorResponse("voucher_limit_reached", 400);
      }

      const { data: existing } = await admin.from("voucher_redemptions").select("id").eq("voucher_id", voucher.id).eq("user_id", user.id).single();
      if (existing) return errorResponse("already_redeemed", 409);

      // R-05: append-only redemption record
      const { error: redemptionErr } = await admin.from("voucher_redemptions").insert({
        voucher_id: voucher.id,
        user_id: user.id,
        game_id: game_id ?? null,
        redeemed_at: new Date().toISOString(),
        reward_type: voucher.reward_type,
        reward_amount: voucher.reward_amount,
      });
      if (redemptionErr) return errorResponse(sanitizeError(redemptionErr), 500);

      // Increment redemption count
      await admin.from("vouchers").update({ redemption_count: voucher.redemption_count + 1 }).eq("id", voucher.id);

      // Apply reward
      if (voucher.reward_type === "wallet_credit" && voucher.reward_amount > 0) {
        await admin.rpc("credit_wallet", {
          p_user_id: user.id,
          p_amount_cents: voucher.reward_amount,
          p_reference_id: voucher.id,
          p_type: "voucher",
        });
      }

      return successResponse({
        message: "Voucher redeemed successfully",
        reward_type: voucher.reward_type,
        reward_amount: voucher.reward_amount,
        reward_currency: voucher.reward_currency,
      });
    }

    // GET /games/:id/active-voucher — active show voucher announcement
    const activeVoucherMatch = rawPath.match(/\/games\/([^/]+)\/active-voucher/);
    if (activeVoucherMatch && req.method === "GET") {
      const gameId = activeVoucherMatch[1];

      const { data } = await admin
        .from("voucher_announcements")
        .select("id, voucher_id, announced_at, expires_at, vouchers(code, reward_type, reward_amount, reward_currency)")
        .eq("game_id", gameId)
        .eq("is_active", true)
        .gte("expires_at", new Date().toISOString())
        .single();

      if (!data) return successResponse({ active_voucher: null });
      return successResponse({ active_voucher: data });
    }

    // GET /vouchers/my-redemptions
    if (rawPath.endsWith("/vouchers/my-redemptions") && req.method === "GET") {
      const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1"));
      const limit = Math.min(100, parseInt(url.searchParams.get("limit") ?? "20"));
      const offset = (page - 1) * limit;

      const { data, error, count } = await admin
        .from("voucher_redemptions")
        .select("id, redeemed_at, reward_type, reward_amount, vouchers(code, reward_currency)", { count: "exact" })
        .eq("user_id", user.id)
        .order("redeemed_at", { ascending: false })
        .range(offset, offset + limit - 1);

      if (error) return errorResponse("Failed to fetch redemptions", 500);
      return successResponse({ redemptions: data ?? [], pagination: { page, limit, total: count ?? 0 } });
    }

    return errorResponse("Not found", 404);
  } catch (err) {
    console.error("[vouchers] unhandled error:", err);
    return errorResponse("Internal server error", 500);
  }
});
