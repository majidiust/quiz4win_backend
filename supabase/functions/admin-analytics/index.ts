/**
 * Admin Analytics Edge Function — Quiz4Win
 *
 * GET /admin/analytics/revenue     — Revenue breakdown (API #67)
 * GET /admin/analytics/users       — User growth metrics (API #68)
 * GET /admin/analytics/games       — Game performance (API #69)
 * GET /admin/analytics/finance     — Platform P&L (API #70 / row 118)
 * GET /admin/analytics/vouchers    — Voucher redemption analytics (row 101)
 * GET /admin/analytics/retention   — Retention cohort Day-1/7/30 (row 103)
 * GET /admin/analytics/top-players — Top players leaderboard (row 104)
 * GET /admin/analytics/questions   — Question performance stats (row 105)
 * GET /admin/analytics/push-stats  — Push notification delivery rate (row 183)
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

    // GET /admin/analytics/vouchers — by campaign + show breakdown (row 101)
    if (path === "vouchers" && req.method === "GET") {
      const { from, to } = parseRange();
      const { data, error } = await admin.from("voucher_redemptions").select("voucher_id, redeemed_at, reward_type, reward_amount, vouchers!voucher_id(code, name, campaign)").gte("redeemed_at", from).lte("redeemed_at", to);
      if (error) return errorResponse("Failed to fetch voucher analytics", 500);
      type R = { voucher_id: string; redeemed_at: string; reward_type: string; reward_amount: number; vouchers: { code: string; name: string | null; campaign: string | null } | null };
      const rows = (data ?? []) as unknown as R[];
      const byCampaign: Record<string, { redemptions: number; total_value_cents: number }> = {};
      let total = 0;
      for (const r of rows) {
        const campaign = r.vouchers?.campaign ?? "uncategorised";
        if (!byCampaign[campaign]) byCampaign[campaign] = { redemptions: 0, total_value_cents: 0 };
        byCampaign[campaign].redemptions++;
        byCampaign[campaign].total_value_cents += r.reward_amount ?? 0;
        total += r.reward_amount ?? 0;
      }
      return successResponse({ period: { from, to }, total_redemptions: rows.length, total_value_cents: total, by_campaign: byCampaign });
    }

    // GET /admin/analytics/retention — Day-1/7/30 cohort (row 103)
    if (path === "retention" && req.method === "GET") {
      const { from, to } = parseRange();
      // Fetch users created in range
      const { data: cohort, error } = await admin.from("profiles").select("id, created_at").gte("created_at", from).lte("created_at", to).limit(10000);
      if (error) return errorResponse("Failed to fetch retention cohort", 500);
      if (!cohort || cohort.length === 0) return successResponse({ period: { from, to }, cohort_size: 0, day_1: 0, day_7: 0, day_30: 0 });

      const userIds = cohort.map((u: { id: string }) => u.id);
      // Check which users had any activity (game join) after D+1, D+7, D+30 relative to creation
      const { data: parts } = await admin.from("game_participants").select("user_id, joined_at").in("user_id", userIds);
      const activityMap: Record<string, string[]> = {};
      for (const p of (parts ?? []) as Array<{ user_id: string; joined_at: string }>) {
        if (!activityMap[p.user_id]) activityMap[p.user_id] = [];
        activityMap[p.user_id].push(p.joined_at);
      }
      let d1 = 0, d7 = 0, d30 = 0;
      for (const u of cohort as Array<{ id: string; created_at: string }>) {
        const created = new Date(u.created_at).getTime();
        const activities = (activityMap[u.id] ?? []).map((d) => new Date(d).getTime());
        if (activities.some((t) => t >= created + 86400000 && t < created + 2 * 86400000)) d1++;
        if (activities.some((t) => t >= created + 86400000 && t < created + 8 * 86400000)) d7++;
        if (activities.some((t) => t >= created + 86400000 && t < created + 31 * 86400000)) d30++;
      }
      const n = cohort.length;
      return successResponse({ period: { from, to }, cohort_size: n, day_1: d1, day_7: d7, day_30: d30, day_1_pct: +(d1 / n * 100).toFixed(1), day_7_pct: +(d7 / n * 100).toFixed(1), day_30_pct: +(d30 / n * 100).toFixed(1) });
    }

    // GET /admin/analytics/top-players — all-time, weekly, by game type (row 104)
    if (path === "top-players" && req.method === "GET") {
      const period = url.searchParams.get("period") ?? "all"; // all | weekly
      const mode = url.searchParams.get("mode"); // optional game mode filter
      const since = period === "weekly" ? new Date(Date.now() - 7 * 86400000).toISOString() : new Date(0).toISOString();
      let q = admin.from("game_participants").select("user_id, score, prize_amount, games!game_id(mode)").gte("games.created_at", since);
      if (mode) q = q.eq("games.mode", mode);
      const { data, error } = await q.limit(50000);
      if (error) return errorResponse("Failed to fetch top players", 500);
      type P = { user_id: string; score: number; prize_amount: number | null; games: { mode: string } | null };
      const agg: Record<string, { score: number; prizes: number; games_played: number }> = {};
      for (const p of (data ?? []) as unknown as P[]) {
        if (!agg[p.user_id]) agg[p.user_id] = { score: 0, prizes: 0, games_played: 0 };
        agg[p.user_id].score += p.score ?? 0;
        agg[p.user_id].prizes += p.prize_amount ?? 0;
        agg[p.user_id].games_played++;
      }
      const sorted = Object.entries(agg).sort(([, a], [, b]) => b.score - a.score).slice(0, 100).map(([uid, stats]) => ({ user_id: uid, ...stats }));
      // Hydrate names from profiles
      const ids = sorted.map((s) => s.user_id);
      const { data: profiles } = await admin.from("profiles").select("id, name, avatar_url").in("id", ids);
      const profileMap = Object.fromEntries((profiles ?? []).map((p: { id: string; name: string; avatar_url: string | null }) => [p.id, p]));
      const ranked = sorted.map((s, i) => ({ rank: i + 1, ...s, name: (profileMap[s.user_id] as { name: string } | undefined)?.name ?? null, avatar_url: (profileMap[s.user_id] as { avatar_url: string | null } | undefined)?.avatar_url ?? null }));
      return successResponse({ period, mode: mode ?? "all", top_players: ranked });
    }

    // GET /admin/analytics/questions — performance stats (row 105)
    if (path === "questions" && req.method === "GET") {
      const { from, to } = parseRange();
      const { data, error } = await admin.from("player_answers").select("question_id, is_correct, response_time_ms").gte("answered_at", from).lte("answered_at", to).limit(100000);
      if (error) return errorResponse("Failed to fetch question analytics", 500);
      type A = { question_id: string; is_correct: boolean; response_time_ms: number | null };
      const qStats: Record<string, { correct: number; wrong: number; total_time_ms: number; count: number }> = {};
      for (const a of (data ?? []) as unknown as A[]) {
        if (!qStats[a.question_id]) qStats[a.question_id] = { correct: 0, wrong: 0, total_time_ms: 0, count: 0 };
        qStats[a.question_id].count++;
        if (a.is_correct) qStats[a.question_id].correct++;
        else qStats[a.question_id].wrong++;
        qStats[a.question_id].total_time_ms += a.response_time_ms ?? 0;
      }
      const sorted = Object.entries(qStats).map(([qid, s]) => ({
        question_id: qid,
        attempts: s.count,
        correct_rate: +(s.correct / s.count * 100).toFixed(1),
        avg_response_ms: s.count ? Math.round(s.total_time_ms / s.count) : 0,
      })).sort((a, b) => a.correct_rate - b.correct_rate).slice(0, 50);
      return successResponse({ period: { from, to }, top_hardest_questions: sorted });
    }

    // GET /admin/analytics/push-stats — delivery rate last 24h (row 183)
    if (path === "push-stats" && req.method === "GET") {
      const since = new Date(Date.now() - 86400000).toISOString();
      const [sentRes, readRes] = await Promise.all([
        admin.from("notifications").select("id", { count: "exact", head: true }).gte("created_at", since),
        admin.from("notifications").select("id", { count: "exact", head: true }).gte("created_at", since).eq("is_read", true),
      ]);
      const sent = sentRes.count ?? 0;
      const read = readRes.count ?? 0;
      return successResponse({ last_24h: { sent, read, read_rate_pct: sent ? +(read / sent * 100).toFixed(1) : 0 } });
    }

    return errorResponse("Not found", 404);
  } catch (err) {
    console.error("[admin-analytics] unhandled error:", err);
    return errorResponse("Internal server error", 500);
  }
});
