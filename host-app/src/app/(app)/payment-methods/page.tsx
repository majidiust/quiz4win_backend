import { Card, CardSubtitle, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
import { PageHeader } from "@/components/page-header";
import { api } from "@/lib/api";
import { addMethodAction, deleteMethodAction, setDefaultAction } from "./actions";

export const metadata = { title: "Payment methods — Quiz4Win Host" };

interface Method {
  id: string; method_type: string; label: string | null;
  account_details: Record<string, string>; status: string; is_default: boolean;
  rejected_reason?: string | null;
}

const METHOD_LABELS: Record<string, string> = {
  iban: "IBAN", bank_account: "Bank account", paypal: "PayPal",
  usdt_trc20: "USDT (TRC20)", usdt_erc20: "USDT (ERC20)", btc: "BTC", other: "Other",
};

export default async function PaymentMethodsPage({
  searchParams,
}: { searchParams: Promise<{ error?: string; info?: string }> }) {
  const sp = await searchParams;
  const r = await api<{ methods: Method[] }>("/host/payment-methods");
  const methods = r.ok ? r.data?.methods ?? [] : [];

  return (
    <>
      <PageHeader title="Payment methods" subtitle="How we pay you out" />

      {sp.error ? (
        <div className="mb-3 rounded-2xl border border-[var(--color-q4w-danger)]/40 bg-[var(--color-q4w-danger)]/10 px-3 py-2 text-xs text-rose-300">{sp.error}</div>
      ) : null}
      {sp.info ? (
        <div className="mb-3 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">{sp.info}</div>
      ) : null}

      <div className="flex flex-col gap-3">
        {methods.length === 0 ? (
          <Card><CardSubtitle>No payment methods yet. Add one below.</CardSubtitle></Card>
        ) : methods.map((m) => (
          <Card key={m.id}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <CardTitle>{m.label || METHOD_LABELS[m.method_type] || m.method_type}</CardTitle>
                <div className="mt-0.5 text-[11px] text-[var(--color-q4w-muted)]">{METHOD_LABELS[m.method_type] ?? m.method_type}</div>
              </div>
              <div className="flex flex-col items-end gap-1">
                <StatusChip status={m.status} />
                {m.is_default ? <span className="text-[10px] uppercase tracking-wider text-[var(--color-q4w-primary)]">default</span> : null}
              </div>
            </div>
            {m.rejected_reason ? (
              <div className="mt-2 text-xs text-rose-300">Rejected: {m.rejected_reason}</div>
            ) : null}
            <div className="mt-3 flex gap-2">
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
        ))}
      </div>

      <Card className="mt-4">
        <CardTitle className="mb-2">Add new method</CardTitle>
        <form action={addMethodAction} className="flex flex-col gap-3">
          <label className="block">
            <div className="mb-1.5 ml-1 text-xs font-medium text-[var(--color-q4w-muted)]">Type</div>
            <select name="method_type" defaultValue="iban"
              className="h-12 w-full rounded-2xl border border-[var(--color-q4w-border)] bg-[var(--color-q4w-glass)] px-4 text-sm">
              {Object.entries(METHOD_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <Input label="Label (optional)" name="label" placeholder="e.g. Primary EUR account" />
          <Input label="Account holder" name="account_holder" />
          <Input label="IBAN / account number" name="iban" />
          <Input label="SWIFT / BIC" name="swift" />
          <Input label="Bank name" name="bank_name" />
          <Input label="PayPal email / crypto address" name="email" />
          <Input label="Network (for crypto)" name="network" placeholder="TRC20 / ERC20 / Bitcoin" />
          <Input label="Memo / tag" name="memo" />
          <Input label="Country" name="country" />
          <label className="glass flex cursor-pointer items-center gap-2 rounded-2xl px-4 py-3 text-sm">
            <input type="checkbox" name="is_default" className="accent-[var(--color-q4w-primary)]" />
            Set as default after verification
          </label>
          <Button type="submit">Save method</Button>
        </form>
      </Card>
    </>
  );
}
