import { Card, CardSubtitle, CardTitle } from "@/components/ui/card";
import { StatusChip } from "@/components/ui/status-chip";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api";
import { deleteMethodAction, setDefaultAction } from "./actions";
import { NETWORKS_BY_ID } from "@/lib/data/crypto-networks";
import AddWalletForm from "./add-wallet-form";
import { ShieldCheck } from "lucide-react";

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
      <PageHeader title="Payout wallets" back="/wallet" />

      {sp.error ? (
        <div className="mb-3 rounded-2xl border border-[var(--color-q4w-danger)]/40 bg-[var(--color-q4w-danger)]/10 px-3 py-2 text-xs text-rose-300">{sp.error}</div>
      ) : null}
      {sp.info ? (
        <div className="mb-3 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">{sp.info}</div>
      ) : null}

      {/* ── Saved wallets ─────────────────────────────────────────────────── */}
      <div className="mb-1 flex items-center justify-between px-1">
        <span className="text-[11px] uppercase tracking-widest text-white/40">
          Your wallets {methods.length > 0 ? `(${methods.length})` : ""}
        </span>
      </div>

      <div className="mb-6 flex flex-col gap-3">
        {methods.length === 0 ? (
          <Card>
            <CardSubtitle>No wallets added yet — use the form below to add your first one.</CardSubtitle>
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

              <div className="flex items-start gap-3">
                {/* Icon */}
                <span
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-[11px] font-bold text-white"
                  style={net ? { background: `linear-gradient(135deg, ${net.color}, ${net.accent})` } : { background: "rgba(255,255,255,0.06)" }}
                >
                  {net?.token ?? "•"}
                </span>

                {/* Name + address */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <CardTitle className="truncate">{title}</CardTitle>
                    {m.is_default ? (
                      <span className="shrink-0 rounded-full bg-[var(--color-q4w-primary)]/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-q4w-primary)]">
                        Default
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-0.5 truncate font-mono text-[11px] text-[var(--color-q4w-muted)]">
                    {maskAddress(addr)}
                  </div>
                  <div className="mt-0.5 text-[11px] text-[var(--color-q4w-muted)]">
                    {net ? net.chain : legacy ?? "Legacy"}
                  </div>
                </div>

                {/* Status */}
                <StatusChip status={m.status} />
              </div>

              {m.rejected_reason ? (
                <div className="mt-3 rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                  ✕ {m.rejected_reason}
                </div>
              ) : null}

              {/* Actions */}
              {(!m.is_default && m.status === "active") || m.status !== "active" ? (
                <div className="mt-3 flex gap-2 border-t border-white/5 pt-3">
                  {!m.is_default && m.status === "active" ? (
                    <form action={setDefaultAction}>
                      <input type="hidden" name="id" value={m.id} />
                      <button
                        type="submit"
                        className="glass flex items-center gap-1.5 rounded-xl border border-white/10 px-3 py-1.5 text-xs text-[var(--color-q4w-text)] transition hover:bg-white/10"
                      >
                        <ShieldCheck className="h-3 w-3 opacity-70" /> Set as default
                      </button>
                    </form>
                  ) : null}
                  {m.status !== "active" ? (
                    <form action={deleteMethodAction}>
                      <input type="hidden" name="id" value={m.id} />
                      <button
                        type="submit"
                        className="flex items-center rounded-xl border border-rose-400/30 bg-rose-500/10 px-3 py-1.5 text-xs text-rose-300 transition hover:bg-rose-500/20"
                      >
                        Remove
                      </button>
                    </form>
                  ) : null}
                </div>
              ) : null}
            </Card>
          );
        })}
      </div>

      {/* ── Add a new wallet ──────────────────────────────────────────────── */}
      <div className="mb-1 px-1">
        <span className="text-[11px] uppercase tracking-widest text-white/40">Add a wallet</span>
      </div>
      <AddWalletForm />
    </>
  );
}
