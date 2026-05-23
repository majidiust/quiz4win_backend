/**
 * Admin Reports Edge Function — Quiz4Win
 *
 * GET /admin/reports/daily?date=YYYY-MM-DD  — Daily summary report (row 176)
 * GET /admin/reports/weekly?week=YYYY-WXX   — Weekly summary report (row 177)
 * GET /admin/reports/custom?from=&to=        — Custom date range report (row 178)
 * GET /admin/reports/:type/export            — Export report CSV/PDF (row 179)
 *
 * Rule compliance: R-01, R-02, R-03, super_admin/admin/finance
 */

import { handleCors } from "../_shared/cors.ts";
import { errorResponse, successResponse } from "../_shared/errors.ts";
import { validateJWT, requireAdminRole } from "../_shared/auth.ts";
import { getAdminClient } from "../_shared/supabase.ts";
import { csvResponse, toCsv, todayStamp } from "../_shared/csv.ts";

async function buildReport(admin: ReturnType<typeof getAdminClient>, from: string, to: string) {
  const [newUsers, newKyc, txData, withdrawals, games, prizes, pendingKyc] = await Promise.all([
    admin.from("profiles").select("id", { count: "exact", head: true }).gte("created_at", from).lte("created_at", to),
    admin.from("kyc_requests").select("id", { count: "exact", head: true }).eq("status", "approved").gte("reviewed_at", from).lte("reviewed_at", to),
    admin.from("transactions").select("type, amount, status").gte("created_at", from).lte("created_at", to),
    admin.from("withdrawals").select("id, amount, status").gte("created_at", from).lte("created_at", to),
    admin.from("games").select("id, mode, participant_count, prize_pool, status").gte("created_at", from).lte("created_at", to),
    admin.from("game_participants").select("prize_amount").not("prize_amount", "is", null).gte("joined_at", from).lte("joined_at", to),
    admin.from("kyc_requests").select("id", { count: "exact", head: true }).eq("status", "pending"),
  ]);

  const txRows = (txData.data ?? []) as Array<{ type: string; amount: number; status: string }>;
  const totalDeposits = txRows.filter((t) => t.type === "topup" && t.status === "completed").reduce((s, t) => s + t.amount, 0);
  const totalWithdrawals = (withdrawals.data ?? []).filter((w: { status: string }) => w.status === "completed").reduce((s: number, w: { amount: number }) => s + w.amount, 0);
  const totalPrizes = (prizes.data ?? []).reduce((s: number, p: { prize_amount: number | null }) => s + (p.prize_amount ?? 0), 0);
  const gamesData = (games.data ?? []) as Array<{ id: string; mode: string; participant_count: number; prize_pool: number; status: string }>;
  const totalGames = gamesData.length;
  const completedGames = gamesData.filter((g) => ["ended", "completed"].includes(g.status)).length;

  return {
    period: { from, to },
    users: { new_signups: newUsers.count ?? 0, kyc_approved: newKyc.count ?? 0, kyc_pending: pendingKyc.count ?? 0 },
    finance: { total_deposits_cents: totalDeposits, total_withdrawals_cents: totalWithdrawals, total_prizes_paid_cents: totalPrizes, net_revenue_cents: totalDeposits - totalWithdrawals - totalPrizes },
    games: { total: totalGames, completed: completedGames, total_participants: gamesData.reduce((s, g) => s + (g.participant_count ?? 0), 0) },
    generated_at: new Date().toISOString(),
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleCors();

  const url = new URL(req.url);
  const parts = url.pathname.replace(/^\/admin\/reports\/?/, "").split("/").filter(Boolean);
  const reportType = parts[0] ?? null;
  const action = parts[1] ?? null;

  const { user, error: authErr } = await validateJWT(req);
  if (authErr || !user) return errorResponse("unauthorized", 401);
  const { error: adminErr } = await requireAdminRole(user.id, ["super_admin", "admin", "finance"]);
  if (adminErr) return errorResponse(adminErr, 403);

  const admin = getAdminClient();

  try {
    // GET /admin/reports/daily?date=YYYY-MM-DD (row 176)
    if (reportType === "daily" && !action && req.method === "GET") {
      const date = url.searchParams.get("date") ?? new Date().toISOString().substring(0, 10);
      const from = `${date}T00:00:00.000Z`;
      const to = `${date}T23:59:59.999Z`;
      const report = await buildReport(admin, from, to);
      return successResponse({ type: "daily", date, ...report });
    }

    // GET /admin/reports/weekly?week=YYYY-WXX (row 177)
    if (reportType === "weekly" && !action && req.method === "GET") {
      const weekParam = url.searchParams.get("week");
      let from: string, to: string;
      if (weekParam) {
        // Parse ISO week YYYY-WXX
        const [year, week] = weekParam.split("-W").map(Number);
        const jan4 = new Date(year, 0, 4);
        const startOfWeek = new Date(jan4.getTime() + ((week - 1) * 7 - (jan4.getDay() || 7) + 1) * 86400000);
        from = startOfWeek.toISOString();
        to = new Date(startOfWeek.getTime() + 7 * 86400000 - 1).toISOString();
      } else {
        // Default: current week
        const now = new Date();
        const dow = now.getDay() || 7;
        const monday = new Date(now.getTime() - (dow - 1) * 86400000);
        monday.setHours(0, 0, 0, 0);
        from = monday.toISOString();
        to = new Date(monday.getTime() + 7 * 86400000 - 1).toISOString();
      }
      const report = await buildReport(admin, from, to);
      return successResponse({ type: "weekly", week: weekParam ?? "current", ...report });
    }

    // GET /admin/reports/custom?from=&to= (row 178)
    if (reportType === "custom" && !action && req.method === "GET") {
      const from = url.searchParams.get("from");
      const to = url.searchParams.get("to");
      if (!from || !to) return errorResponse("from and to query params are required", 400);
      const report = await buildReport(admin, from, to);
      return successResponse({ type: "custom", ...report });
    }

    // GET /admin/reports/:type/export — CSV (row 179)
    if (reportType && action === "export" && req.method === "GET") {
      const from = url.searchParams.get("from") ?? new Date(Date.now() - 30 * 86400000).toISOString();
      const to = url.searchParams.get("to") ?? new Date().toISOString();
      const report = await buildReport(admin, from, to);

      // Flatten report into CSV rows
      const flatRows = [
        { metric: "new_signups", value: report.users.new_signups, period_from: from, period_to: to },
        { metric: "kyc_approved", value: report.users.kyc_approved, period_from: from, period_to: to },
        { metric: "total_deposits_cents", value: report.finance.total_deposits_cents, period_from: from, period_to: to },
        { metric: "total_withdrawals_cents", value: report.finance.total_withdrawals_cents, period_from: from, period_to: to },
        { metric: "total_prizes_paid_cents", value: report.finance.total_prizes_paid_cents, period_from: from, period_to: to },
        { metric: "net_revenue_cents", value: report.finance.net_revenue_cents, period_from: from, period_to: to },
        { metric: "total_games", value: report.games.total, period_from: from, period_to: to },
        { metric: "completed_games", value: report.games.completed, period_from: from, period_to: to },
        { metric: "total_participants", value: report.games.total_participants, period_from: from, period_to: to },
      ];
      type FlatRow = { metric: string; value: number; period_from: string; period_to: string };
      const csv = toCsv(flatRows as FlatRow[], [
        { header: "metric", value: (r) => r.metric },
        { header: "value", value: (r) => r.value },
        { header: "period_from", value: (r) => r.period_from },
        { header: "period_to", value: (r) => r.period_to },
      ]);
      return csvResponse(csv, `report-${reportType}-${todayStamp()}.csv`);
    }

    return errorResponse("Not found", 404);
  } catch (err) {
    console.error("[admin-reports] unhandled error:", err);
    return errorResponse("Internal server error", 500);
  }
});
