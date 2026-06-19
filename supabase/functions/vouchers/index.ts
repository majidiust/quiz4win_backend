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
    // Schema: vouchers(reward_type, reward_value NUMERIC, valid_from,
    //   valid_until, max_redemptions, redemption_count, status, ...).
    //   No reward_amount / reward_currency columns.
    if (rawPath.endsWith("/vouchers/validate") && req.method === "POST") {
      const { code } = await req.json();
      if (!code) return errorResponse("code is required", 400);

      const { data: voucher } = await admin
        .from("vouchers")
        .select("id, code, status, reward_type, reward_value, valid_from, valid_until, max_redemptions, redemption_count")
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

      // Check if user already redeemed this voucher.
      const { data: existing } = await admin
        .from("voucher_redemptions")
        .select("id")
        .eq("voucher_id", voucher.id)
        .eq("user_id", user.id)
        .maybeSingle();
      if (existing) return successResponse({ valid: false, reason: "Already redeemed by this user" });

      return successResponse({
        valid: true,
        voucher: {
          code: voucher.code,
          reward_type: voucher.reward_type,
          reward_value: voucher.reward_value,
          valid_until: voucher.valid_until,
        },
      });
    }

    // POST /vouchers/redeem
    if (rawPath.endsWith("/vouchers/redeem") && req.method === "POST") {
      const { code, game_id } = await req.json();
      if (!code) return errorResponse("code is required", 400);

      const { data: voucher } = await admin
        .from("vouchers")
        .select("id, code, status, reward_type, reward_value, valid_until, max_redemptions, redemption_count")
        .eq("code", code.toUpperCase())
        .single();

      if (!voucher || voucher.status !== "active") return errorResponse("invalid_voucher", 400);
      if (voucher.valid_until && new Date(voucher.valid_until) < new Date()) return errorResponse("voucher_expired", 400);
      if (voucher.max_redemptions !== null && voucher.redemption_count >= voucher.max_redemptions) {
        return errorResponse("voucher_limit_reached", 400);
      }

      const { data: existing } = await admin.from("voucher_redemptions").select("id").eq("voucher_id", voucher.id).eq("user_id", user.id).maybeSingle();
      if (existing) return errorResponse("already_redeemed", 409);

      // R-05: append-only redemption record. Schema columns:
      // voucher_id, user_id, game_id, announcement_id, attempt_ip, user_agent,
      // reward_applied, reward_value_applied_usd, transaction_id, redeemed_at.
      const willApply = voucher.reward_type === "wallet_credit" && Number(voucher.reward_value ?? 0) > 0;
      const { error: redemptionErr } = await admin.from("voucher_redemptions").insert({
        voucher_id: voucher.id,
        user_id: user.id,
        game_id: game_id ?? null,
        reward_applied: willApply,
        reward_value_applied_usd: willApply ? voucher.reward_value : null,
      });
      if (redemptionErr) return errorResponse(sanitizeError(redemptionErr), 500);

      // Increment redemption count
      await admin.from("vouchers").update({ redemption_count: voucher.redemption_count + 1 }).eq("id", voucher.id);

      // Apply reward (schema stores reward_value as NUMERIC dollars).
      // credit_wallet p_amount_cents is also in dollars despite its name (R-02 note).
      if (willApply) {
        await admin.rpc("credit_wallet", {
          p_user_id: user.id,
          p_amount_cents: Number(voucher.reward_value),  // dollars, not cents
          p_reference_id: voucher.id,
          p_type: "voucher",
        });
      }

      return successResponse({
        message: "Voucher redeemed successfully",
        reward_type: voucher.reward_type,
        reward_value: voucher.reward_value,
      });
    }

    // GET /games/:id/active-voucher — active show voucher announcement.
    // Schema: voucher_announcements(expired_at, expiry_reason). No is_active.
    const activeVoucherMatch = rawPath.match(/\/games\/([^/]+)\/active-voucher/);
    if (activeVoucherMatch && req.method === "GET") {
      const gameId = activeVoucherMatch[1];

      const { data } = await admin
        .from("voucher_announcements")
        .select("id, voucher_id, announced_at, expired_at, vouchers(code, reward_type, reward_value)")
        .eq("game_id", gameId)
        .is("expired_at", null)
        .order("announced_at", { ascending: false })
        .limit(1)
        .maybeSingle();

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
        .select("id, redeemed_at, reward_applied, reward_value_applied_usd, vouchers(code, reward_type)", { count: "exact" })
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
