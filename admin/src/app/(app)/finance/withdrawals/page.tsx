import Link from "next/link";
import { Wallet, ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/status-badge";
import { DataTablePagination } from "@/components/data-table-pagination";
import { PageHeader } from "@/components/shell/page-header";
import { EmptyState } from "@/components/empty-state";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { formatMoneyDecimal, formatRelative } from "@/lib/utils";

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
  const { data, count, error } = await db
    .from("withdrawals")
    .select(
      "id, user_id, amount, method, status, aml_flagged, requested_at, reviewed_at, completed_at, profiles!withdrawals_user_id_fkey(email, full_name)",
      { count: "exact" },
    )
    .eq("status", status)
    .order("requested_at", { ascending: false })
    .range(from, to);
  if (error) throw error;

  const tabs = ["pending", "processing", "completed", "rejected"];

  return (
    <>
      <PageHeader title="Withdrawals" description="Player cash-outs awaiting review, processing, or settled." />

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
