import Link from "next/link";
import { ArrowRight, Settings2, Clock, TrendingUp } from "lucide-react";
import { Card, CardHeader, CardTitle, CardSubtitle } from "@/components/ui/card";
import { StatusChip } from "@/components/ui/status-chip";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api";
import { formatDateTime, formatMoney } from "@/lib/utils";

export const metadata = { title: "Wallet — Quiz4Win Host" };

interface Game { id: string; title: string; ended_at?: string | null }
interface Earning {
  id: string; amount: number | string; status: string; currency?: string;
  approved_at?: string | null; created_at: string; games?: Game | null;
}
interface BalanceResp { wallet_balance?: number; currency?: string }

export default async function WalletPage() {
  const [bal, ear] = await Promise.all([
    api<BalanceResp>("/wallet/balance"),
    api<{ earnings: Earning[]; totals: Record<string, number> }>("/host/earnings"),
  ]);
  const earnings = ear.ok ? ear.data?.earnings ?? [] : [];
  const totals = ear.ok ? ear.data?.totals ?? {} : {};
  const available = bal.ok ? bal.data?.wallet_balance ?? 0 : 0;
  const currency = (bal.ok && bal.data?.currency) || "USD";
  const pending = totals.pending ?? 0;
  const totalApproved = totals.approved ?? 0;

  return (
    <>
      <PageHeader title="Wallet" />

      {/* ── Available balance ─────────────────────────────────────────────── */}
      <Card className="mb-4">
        <div className="mb-1 text-[11px] uppercase tracking-widest text-white/50">Available to withdraw</div>
        <div className="text-4xl font-bold tabular-nums">{formatMoney(available, currency)}</div>
        <p className="mt-1 text-[12px] text-[var(--color-q4w-muted)]">
          Earnings approved by the team and credited to your balance.
        </p>

        {/* Action buttons */}
        <div className="mt-4 flex gap-2">
          <Link
            href="/withdrawals"
            className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-pink-300 via-fuchsia-300 to-teal-300 px-4 py-3 text-sm font-semibold text-black shadow-[0_8px_28px_-8px_rgba(236,72,153,0.5)] transition active:scale-[0.98]"
          >
            Request Payout <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            href="/payment-methods"
            className="glass flex items-center justify-center gap-2 rounded-2xl border border-white/10 px-4 py-3 text-sm text-[var(--color-q4w-text)] transition hover:bg-white/10 active:scale-[0.98]"
          >
            <Settings2 className="h-4 w-4 opacity-70" />
            Wallets
          </Link>
        </div>
      </Card>

      {/* ── Stats row ─────────────────────────────────────────────────────── */}
      <div className="mb-4 grid grid-cols-2 gap-3">
        <Card>
          <div className="mb-2 flex items-center gap-1.5 text-[11px] uppercase tracking-widest text-amber-400/80">
            <Clock className="h-3 w-3" /> Pending review
          </div>
          <div className="text-2xl font-semibold tabular-nums">{formatMoney(pending, currency)}</div>
          <div className="mt-1 text-[11px] text-[var(--color-q4w-muted)]">
            Earned from recent shows — the team is reviewing before crediting to your balance.
          </div>
        </Card>
        <Card>
          <div className="mb-2 flex items-center gap-1.5 text-[11px] uppercase tracking-widest text-emerald-400/80">
            <TrendingUp className="h-3 w-3" /> Total credited
          </div>
          <div className="text-2xl font-semibold tabular-nums">{formatMoney(totalApproved, currency)}</div>
          <div className="mt-1 text-[11px] text-[var(--color-q4w-muted)]">
            All-time earnings approved and added to your balance.
          </div>
        </Card>
      </div>

      {/* ── Earning history ───────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Earning History</CardTitle>
          <span className="text-xs text-[var(--color-q4w-muted)]">{earnings.length} shows</span>
        </CardHeader>
        <p className="mb-3 text-[11px] text-[var(--color-q4w-muted)]">
          One entry per show you hosted. <span className="text-amber-400/90">Pending</span> means we're reviewing it.{" "}
          <span className="text-emerald-400/90">Approved</span> means it's been added to your available balance above.
        </p>
        {earnings.length === 0 ? (
          <CardSubtitle>No earnings yet — host a show to start earning.</CardSubtitle>
        ) : (
          <div className="-mx-1 flex flex-col">
            {earnings.map((e) => (
              <div key={e.id} className="flex items-center justify-between gap-2 border-b border-[var(--color-q4w-border)]/60 px-1 py-3 last:border-b-0">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{e.games?.title ?? "—"}</div>
                  <div className="text-[11px] text-[var(--color-q4w-muted)]">
                    {formatDateTime(e.approved_at ?? e.created_at)}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <div className="text-sm font-semibold tabular-nums">
                    {formatMoney(Number(e.amount), e.currency ?? currency)}
                  </div>
                  <StatusChip status={e.status} />
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
