/**
 * Referrals Edge Function — Quiz4Win
 *
 * POST /referrals/validate   — Validate referral code (API #42) — public
 * GET  /referrals/my-code    — Get my referral code (API #43)
 * GET  /referrals/stats      — Referral statistics (API #44)
 *
 * Rule compliance: R-01, R-03
 */

import { handleCors } from "../_shared/cors.ts";
import { errorResponse, successResponse } from "../_shared/errors.ts";
import { validateJWT } from "../_shared/auth.ts";
import { getAnonClient, getAdminClient } from "../_shared/supabase.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleCors();

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/referrals\/?/, "");

  try {
    // POST /referrals/validate — public (no auth required)
    // Schema: referral_codes(code PK, owner_id, type, expires_at, max_uses,
    //   use_count, bonus_amount, campaign_name, created_at). No `is_active`
    //   or `bonus_currency` columns.
    if (path === "validate" && req.method === "POST") {
      const { code } = await req.json();
      if (!code) return errorResponse("code is required", 400);

      const admin = getAdminClient();
      const { data: rc } = await admin
        .from("referral_codes")
        .select("code, expires_at, max_uses, use_count, bonus_amount")
        .eq("code", code.toUpperCase())
        .single();

      if (!rc) return successResponse({ valid: false, reason: "Code not found" });
      if (rc.expires_at && new Date(rc.expires_at) < new Date()) {
        return successResponse({ valid: false, reason: "Code expired" });
      }
      if (rc.max_uses !== null && rc.use_count >= rc.max_uses) {
        return successResponse({ valid: false, reason: "Code usage limit reached" });
      }

      return successResponse({
        valid: true,
        code: rc.code,
        bonus_amount: rc.bonus_amount,
      });
    }

    // Auth required for remaining endpoints
    const { user, error: authErr } = await validateJWT(req);
    if (authErr || !user) return errorResponse("unauthorized", 401);

    const supabase = getAnonClient(req);

    // GET /referrals/my-code
    // Schema column is owner_id (not user_id).
    if (path === "my-code" && req.method === "GET") {
      const { data: rc, error } = await supabase
        .from("referral_codes")
        .select("code, use_count, max_uses, created_at, expires_at, bonus_amount")
        .eq("owner_id", user.id)
        .single();

      if (error || !rc) {
        // Auto-generate if not yet created.
        const newCode = `Q4W-${user.id.substring(0, 8).toUpperCase()}`;
        const admin = getAdminClient();
        const { data: created, error: createErr } = await admin
          .from("referral_codes")
          .insert({ owner_id: user.id, code: newCode, type: "user" })
          .select("code, use_count, created_at, bonus_amount")
          .single();

        if (createErr) {
          console.warn("[referrals] create failed:", createErr.message);
          return errorResponse("Failed to create referral code", 500);
        }
        return successResponse({ referral_code: created });
      }

      return successResponse({ referral_code: rc });
    }

    // GET /referrals/stats
    // Schema: referral_uses(code, referred_user_id, referrer_user_id,
    //   bonus_paid, bonus_paid_at, used_at). Profile alias for `name`.
    if (path === "stats" && req.method === "GET") {
      const { data: rc } = await supabase
        .from("referral_codes")
        .select("code, use_count")
        .eq("owner_id", user.id)
        .single();

      const { data: uses } = await supabase
        .from("referral_uses")
        .select("id, referred_user_id, bonus_paid, used_at, profiles!referred_user_id(name:full_name)")
        .eq("referrer_user_id", user.id)
        .order("used_at", { ascending: false });

      const totalBonus = (uses ?? []).filter((u) => u.bonus_paid).length;

      return successResponse({
        code: rc?.code ?? null,
        total_referrals: rc?.use_count ?? 0,
        total_bonuses_earned: totalBonus,
        referrals: uses ?? [],
      });
    }

    return errorResponse("Not found", 404);
  } catch (err) {
    console.error("[referrals] unhandled error:", err);
    return errorResponse("Internal server error", 500);
  }
});
