import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

export interface DateRange {
  from: string;
  to: string;
}

export function resolveRange(sp: { from?: string; to?: string }, defaultDays = 30): DateRange {
  const today = new Date();
  const end = sp.to ? new Date(`${sp.to}T23:59:59.999Z`) : today;
  const start = sp.from
    ? new Date(`${sp.from}T00:00:00.000Z`)
    : new Date(end.getTime() - (defaultDays - 1) * 86400000);
  start.setUTCHours(0, 0, 0, 0);
  return { from: start.toISOString(), to: end.toISOString() };
}

function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const start = new Date(from);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(to);
  end.setUTCHours(0, 0, 0, 0);
  for (let d = new Date(start); d <= end; d = new Date(d.getTime() + 86400000)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

export interface RevenueSeriesPoint {
  date: string;
  revenue: number;
}
export interface RevenueAnalytics {
  range: DateRange;
  totalRevenue: number;
  byCurrency: Record<string, number>;
  series: RevenueSeriesPoint[];
}

export async function getRevenueAnalytics(range: DateRange): Promise<RevenueAnalytics> {
  const db = createSupabaseAdminClient();
  const { data, error } = await db
    .from("transactions")
    .select("amount, currency, created_at")
    .eq("type", "topup")
    .eq("status", "completed")
    .gte("created_at", range.from)
    .lte("created_at", range.to);
  if (error) throw error;

  const byCurrency: Record<string, number> = {};
  const byDay = new Map<string, number>(daysBetween(range.from, range.to).map((d) => [d, 0]));
  let total = 0;
  for (const row of data ?? []) {
    const amount = Number.parseFloat((row as { amount: string | null }).amount ?? "0");
    const cur = (row as { currency: string | null }).currency ?? "USD";
    const day = (row as { created_at: string }).created_at.slice(0, 10);
    byCurrency[cur] = (byCurrency[cur] ?? 0) + amount;
    if (byDay.has(day)) byDay.set(day, (byDay.get(day) ?? 0) + amount);
    total += amount;
  }
  return {
    range,
    totalRevenue: total,
    byCurrency,
    series: Array.from(byDay.entries()).map(([date, revenue]) => ({ date, revenue })),
  };
}

export interface UserAnalytics {
  range: DateRange;
  newUsers: number;
  kycVerified: number;
  suspended: number;
  activeWeek: number;
  series: { date: string; signups: number }[];
}

export async function getUserAnalytics(range: DateRange): Promise<UserAnalytics> {
  const db = createSupabaseAdminClient();
  const since7d = new Date(Date.now() - 7 * 86400000).toISOString();
  const [{ data: newRows, error: e1 }, { count: active }, { count: suspended }] = await Promise.all([
    db
      .from("profiles")
      .select("id, created_at, kyc_status, status")
      .gte("created_at", range.from)
      .lte("created_at", range.to),
    db.from("profiles").select("*", { count: "exact", head: true }).gte("last_seen_at", since7d),
    db.from("profiles").select("*", { count: "exact", head: true }).eq("status", "suspended"),
  ]);
  if (e1) throw e1;

  let kyc = 0;
  const byDay = new Map<string, number>(daysBetween(range.from, range.to).map((d) => [d, 0]));
  for (const r of newRows ?? []) {
    const row = r as { created_at: string; kyc_status: string | null };
    if (row.kyc_status === "verified") kyc += 1;
    const day = row.created_at.slice(0, 10);
    if (byDay.has(day)) byDay.set(day, (byDay.get(day) ?? 0) + 1);
  }
  return {
    range,
    newUsers: newRows?.length ?? 0,
    kycVerified: kyc,
    suspended: suspended ?? 0,
    activeWeek: active ?? 0,
    series: Array.from(byDay.entries()).map(([date, signups]) => ({ date, signups })),
  };
}

export interface GameModeStat {
  mode: string;
  count: number;
  participants: number;
  prizePool: number;
}
export interface GameAnalytics {
  range: DateRange;
  totalGames: number;
  totalParticipants: number;
  totalPrizePool: number;
  completionRate: number;
  byMode: GameModeStat[];
  series: { date: string; games: number }[];
}

export async function getGameAnalytics(range: DateRange): Promise<GameAnalytics> {
  const db = createSupabaseAdminClient();
  const { data, error } = await db
    .from("games")
    .select("id, mode, status, participant_count, prize_pool, created_at")
    .gte("created_at", range.from)
    .lte("created_at", range.to);
  if (error) throw error;

  const byMode = new Map<string, GameModeStat>();
  const byDay = new Map<string, number>(daysBetween(range.from, range.to).map((d) => [d, 0]));
  let participants = 0;
  let prize = 0;
  let completed = 0;
  for (const r of data ?? []) {
    const row = r as { mode: string | null; status: string; participant_count: number | null; prize_pool: string | null; created_at: string };
    const mode = row.mode ?? "unknown";
    const stat = byMode.get(mode) ?? { mode, count: 0, participants: 0, prizePool: 0 };
    stat.count += 1;
    stat.participants += row.participant_count ?? 0;
    stat.prizePool += Number.parseFloat(row.prize_pool ?? "0");
    byMode.set(mode, stat);
    participants += row.participant_count ?? 0;
    prize += Number.parseFloat(row.prize_pool ?? "0");
    if (row.status === "completed") completed += 1;
    const day = row.created_at.slice(0, 10);
    if (byDay.has(day)) byDay.set(day, (byDay.get(day) ?? 0) + 1);
  }
  return {
    range,
    totalGames: data?.length ?? 0,
    totalParticipants: participants,
    totalPrizePool: prize,
    completionRate: data && data.length > 0 ? completed / data.length : 0,
    byMode: Array.from(byMode.values()).sort((a, b) => b.count - a.count),
    series: Array.from(byDay.entries()).map(([date, games]) => ({ date, games })),
  };
}

export interface FinanceAnalytics {
  range: DateRange;
  topups: number;
  withdrawals: number;
  prizesPaid: number;
  entryFees: number;
  refunds: number;
  platformMargin: number;
  series: { date: string; topups: number; withdrawals: number }[];
}

export async function getFinanceAnalytics(range: DateRange): Promise<FinanceAnalytics> {
  const db = createSupabaseAdminClient();
  const { data, error } = await db
    .from("transactions")
    .select("type, amount, status, created_at")
    .gte("created_at", range.from)
    .lte("created_at", range.to);
  if (error) throw error;

  const totals: Record<string, number> = { topup: 0, withdrawal: 0, prize: 0, entry_fee: 0, refund: 0 };
  const byDay = new Map<string, { topups: number; withdrawals: number }>(
    daysBetween(range.from, range.to).map((d) => [d, { topups: 0, withdrawals: 0 }]),
  );
  for (const r of data ?? []) {
    const row = r as { type: string; amount: string | null; status: string; created_at: string };
    if (row.status !== "completed") continue;
    const amt = Number.parseFloat(row.amount ?? "0");
    if (totals[row.type] !== undefined) totals[row.type] += amt;
    const day = row.created_at.slice(0, 10);
    const bucket = byDay.get(day);
    if (bucket) {
      if (row.type === "topup") bucket.topups += amt;
      if (row.type === "withdrawal") bucket.withdrawals += amt;
    }
  }
  return {
    range,
    topups: totals.topup,
    withdrawals: totals.withdrawal,
    prizesPaid: totals.prize,
    entryFees: totals.entry_fee,
    refunds: totals.refund,
    platformMargin: totals.entry_fee - totals.prize - totals.refund,
    series: Array.from(byDay.entries()).map(([date, v]) => ({ date, topups: v.topups, withdrawals: v.withdrawals })),
  };
}
