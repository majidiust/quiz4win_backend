import { Card, CardSubtitle, CardTitle } from "@/components/ui/card";
import { StatusChip } from "@/components/ui/status-chip";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api";
import { deleteMethodAction, setDefaultAction } from "./actions";
import { NETWORKS_BY_ID } from "@/lib/data/crypto-networks";
import AddWalletForm from "./add-wallet-form";

export const metadata = { title: "Payout wallets — Quiz4Win Host" };

interface Method {
  id: string; method_type: string; label: string | null;
  account_details: Record<string, string>; status: string; is_default: boolean;
  rejected_reason?: string | null;
}

// Legacy non-crypto types stay visible (read-only) for any existing rows.
const LEGACY_LABELS: Record<string, string> = {
  iban: "Bank · IBAN", bank_account: "Bank account", paypal: "PayPal",
};

function maskAddress(addr: string | undefined): string {
  if (!addr) return "—";
  if (addr.length <= 14) return addr;
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`;
}

export default async function PaymentMethodsPage({
  searchParams,
}: { searchParams: Promise<{ error?: string; info?: string }> }) {
  const sp = await searchParams;
  const r = await api<{ methods: Method[] }>("/host/payment-methods");
  const methods = r.ok ? r.data?.methods ?? [] : [];

  return (
    <>
      <PageHeader title="Payout wallets" subtitle="Where we send your earnings" />

      {sp.error ? (
        <div className="mb-3 rounded-2xl border border-[var(--color-q4w-danger)]/40 bg-[var(--color-q4w-danger)]/10 px-3 py-2 text-xs text-rose-300">{sp.error}</div>
      ) : null}
      {sp.info ? (
        <div className="mb-3 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">{sp.info}</div>
      ) : null}

      <div className="flex flex-col gap-3">
        {methods.length === 0 ? (
          <Card>
            <CardSubtitle>No wallets yet. Add your first crypto payout wallet below.</CardSubtitle>
          </Card>
        ) : methods.map((m) => {
          const net = NETWORKS_BY_ID[m.method_type];
          const legacy = LEGACY_LABELS[m.method_type];
          const title = m.label || net?.shortLabel || legacy || m.method_type;
          const addr = m.account_details?.address ?? m.account_details?.iban ?? m.account_details?.email ?? "";
          return (
            <Card key={m.id} className="relative overflow-hidden">
              {net ? (
                <span
                  className="pointer-events-none absolute inset-0 -z-10 opacity-25"
                  style={{ background: `linear-gradient(135deg, ${net.color}22 0%, ${net.accent}22 60%, transparent 100%)` }}
                />
              ) : null}
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[11px] font-bold text-white"
                    style={net ? { background: `linear-gradient(135deg, ${net.color}, ${net.accent})` } : { background: "rgba(255,255,255,0.06)" }}
                  >
                    {net?.token ?? "•"}
                  </span>
                  <div className="min-w-0">
                    <CardTitle className="truncate">{title}</CardTitle>
                    <div className="mt-0.5 truncate text-[11px] text-[var(--color-q4w-muted)]">
                      {net ? net.chain : legacy ?? "Legacy"} · <span className="font-mono">{maskAddress(addr)}</span>
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <StatusChip status={m.status} />
                  {m.is_default ? <span className="text-[10px] uppercase tracking-wider text-[var(--color-q4w-primary)]">default</span> : null}
                </div>
              </div>
              {m.rejected_reason ? (
                <div className="mt-2 text-xs text-rose-300">Rejected: {m.rejected_reason}</div>
              ) : null}
              <div className="mt-3 flex gap-3">
                {!m.is_default && m.status === "active" ? (
                  <form action={setDefaultAction}>
                    <input type="hidden" name="id" value={m.id} />
                    <button type="submit" className="text-xs text-[var(--color-q4w-primary)]">Set default</button>
                  </form>
                ) : null}
                {m.status !== "active" ? (
                  <form action={deleteMethodAction}>
                    <input type="hidden" name="id" value={m.id} />
                    <button type="submit" className="text-xs text-rose-300">Delete</button>
                  </form>
                ) : null}
              </div>
            </Card>
          );
        })}
      </div>

      <div className="mt-4">
        <AddWalletForm />
      </div>
    </>
  );
}
