import Link from "next/link";
import { Card, CardHeader, CardSubtitle, CardTitle } from "@/components/ui/card";
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
interface BalanceResp {
  wallet_balance?: number; earnings_balance?: number; currency?: string;
}

export default async function WalletPage() {
  const [bal, ear] = await Promise.all([
    api<BalanceResp>("/wallet/balance"),
    api<{ earnings: Earning[]; totals: Record<string, number> }>("/host/earnings"),
  ]);
  const earnings = ear.ok ? ear.data?.earnings ?? [] : [];
  const totals = ear.ok ? ear.data?.totals ?? {} : {};
  const wallet = bal.ok ? bal.data?.wallet_balance ?? 0 : 0;
  const currency = (bal.ok && bal.data?.currency) || "USD";

  return (
    <>
      <PageHeader title="Wallet" subtitle="Earnings & balance" />

      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardSubtitle>Wallet balance</CardSubtitle>
          <div className="mt-2 text-2xl font-semibold tabular-nums">{formatMoney(wallet, currency)}</div>
          <Link href="/payment-methods" className="mt-2 inline-block text-xs text-[var(--color-q4w-primary)]">
            Payout methods →
          </Link>
        </Card>
        <Card>
          <CardSubtitle>Pending earnings</CardSubtitle>
          <div className="mt-2 text-2xl font-semibold tabular-nums">
            {formatMoney(totals.pending ?? 0, currency)}
          </div>
          <div className="text-[11px] text-[var(--color-q4w-muted)]">awaiting admin approval</div>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Earnings</CardTitle>
          <div className="text-xs text-[var(--color-q4w-muted)]">
            paid {formatMoney(totals.approved ?? 0, currency)}
          </div>
        </CardHeader>
        {earnings.length === 0 ? (
          <CardSubtitle>No earnings yet. Complete a show to start earning.</CardSubtitle>
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
