import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export interface DashboardMetrics {
  users: { total: number; new24h: number; activeWeek: number };
  games: { liveNow: number; upcoming: number; completedToday: number };
  finance: { walletLiability: number; pendingWithdrawals: number; topupsToday: number };
  kyc: { pendingReviews: number };
  support: { openTickets: number };
}

export async function getDashboardMetrics(): Promise<DashboardMetrics> {
  const db = createSupabaseAdminClient();
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const startOfToday = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();

  const [
    usersTotal,
    usersNew,
    usersActive,
    liveGames,
    upcomingGames,
    completedToday,
    pendingKyc,
    openTickets,
    pendingWd,
    walletRows,
    topupRows,
  ] = await Promise.all([
    db.from("profiles").select("*", { count: "exact", head: true }),
    db.from("profiles").select("*", { count: "exact", head: true }).gte("created_at", since24h),
    db.from("profiles").select("*", { count: "exact", head: true }).gte("last_seen_at", since7d),
    db.from("games").select("*", { count: "exact", head: true }).eq("status", "live"),
    db.from("games").select("*", { count: "exact", head: true }).in("status", ["upcoming", "open"]),
    db.from("games").select("*", { count: "exact", head: true }).eq("status", "completed").gte("ended_at", startOfToday),
    db.from("kyc_requests").select("*", { count: "exact", head: true }).eq("status", "pending"),
    db.from("support_tickets").select("*", { count: "exact", head: true }).in("status", ["open", "in_progress"]),
    db.from("withdrawals").select("amount").in("status", ["pending", "processing"]),
    db.from("profiles").select("wallet_balance"),
    db
      .from("transactions")
      .select("amount")
      .eq("type", "topup")
      .eq("status", "completed")
      .gte("created_at", startOfToday),
  ]);

  const sumDecimal = (rows: { amount?: string | null; wallet_balance?: string | null }[], field: "amount" | "wallet_balance") =>
    (rows ?? []).reduce((acc, r) => acc + Number.parseFloat((r[field] as string) ?? "0"), 0);

  return {
    users: {
      total: usersTotal.count ?? 0,
      new24h: usersNew.count ?? 0,
      activeWeek: usersActive.count ?? 0,
    },
    games: {
      liveNow: liveGames.count ?? 0,
      upcoming: upcomingGames.count ?? 0,
      completedToday: completedToday.count ?? 0,
    },
    finance: {
      walletLiability: sumDecimal(walletRows.data ?? [], "wallet_balance"),
      pendingWithdrawals: sumDecimal(pendingWd.data ?? [], "amount"),
      topupsToday: sumDecimal(topupRows.data ?? [], "amount"),
    },
    kyc: { pendingReviews: pendingKyc.count ?? 0 },
    support: { openTickets: openTickets.count ?? 0 },
  };
}

export interface DailySeriesPoint {
  date: string;
  signups: number;
  topups: number;
}

export async function getDailySeries(days = 14): Promise<DailySeriesPoint[]> {
  const db = createSupabaseAdminClient();
  const start = new Date(Date.now() - (days - 1) * 24 * 60 * 60 * 1000);
  start.setHours(0, 0, 0, 0);

  const [{ data: signups }, { data: topups }] = await Promise.all([
    db.from("profiles").select("created_at").gte("created_at", start.toISOString()),
    db
      .from("transactions")
      .select("amount, created_at")
      .eq("type", "topup")
      .eq("status", "completed")
      .gte("created_at", start.toISOString()),
  ]);

  const buckets = new Map<string, DailySeriesPoint>();
  for (let i = 0; i < days; i++) {
    const d = new Date(start.getTime() + i * 86400000);
    const key = d.toISOString().slice(0, 10);
    buckets.set(key, { date: key, signups: 0, topups: 0 });
  }
  for (const row of signups ?? []) {
    const k = (row as { created_at: string }).created_at.slice(0, 10);
    const b = buckets.get(k);
    if (b) b.signups += 1;
  }
  for (const row of topups ?? []) {
    const r = row as { amount: string | null; created_at: string };
    const k = r.created_at.slice(0, 10);
    const b = buckets.get(k);
    if (b) b.topups += Number.parseFloat(r.amount ?? "0");
  }
  return Array.from(buckets.values());
}
