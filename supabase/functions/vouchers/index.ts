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
        .maybeSingle();

      if (!voucher) {
        // Fall back to referral codes (same top-up entry box).
        const { data: rc } = await admin
          .from("referral_codes")
          .select("code, owner_id, expires_at, max_uses, use_count, eligibility_days")
          .eq("code", code.toUpperCase())
          .maybeSingle();

        if (!rc) return successResponse({ valid: false, reason: "Code not found" });
        if (rc.owner_id === user.id) return successResponse({ valid: false, reason: "Cannot use your own referral code" });
        if (rc.expires_at && new Date(rc.expires_at) < new Date()) return successResponse({ valid: false, reason: "Code expired" });
        if (rc.max_uses !== null && rc.use_count >= rc.max_uses) return successResponse({ valid: false, reason: "Code usage limit reached" });

        // Eligibility window: referee must be within N days of their signup.
        // Fetch profile + global config in parallel.
        const [profileRes, cfgRes] = await Promise.all([
          admin.from("profiles").select("created_at").eq("id", user.id).maybeSingle(),
          admin.from("app_config").select("value").eq("key", "referral_eligibility_days").maybeSingle(),
        ]);
        const effectiveDays = rc.eligibility_days !== null && rc.eligibility_days !== undefined
          ? rc.eligibility_days
          : (parseInt(cfgRes.data?.value ?? "30", 10) || 30);
        if (effectiveDays > 0 && profileRes.data?.created_at) {
          const deadline = new Date(profileRes.data.created_at).getTime() + effectiveDays * 86_400_000;
          if (Date.now() > deadline) {
            return successResponse({ valid: false, reason: `Referral eligibility window has closed (${effectiveDays} days from signup)` });
          }
        }

        const { data: existingUse } = await admin
          .from("referral_uses")
          .select("id")
          .eq("referred_user_id", user.id)
          .maybeSingle();
        if (existingUse) return successResponse({ valid: false, reason: "You have already used a referral code" });

        return successResponse({
          valid: true,
          voucher: { code: rc.code, reward_type: "referral_bonus", valid_until: rc.expires_at },
        });
      }
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
        .maybeSingle();

      // Not a voucher → fall back to referral codes so a user can apply a
      // referral code as a post-signup top-up. One referral per user is
      // enforced by referral_uses.referred_user_id UNIQUE. The referee welcome
      // bonus is paid immediately (idempotent + monetization-gated inside the
      // RPC); the referrer bonus still fires on this user's first paid game.
      if (!voucher) {
        const { data: rc } = await admin
          .from("referral_codes")
          .select("code, owner_id, expires_at, max_uses, use_count, eligibility_days")
          .eq("code", code.toUpperCase())
          .maybeSingle();

        if (!rc) return errorResponse("invalid_code", 400);
        if (rc.owner_id === user.id) return errorResponse("cannot_use_own_code", 400);
        if (rc.expires_at && new Date(rc.expires_at) < new Date()) return errorResponse("code_expired", 400);
        if (rc.max_uses !== null && rc.use_count >= rc.max_uses) return errorResponse("code_limit_reached", 400);

        // Eligibility window: referee must be within N days of their signup.
        const [profileRes2, cfgRes2] = await Promise.all([
          admin.from("profiles").select("created_at").eq("id", user.id).maybeSingle(),
          admin.from("app_config").select("value").eq("key", "referral_eligibility_days").maybeSingle(),
        ]);
        const effectiveDays2 = rc.eligibility_days !== null && rc.eligibility_days !== undefined
          ? rc.eligibility_days
          : (parseInt(cfgRes2.data?.value ?? "30", 10) || 30);
        if (effectiveDays2 > 0 && profileRes2.data?.created_at) {
          const deadline2 = new Date(profileRes2.data.created_at).getTime() + effectiveDays2 * 86_400_000;
          if (Date.now() > deadline2) return errorResponse("referral_window_expired", 400);
        }

        const { data: useRow, error: useErr } = await admin
          .from("referral_uses")
          .insert({ code: rc.code, referred_user_id: user.id, referrer_user_id: rc.owner_id })
          .select("id")
          .single();

        if (useErr) {
          // UNIQUE(referred_user_id) → user already used a referral code.
          if (useErr.code === "23505" || useErr.message.toLowerCase().includes("duplicate")) {
            return errorResponse("already_referred", 409);
          }
          return errorResponse(sanitizeError(useErr), 500);
        }

        await admin.rpc("pay_referee_bonus", { p_referral_use_id: useRow.id });

        const { data: paid } = await admin
          .from("referral_uses")
          .select("referee_bonus_paid")
          .eq("id", useRow.id)
          .maybeSingle();

        return successResponse({
          message: "Referral code applied successfully",
          reward_type: "referral_bonus",
          reward_applied: !!paid?.referee_bonus_paid,
        });
      }

      if (voucher.status !== "active") return errorResponse("invalid_voucher", 400);
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
