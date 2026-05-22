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
    if (path === "validate" && req.method === "POST") {
      const { code } = await req.json();
      if (!code) return errorResponse("code is required", 400);

      const admin = getAdminClient();
      const { data: rc } = await admin
        .from("referral_codes")
        .select("code, is_active, expires_at, max_uses, use_count, bonus_amount, bonus_currency")
        .eq("code", code.toUpperCase())
        .single();

      if (!rc) return successResponse({ valid: false, reason: "Code not found" });
      if (!rc.is_active) return successResponse({ valid: false, reason: "Code is inactive" });
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
        bonus_currency: rc.bonus_currency,
      });
    }

    // Auth required for remaining endpoints
    const { user, error: authErr } = await validateJWT(req);
    if (authErr || !user) return errorResponse("unauthorized", 401);

    const supabase = getAnonClient(req);

    // GET /referrals/my-code
    if (path === "my-code" && req.method === "GET") {
      const { data: rc, error } = await supabase
        .from("referral_codes")
        .select("code, is_active, use_count, max_uses, created_at, expires_at, bonus_amount, bonus_currency")
        .eq("user_id", user.id)
        .single();

      if (error || !rc) {
        // Auto-generate if not yet created
        const newCode = `Q4W-${user.id.substring(0, 8).toUpperCase()}`;
        const admin = getAdminClient();
        const { data: created, error: createErr } = await admin
          .from("referral_codes")
          .insert({ user_id: user.id, code: newCode, is_active: true, use_count: 0 })
          .select("code, is_active, use_count, created_at")
          .single();

        if (createErr) return errorResponse("Failed to create referral code", 500);
        return successResponse({ referral_code: created });
      }

      return successResponse({ referral_code: rc });
    }

    // GET /referrals/stats
    if (path === "stats" && req.method === "GET") {
      const { data: rc } = await supabase
        .from("referral_codes")
        .select("code, use_count")
        .eq("user_id", user.id)
        .single();

      const { data: uses } = await supabase
        .from("referral_uses")
        .select("id, referred_user_id, bonus_credited, created_at, profiles!referred_user_id(name)")
        .eq("referrer_id", user.id)
        .order("created_at", { ascending: false });

      const totalBonus = (uses ?? []).filter((u) => u.bonus_credited).length;

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
