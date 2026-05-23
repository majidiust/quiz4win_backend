import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { PageHeader } from "@/components/shell/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { formatDateTime, formatMoneyDecimal, formatRelative } from "@/lib/utils";
import { WithdrawalActions } from "./withdrawal-actions";

export const metadata = { title: "Withdrawal" };

interface ProfileShape {
  email?: string | null;
  full_name?: string | null;
  country?: string | null;
  kyc_status?: string | null;
  wallet_balance?: string | number | null;
}

export default async function WithdrawalDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin(["super_admin", "admin", "finance"]);
  const { id } = await params;
  const db = createSupabaseAdminClient();

  const { data: w, error } = await db
    .from("withdrawals")
    .select(
      "id, user_id, amount, method, account_details, status, aml_flagged, rejection_reason, transaction_reference, internal_note, requested_at, reviewed_at, completed_at, profiles!withdrawals_user_id_fkey(email, full_name, country, kyc_status, wallet_balance)",
    )
    .eq("id", id)
    .maybeSingle();
  if (error || !w) notFound();

  const profile = (w.profiles as unknown as ProfileShape | null) ?? null;

  // Recent withdrawal history for the same player (context).
  const { data: history } = await db
    .from("withdrawals")
    .select("id, amount, method, status, requested_at, completed_at")
    .eq("user_id", w.user_id)
    .neq("id", id)
    .order("requested_at", { ascending: false })
    .limit(8);

  const accountDetails =
    typeof w.account_details === "string"
      ? safeParse(w.account_details)
      : (w.account_details as Record<string, unknown> | null);

  return (
    <>
      <PageHeader
        title={`Withdrawal · ${formatMoneyDecimal(w.amount)}`}
        description={`${w.method.replace(/_/g, " ")} · requested ${formatRelative(w.requested_at)}`}
        actions={
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href="/finance/withdrawals"><ArrowLeft className="size-4" /> Back to queue</Link>
            </Button>
            <WithdrawalActions id={w.id} status={w.status} />
          </div>
        }
      />

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle className="text-base">Request</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Status"><StatusBadge value={w.status} /></Row>
            <Row label="Amount"><span className="font-mono">{formatMoneyDecimal(w.amount)}</span></Row>
            <Row label="Method">{w.method.replace(/_/g, " ")}</Row>
            <Row label="AML flagged">{w.aml_flagged ? <StatusBadge value="aml" /> : <span className="text-muted-foreground">No</span>}</Row>
            <Row label="Requested">{formatDateTime(w.requested_at)}</Row>
            <Row label="Reviewed">{w.reviewed_at ? formatDateTime(w.reviewed_at) : "—"}</Row>
            <Row label="Completed">{w.completed_at ? formatDateTime(w.completed_at) : "—"}</Row>
            {w.transaction_reference ? <Row label="Bank ref"><span className="font-mono text-xs">{w.transaction_reference}</span></Row> : null}
            {w.rejection_reason ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
                <div className="flex items-center gap-2 text-xs font-medium text-destructive">
                  <AlertTriangle className="size-3.5" /> Rejection reason
                </div>
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
          <CardHeader><CardTitle className="text-base">Player</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Name">{profile?.full_name ?? "—"}</Row>
            <Row label="Email">{profile?.email ?? "—"}</Row>
            <Row label="Country">{profile?.country ?? "—"}</Row>
            <Row label="KYC"><StatusBadge value={profile?.kyc_status ?? "unknown"} /></Row>
            <Row label="Wallet"><span className="font-mono">{formatMoneyDecimal(profile?.wallet_balance)}</span></Row>
            <Button asChild variant="outline" size="sm" className="mt-2 w-full">
              <Link href={`/users/${w.user_id}`}>Open player profile</Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Destination</CardTitle></CardHeader>
          <CardContent>
            {accountDetails ? (
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                {Object.entries(accountDetails).map(([k, v]) => (
                  <Pair key={k} label={k}>{String(v ?? "—")}</Pair>
                ))}
              </dl>
            ) : (
              <p className="text-xs text-muted-foreground">No account details on file.</p>
            )}
          </CardContent>
        </Card>
      </section>

      <section className="mt-6">
        <Card>
          <CardHeader><CardTitle className="text-base">Recent withdrawals by this player</CardTitle></CardHeader>
          <CardContent className="px-0 pt-0">
            {history && history.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Amount</TableHead>
                    <TableHead>Method</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Requested</TableHead>
                    <TableHead>Completed</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.map((h) => (
                    <TableRow key={h.id}>
                      <TableCell className="font-mono text-xs">{formatMoneyDecimal(h.amount)}</TableCell>
                      <TableCell className="text-xs">{h.method.replace(/_/g, " ")}</TableCell>
                      <TableCell><StatusBadge value={h.status} /></TableCell>
                      <TableCell className="text-xs text-muted-foreground">{formatRelative(h.requested_at)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{formatRelative(h.completed_at)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="px-6 pb-4 text-xs text-muted-foreground">No prior withdrawals.</p>
            )}
          </CardContent>
        </Card>
      </section>
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

function Pair({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground capitalize">{label.replace(/_/g, " ")}</dt>
      <dd className="break-all font-mono text-[11px]">{children}</dd>
    </>
  );
}

function safeParse(s: string): Record<string, unknown> | null {
  try { return JSON.parse(s) as Record<string, unknown>; } catch { return null; }
}
