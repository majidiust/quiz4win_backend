import { Card, CardHeader, CardTitle, CardSubtitle } from "@/components/ui/card";
import { StatusChip } from "@/components/ui/status-chip";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api";
import { formatDateTime, formatMoney } from "@/lib/utils";
import RequestWithdrawalForm from "./request-form";

export const metadata = { title: "Withdrawals — Quiz4Win Host" };

interface Withdrawal {
  id: string;
  amount: number | string;
  currency?: string;
  status: string;
  crypto_coin?: string | null;
  crypto_network?: string | null;
  rejection_reason?: string | null;
  transaction_reference?: string | null;
  requested_at: string;
  completed_at?: string | null;
}

interface PaymentMethod {
  id: string;
  method_type: string;
  label: string | null;
  status: string;
  account_details: Record<string, string> | null;
}

interface BalanceResp { wallet_balance?: number; currency?: string }

export default async function WithdrawalsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const successMsg = sp.success === "1" ? "Withdrawal request submitted successfully." : null;
  const errorMsg = sp.error ? decodeURIComponent(sp.error) : null;

  const [balRes, listRes, methodsRes] = await Promise.all([
    api<BalanceResp>("/wallet/balance"),
    api<{ withdrawals: Withdrawal[] }>("/host/withdrawals"),
    api<{ methods: PaymentMethod[] }>("/host/payment-methods"),
  ]);

  const balance = balRes.ok ? balRes.data?.wallet_balance ?? 0 : 0;
  const currency = (balRes.ok && balRes.data?.currency) || "USD";
  const withdrawals = listRes.ok ? listRes.data?.withdrawals ?? [] : [];
  const methods = methodsRes.ok ? methodsRes.data?.methods ?? [] : [];

  return (
    <>
      <PageHeader title="Withdrawals" subtitle="Request and track payouts" />

      {successMsg ? (
        <div className="mb-4 rounded-2xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          ✓ {successMsg}
        </div>
      ) : null}
      {errorMsg ? (
        <div className="mb-4 rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {errorMsg}
        </div>
      ) : null}

      {/* Balance card */}
      <Card className="mb-4">
        <CardSubtitle>Available balance</CardSubtitle>
        <div className="mt-2 text-3xl font-bold tabular-nums">{formatMoney(balance, currency)}</div>
        <div className="mt-1 text-[11px] text-[var(--color-q4w-muted)]">Minimum withdrawal: $10.00</div>
      </Card>

      {/* Request form */}
      <div className="mb-6">
        <RequestWithdrawalForm methods={methods} walletBalance={balance} />
      </div>

      {/* History */}
      <Card>
        <CardHeader>
          <CardTitle>Withdrawal History</CardTitle>
          <span className="text-xs text-[var(--color-q4w-muted)]">{withdrawals.length} total</span>
        </CardHeader>
        {withdrawals.length === 0 ? (
          <CardSubtitle>No withdrawals yet.</CardSubtitle>
        ) : (
          <div className="-mx-1 flex flex-col">
            {withdrawals.map((w) => (
              <div key={w.id} className="flex items-start justify-between gap-2 border-b border-[var(--color-q4w-border)]/60 px-1 py-3 last:border-b-0">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold tabular-nums">
                    {formatMoney(Number(w.amount), w.currency ?? currency)}
                  </div>
                  {w.crypto_coin ? (
                    <div className="text-[11px] text-[var(--color-q4w-muted)]">
                      {w.crypto_coin}{w.crypto_network ? ` · ${w.crypto_network}` : ""}
                    </div>
                  ) : null}
                  <div className="text-[11px] text-[var(--color-q4w-muted)]">
                    {formatDateTime(w.requested_at)}
                  </div>
                  {w.rejection_reason ? (
                    <div className="mt-1 text-[11px] text-rose-300">{w.rejection_reason}</div>
                  ) : null}
                  {w.transaction_reference && w.status === "completed" ? (
                    <div className="mt-1 font-mono text-[11px] text-[var(--color-q4w-muted)]">TX: {w.transaction_reference}</div>
                  ) : null}
                </div>
                <StatusChip status={w.status} />
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
