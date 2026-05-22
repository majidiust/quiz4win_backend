import Link from "next/link";
import { Banknote } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/status-badge";
import { DataTablePagination } from "@/components/data-table-pagination";
import { PageHeader } from "@/components/shell/page-header";
import { EmptyState } from "@/components/empty-state";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { formatMoneyDecimal, formatRelative } from "@/lib/utils";

export const metadata = { title: "Transactions" };

const PAGE_SIZE = 25;

const TYPES = ["topup", "withdrawal", "game_entry_fee", "prize", "referral_bonus", "refund", "admin_adjustment"];

interface SearchParams { type?: string; status?: string; page?: string }

export default async function TransactionsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireAdmin(["super_admin", "admin", "finance"]);
  const sp = await searchParams;
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10));
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const db = createSupabaseAdminClient();
  let q = db
    .from("transactions")
    .select(
      "id, user_id, type, amount, status, description, created_at, profiles!transactions_user_id_fkey(email, full_name)",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range(from, to);
  if (sp.type) q = q.eq("type", sp.type);
  if (sp.status) q = q.eq("status", sp.status);

  const { data, count, error } = await q;
  if (error) throw error;

  return (
    <>
      <PageHeader title="Transactions" description="Append-only ledger of every monetary movement." />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Link
          href="/finance/transactions"
          className={`rounded-md border px-3 py-1 text-xs capitalize ${!sp.type ? "bg-muted" : "text-muted-foreground"}`}
        >
          All
        </Link>
        {TYPES.map((t) => (
          <Link
            key={t}
            href={`/finance/transactions?type=${t}`}
            className={`rounded-md border px-3 py-1 text-xs capitalize ${sp.type === t ? "bg-muted" : "text-muted-foreground"}`}
          >
            {t.replace(/_/g, " ")}
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
                  <TableHead>Type</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((t) => {
                  const p = (t.profiles as unknown as { email?: string; full_name?: string } | null) ?? null;
                  return (
                    <TableRow key={t.id}>
                      <TableCell>
                        <Link href={`/users/${t.user_id}`} className="hover:underline">
                          <div className="text-sm font-medium">{p?.full_name ?? "—"}</div>
                          <div className="text-xs text-muted-foreground">{p?.email}</div>
                        </Link>
                      </TableCell>
                      <TableCell className="text-sm capitalize">{t.type.replace(/_/g, " ")}</TableCell>
                      <TableCell className="font-mono text-xs">{formatMoneyDecimal(t.amount)}</TableCell>
                      <TableCell><StatusBadge value={t.status} /></TableCell>
                      <TableCell className="max-w-xs truncate text-xs text-muted-foreground">{t.description ?? "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{formatRelative(t.created_at)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <DataTablePagination page={page} pageSize={PAGE_SIZE} total={count ?? 0} basePath="/finance/transactions" searchParams={{ type: sp.type, status: sp.status }} />
          </>
        ) : (
          <EmptyState icon={Banknote} title="No transactions" />
        )}
      </Card>
    </>
  );
}
