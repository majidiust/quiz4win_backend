import Link from "next/link";
import { Wallet, ChevronRight, Clock, CheckCircle2, DollarSign } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/status-badge";
import { StatCard } from "@/components/stat-card";
import { DataTablePagination } from "@/components/data-table-pagination";
import { PageHeader } from "@/components/shell/page-header";
import { EmptyState } from "@/components/empty-state";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { formatMoneyDecimal, formatNumber, formatRelative } from "@/lib/utils";
import { ExportButton } from "@/components/export-button";

function formatDuration(sec: number): string {
  if (!sec) return "—";
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  if (sec < 86400) return `${(sec / 3600).toFixed(1)}h`;
  return `${(sec / 86400).toFixed(1)}d`;
}

export const metadata = { title: "Withdrawals" };

const PAGE_SIZE = 25;

interface SearchParams { status?: string; page?: string }

export default async function WithdrawalsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireAdmin(["super_admin", "admin", "finance"]);
  const sp = await searchParams;
  const status = sp.status ?? "pending";
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10));
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const db = createSupabaseAdminClient();
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const [list, pendingC, completedC, pendingSum, recent] = await Promise.all([
    db
      .from("withdrawals")
      .select(
        "id, user_id, amount, method, status, aml_flagged, requested_at, reviewed_at, completed_at, profiles!withdrawals_user_id_fkey(email, full_name)",
        { count: "exact" },
      )
      .eq("status", status)
      .order("requested_at", { ascending: false })
      .range(from, to),
    db.from("withdrawals").select("id", { count: "exact", head: true }).eq("status", "pending"),
    db.from("withdrawals").select("id", { count: "exact", head: true }).eq("status", "completed"),
    db.from("withdrawals").select("amount").eq("status", "pending"),
    db.from("withdrawals").select("requested_at, completed_at").gte("completed_at", since).not("completed_at", "is", null),
  ]);
  const { data, count, error } = list;
  if (error) throw error;
  const totalPending = ((pendingSum.data ?? []) as Array<{ amount: string | number }>).reduce((a, r) => a + Number(r.amount ?? 0), 0);
  const completedRows = (recent.data ?? []) as Array<{ requested_at: string; completed_at: string }>;
  const totalMs = completedRows.reduce((a, r) => a + (new Date(r.completed_at).getTime() - new Date(r.requested_at).getTime()), 0);
  const avgProcSec = completedRows.length ? Math.round(totalMs / 1000 / completedRows.length) : 0;

  const tabs = ["pending", "processing", "completed", "rejected"];

  return (
    <>
      <PageHeader
        title="Withdrawals"
        description="Player cash-outs awaiting review, processing, or settled."
        actions={<ExportButton href="/api/exports/finance/withdrawals" />}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Pending" value={formatNumber(pendingC.count ?? 0)} icon={Wallet} hint="awaiting review" />
        <StatCard label="Pending amount" value={formatMoneyDecimal(totalPending)} icon={DollarSign} hint="total queued" />
        <StatCard label="Completed" value={formatNumber(completedC.count ?? 0)} icon={CheckCircle2} hint="all time" />
        <StatCard label="Avg processing" value={formatDuration(avgProcSec)} icon={Clock} hint={`${completedRows.length} completed · 30d`} />
      </div>

      <div className="mb-3 inline-flex rounded-md border p-0.5 text-sm">
        {tabs.map((t) => (
          <Link
            key={t}
            href={`/finance/withdrawals?status=${t}`}
            className={`rounded px-3 py-1 text-xs font-medium capitalize ${
              status === t ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t}
          </Link>
        ))}
      </div>

      <Card className="overflow-hidden">
        {data && data.length > 0 ? (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Player</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Flags</TableHead>
                  <TableHead>Requested</TableHead>
                  <TableHead>Reviewed</TableHead>
                  <TableHead className="text-right">Review</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((w) => {
                  const p = (w.profiles as unknown as { email?: string; full_name?: string } | null) ?? null;
                  return (
                    <TableRow key={w.id}>
                      <TableCell>
                        <Link href={`/finance/withdrawals/${w.id}`} className="hover:underline">
                          <div className="text-sm font-medium">{p?.full_name ?? "—"}</div>
                          <div className="text-xs text-muted-foreground">{p?.email}</div>
                        </Link>
                      </TableCell>
                      <TableCell className="text-sm">{w.method.replace(/_/g, " ")}</TableCell>
                      <TableCell className="font-mono text-xs">{formatMoneyDecimal(w.amount)}</TableCell>
                      <TableCell>
                        {w.aml_flagged ? <StatusBadge value="aml" /> : <span className="text-xs text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{formatRelative(w.requested_at)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{formatRelative(w.reviewed_at)}</TableCell>
                      <TableCell className="text-right">
                        <Button asChild variant="ghost" size="sm">
                          <Link href={`/finance/withdrawals/${w.id}`}>
                            {w.status === "pending" ? "Review" : "Open"} <ChevronRight className="size-3.5" />
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <DataTablePagination page={page} pageSize={PAGE_SIZE} total={count ?? 0} basePath="/finance/withdrawals" searchParams={{ status }} />
          </>
        ) : (
          <EmptyState icon={Wallet} title={`No ${status} withdrawals`} />
        )}
      </Card>
    </>
  );
}
