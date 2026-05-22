/**
 * Admin Analytics Edge Function — Quiz4Win
 *
 * GET /admin/analytics/revenue  — Revenue breakdown (API #67)
 * GET /admin/analytics/users    — User growth metrics (API #68)
 * GET /admin/analytics/games    — Game performance (API #69)
 * GET /admin/analytics/finance  — Platform P&L (API #70)
 *
 * Rule compliance: R-01, R-03, admin-only (admin | super_admin)
 */

import { handleCors } from "../_shared/cors.ts";
import { errorResponse, successResponse } from "../_shared/errors.ts";
import { validateJWT, requireAdminRole } from "../_shared/auth.ts";
import { getAdminClient } from "../_shared/supabase.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleCors();

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/admin\/analytics\/?/, "");

  const { user, error: authErr } = await validateJWT(req);
  if (authErr || !user) return errorResponse("unauthorized", 401);
  const { error: adminErr } = await requireAdminRole(user.id, ["super_admin", "admin", "finance"]);
  if (adminErr) return errorResponse(adminErr, 403);

  const admin = getAdminClient();

  // Helper: parse date range from query params
  const parseRange = () => {
    const from = url.searchParams.get("from") ?? new Date(Date.now() - 30 * 86400000).toISOString();
    const to = url.searchParams.get("to") ?? new Date().toISOString();
    return { from, to };
  };

  try {
    // GET /admin/analytics/revenue
    if (path === "revenue" && req.method === "GET") {
      const { from, to } = parseRange();
      const { data, error } = await admin
        .from("transactions")
        .select("type, amount, currency, created_at")
        .in("type", ["topup"])
        .gte("created_at", from)
        .lte("created_at", to)
        .eq("status", "completed");

      if (error) return errorResponse("Failed to fetch revenue data", 500);

      const byDay: Record<string, number> = {};
      let total = 0;
      for (const tx of (data ?? [])) {
        const day = tx.created_at.substring(0, 10);
        byDay[day] = (byDay[day] ?? 0) + (tx.amount ?? 0);
        total += tx.amount ?? 0;
      }

      return successResponse({ period: { from, to }, total_revenue_cents: total, by_day: byDay });
    }

    // GET /admin/analytics/users
    if (path === "users" && req.method === "GET") {
      const { from, to } = parseRange();
      const { data, error } = await admin
        .from("profiles")
        .select("id, created_at, kyc_status, status")
        .gte("created_at", from)
        .lte("created_at", to);

      if (error) return errorResponse("Failed to fetch user data", 500);

      const byDay: Record<string, number> = {};
      let kycVerified = 0;
      for (const p of (data ?? [])) {
        const day = p.created_at.substring(0, 10);
        byDay[day] = (byDay[day] ?? 0) + 1;
        if (p.kyc_status === "verified") kycVerified++;
      }

      return successResponse({
        period: { from, to },
        new_users: data?.length ?? 0,
        kyc_verified: kycVerified,
        by_day: byDay,
      });
    }

    // GET /admin/analytics/games
    if (path === "games" && req.method === "GET") {
      const { from, to } = parseRange();
      const { data: games, error } = await admin
        .from("games")
        .select("id, mode, status, participant_count, prize_pool, entry_fee, created_at")
        .gte("created_at", from)
        .lte("created_at", to);

      if (error) return errorResponse("Failed to fetch games data", 500);

      const byMode: Record<string, { count: number; total_participants: number; total_prize_cents: number }> = {};
      for (const g of (games ?? [])) {
        const mode = g.mode ?? "unknown";
        if (!byMode[mode]) byMode[mode] = { count: 0, total_participants: 0, total_prize_cents: 0 };
        byMode[mode].count++;
        byMode[mode].total_participants += g.participant_count ?? 0;
        byMode[mode].total_prize_cents += g.prize_pool ?? 0;
      }

      return successResponse({ period: { from, to }, total_games: games?.length ?? 0, by_mode: byMode });
    }

    // GET /admin/analytics/finance
    if (path === "finance" && req.method === "GET") {
      const { from, to } = parseRange();
      const { data: txs, error } = await admin
        .from("transactions")
        .select("type, amount, status")
        .gte("created_at", from)
        .lte("created_at", to);

      if (error) return errorResponse("Failed to fetch finance data", 500);

      const summary: Record<string, number> = { topup: 0, withdrawal: 0, prize: 0, entry_fee: 0, refund: 0 };
      for (const tx of (txs ?? [])) {
        if (tx.status === "completed" && summary[tx.type] !== undefined) {
          summary[tx.type] += tx.amount ?? 0;
        }
      }

      const platformMargin = summary.entry_fee - summary.prize - summary.refund;
      return successResponse({
        period: { from, to },
        total_deposits_cents: summary.topup,
        total_withdrawals_cents: summary.withdrawal,
        total_prizes_paid_cents: summary.prize,
        total_entry_fees_cents: summary.entry_fee,
        total_refunds_cents: summary.refund,
        platform_margin_cents: platformMargin,
      });
    }

    return errorResponse("Not found", 404);
  } catch (err) {
    console.error("[admin-analytics] unhandled error:", err);
    return errorResponse("Internal server error", 500);
  }
});
