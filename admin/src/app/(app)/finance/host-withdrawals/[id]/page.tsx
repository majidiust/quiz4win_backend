import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, AlertTriangle, Bitcoin, Copy } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { PageHeader } from "@/components/shell/page-header";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { formatDateTime, formatMoneyDecimal, formatRelative } from "@/lib/utils";
import { HostWithdrawalActions } from "./host-withdrawal-actions";

export const metadata = { title: "Host Payout" };

export default async function HostWithdrawalDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin(["super_admin", "admin", "finance"]);
  const { id } = await params;
  const db = createSupabaseAdminClient();

  const { data: w, error } = await db
    .from("host_withdrawals")
    .select("*, show_hosts!host_withdrawals_host_id_fkey(id, name, application_status, status, auth_user_id), host_payment_methods!host_withdrawals_payment_method_id_fkey(method_type, label, account_details, status)")
    .eq("id", id)
    .maybeSingle();
  if (error || !w) notFound();

  const host = (w.show_hosts as unknown as { id?: string; name?: string; application_status?: string; status?: string; auth_user_id?: string } | null) ?? null;
  const pm = (w.host_payment_methods as unknown as { method_type?: string; label?: string; account_details?: Record<string, string> | null; status?: string } | null) ?? null;

  // Recent withdrawal history for the same host
  const { data: history } = await db
    .from("host_withdrawals")
    .select("id, amount, crypto_coin, crypto_network, status, requested_at, completed_at")
    .eq("host_id", w.host_id)
    .neq("id", id)
    .order("requested_at", { ascending: false })
    .limit(8);

  return (
    <>
      <PageHeader
        title={`Host Payout · ${formatMoneyDecimal(w.amount)}`}
        description={`${w.crypto_coin ?? "crypto"} · requested ${formatRelative(w.requested_at)}`}
        actions={
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href="/finance/host-withdrawals"><ArrowLeft className="size-4" /> Back</Link>
            </Button>
            <HostWithdrawalActions id={w.id} status={w.status} />
          </div>
        }
      />

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle className="text-base">Request</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Status"><StatusBadge value={w.status} /></Row>
            <Row label="Amount"><span className="font-mono">{formatMoneyDecimal(w.amount)}</span></Row>
            <Row label="Requested">{formatDateTime(w.requested_at)}</Row>
            <Row label="Reviewed">{w.reviewed_at ? formatDateTime(w.reviewed_at) : "—"}</Row>
            <Row label="Completed">{w.completed_at ? formatDateTime(w.completed_at) : "—"}</Row>
            {w.transaction_reference ? <Row label="TX hash"><span className="break-all font-mono text-xs">{w.transaction_reference}</span></Row> : null}
            {w.note ? <Row label="Host note"><span className="text-xs">{w.note}</span></Row> : null}
            {w.rejection_reason ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
                <div className="flex items-center gap-2 text-xs font-medium text-destructive"><AlertTriangle className="size-3.5" /> Rejection reason</div>
                <p className="mt-1 text-xs text-muted-foreground">{w.rejection_reason}</p>
              </div>
            ) : null}
            {w.internal_note ? (
              <div className="rounded-md border bg-muted/40 p-3 text-xs">
                <div className="mb-1 font-medium">Internal note</div>
                <p className="text-muted-foreground">{w.internal_note}</p>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Host</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Name">{host?.name ?? "—"}</Row>
            <Row label="App status"><StatusBadge value={host?.application_status ?? null} /></Row>
            <Row label="Account"><StatusBadge value={host?.status ?? null} /></Row>
            {host?.id ? (
              <Button asChild variant="outline" size="sm" className="mt-2 w-full">
                <Link href={`/hosts/${host.id}`}>Open host profile</Link>
              </Button>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              Destination
              {w.crypto_coin ? (
                <Badge variant="outline" className="gap-1 px-1.5 py-0 text-[11px] font-mono">
                  <Bitcoin className="size-3" />{w.crypto_coin}
                  {w.crypto_network ? <span className="ml-1 text-muted-foreground">· {w.crypto_network}</span> : null}
                </Badge>
              ) : null}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {pm ? (
              <Row label="Method">{pm.label ?? (pm.method_type?.replace(/_/g, " ") ?? "—")}</Row>
            ) : null}
            {w.crypto_address ? (
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Wallet address</p>
                <div className="flex items-start gap-2 rounded-md border bg-muted/40 p-2">
                  <code className="flex-1 break-all text-[11px] leading-relaxed">{w.crypto_address}</code>
                  <Copy className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </section>

      {history && history.length > 0 ? (
        <section className="mt-6">
          <Card>
            <CardHeader><CardTitle className="text-base">Recent payouts by this host</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto p-0">
              <table className="w-full text-sm">
                <thead><tr className="border-b text-xs text-muted-foreground">
                  <th className="px-4 py-2 text-left">Amount</th><th className="px-4 py-2 text-left">Coin</th>
                  <th className="px-4 py-2 text-left">Status</th><th className="px-4 py-2 text-left">Requested</th>
                </tr></thead>
                <tbody>
                  {history.map((h) => (
                    <tr key={h.id} className="border-b last:border-0">
                      <td className="px-4 py-2 font-mono text-xs">{formatMoneyDecimal(h.amount)}</td>
                      <td className="px-4 py-2 text-xs">{h.crypto_coin ?? "—"}{h.crypto_network ? ` · ${h.crypto_network}` : ""}</td>
                      <td className="px-4 py-2"><StatusBadge value={h.status} /></td>
                      <td className="px-4 py-2 text-xs text-muted-foreground">{formatRelative(h.requested_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </section>
      ) : null}
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b py-1.5 last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}
