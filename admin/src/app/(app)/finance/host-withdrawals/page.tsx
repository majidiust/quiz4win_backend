import Link from "next/link";
import { Wallet, ChevronRight, Clock, CheckCircle2, DollarSign, Bitcoin } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/status-badge";
import { StatCard } from "@/components/stat-card";
import { DataTablePagination } from "@/components/data-table-pagination";
import { PageHeader } from "@/components/shell/page-header";
import { EmptyState } from "@/components/empty-state";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { formatMoneyDecimal, formatNumber, formatRelative } from "@/lib/utils";

export const metadata = { title: "Host Payouts" };

const PAGE_SIZE = 25;
interface SearchParams { status?: string; page?: string }

export default async function HostWithdrawalsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireAdmin(["super_admin", "admin", "finance"]);
  const sp = await searchParams;
  const status = sp.status ?? "pending";
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10));
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const db = createSupabaseAdminClient();

  const [list, pendingC, completedC, pendingSum] = await Promise.all([
    db.from("host_withdrawals")
      .select("id, host_id, amount, currency, status, crypto_coin, crypto_network, requested_at, reviewed_at, show_hosts!host_withdrawals_host_id_fkey(name)", { count: "exact" })
      .eq("status", status)
      .order("requested_at", { ascending: false })
      .range(from, to),
    db.from("host_withdrawals").select("id", { count: "exact", head: true }).eq("status", "pending"),
    db.from("host_withdrawals").select("id", { count: "exact", head: true }).eq("status", "completed"),
    db.from("host_withdrawals").select("amount").eq("status", "pending"),
  ]);

  const { data, count, error } = list;
  if (error) throw error;

  const totalPending = ((pendingSum.data ?? []) as Array<{ amount: string | number }>)
    .reduce((a, r) => a + Number(r.amount ?? 0), 0);

  const tabs = ["pending", "processing", "completed", "rejected"];

  return (
    <>
      <PageHeader
        title="Host Payouts"
        description="Host payout requests awaiting review, processing, or settled."
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Pending" value={formatNumber(pendingC.count ?? 0)} icon={Wallet} hint="awaiting review" />
        <StatCard label="Pending amount" value={formatMoneyDecimal(totalPending)} icon={DollarSign} hint="total queued" />
        <StatCard label="Completed" value={formatNumber(completedC.count ?? 0)} icon={CheckCircle2} hint="all time" />
        <StatCard label="Min amount" value="$10.00" icon={Clock} hint="per request" />
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-md border p-0.5 text-sm">
          {tabs.map((t) => (
            <Link
              key={t}
              href={`/finance/host-withdrawals?status=${t}`}
              className={`rounded px-3 py-1 text-xs font-medium capitalize ${
                status === t ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.replace(/_/g, " ")}
            </Link>
          ))}
        </div>
      </div>

      <Card className="overflow-hidden">
        {data && data.length > 0 ? (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Host</TableHead>
                  <TableHead>Coin / Network</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Requested</TableHead>
                  <TableHead>Reviewed</TableHead>
                  <TableHead className="text-right">Review</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((w) => {
                  const h = (w.show_hosts as unknown as { name?: string } | null) ?? null;
                  return (
                    <TableRow key={w.id}>
                      <TableCell>
                        <Link href={`/finance/host-withdrawals/${w.id}`} className="hover:underline">
                          <div className="text-sm font-medium">{h?.name ?? "—"}</div>
                        </Link>
                        <div className="text-xs text-muted-foreground font-mono">{w.host_id}</div>
                      </TableCell>
                      <TableCell>
                        {w.crypto_coin ? (
                          <div className="flex items-center gap-1">
                            <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-mono">
                              <Bitcoin className="mr-0.5 size-2.5" />{w.crypto_coin}
                            </Badge>
                            {w.crypto_network ? (
                              <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">{w.crypto_network}</Badge>
                            ) : null}
                          </div>
                        ) : <span className="text-xs text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{formatMoneyDecimal(w.amount)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{formatRelative(w.requested_at)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{formatRelative(w.reviewed_at)}</TableCell>
                      <TableCell className="text-right">
                        <Button asChild variant="ghost" size="sm">
                          <Link href={`/finance/host-withdrawals/${w.id}`}>
                            {w.status === "pending" ? "Review" : "Open"} <ChevronRight className="size-3.5" />
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <DataTablePagination page={page} pageSize={PAGE_SIZE} total={count ?? 0} basePath="/finance/host-withdrawals" searchParams={{ status }} />
          </>
        ) : (
          <EmptyState icon={Wallet} title={`No ${status} host payouts`} />
        )}
      </Card>
    </>
  );
}
