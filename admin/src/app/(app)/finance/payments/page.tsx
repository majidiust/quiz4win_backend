import Link from "next/link";
import { CreditCard } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/status-badge";
import { DataTablePagination } from "@/components/data-table-pagination";
import { PageHeader } from "@/components/shell/page-header";
import { EmptyState } from "@/components/empty-state";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { formatMoney, formatRelative } from "@/lib/utils";
import { ExportButton } from "@/components/export-button";

export const metadata = { title: "Payments" };

const PAGE_SIZE = 25;
const METHODS = ["mastercard", "crypto", "apple"];
const STATUSES = ["pending", "succeeded", "failed", "cancelled", "expired"];

interface SearchParams { method?: string; status?: string; page?: string }

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireAdmin(["super_admin", "admin", "finance"]);
  const sp = await searchParams;
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10));
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const db = createSupabaseAdminClient();
  let q = db
    .from("payments")
    .select(
      "id, user_id, method, amount_cents, currency, status, provider_short_id, created_at, profiles(email, full_name)",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range(from, to);

  if (sp.method) q = q.eq("method", sp.method);
  if (sp.status) q = q.eq("status", sp.status);

  const { data, count, error } = await q;
  if (error) throw error;

  return (
    <>
      <PageHeader
        title="Payments"
        description="Unified list of player top-ups and deposits."
        actions={<ExportButton href="/api/exports/finance/payments" />}
      />

      <div className="mb-4 flex flex-wrap items-center gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/finance/payments"
            className={`rounded-md border px-3 py-1 text-xs capitalize ${!sp.method ? "bg-muted" : "text-muted-foreground"}`}
          >
            All Methods
          </Link>
          {METHODS.map((m) => (
            <Link
              key={m}
              href={`/finance/payments?method=${m}${sp.status ? `&status=${sp.status}` : ""}`}
              className={`rounded-md border px-3 py-1 text-xs capitalize ${sp.method === m ? "bg-muted" : "text-muted-foreground"}`}
            >
              {m}
            </Link>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/finance/payments"
            className={`rounded-md border px-3 py-1 text-xs capitalize ${!sp.status ? "bg-muted" : "text-muted-foreground"}`}
          >
            All Statuses
          </Link>
          {STATUSES.map((s) => (
            <Link
              key={s}
              href={`/finance/payments?status=${s}${sp.method ? `&method=${sp.method}` : ""}`}
              className={`rounded-md border px-3 py-1 text-xs capitalize ${sp.status === s ? "bg-muted" : "text-muted-foreground"}`}
            >
              {s}
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
                  <TableHead>Player</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((p) => {
                  const profile = (p.profiles as unknown as { email?: string; full_name?: string } | null) ?? null;
                  return (
                    <TableRow key={p.id}>
                      <TableCell>
                        <Link href={`/users/${p.user_id}`} className="hover:underline">
                          <div className="text-sm font-medium">{profile?.full_name ?? "—"}</div>
                          <div className="text-xs text-muted-foreground">{profile?.email}</div>
                        </Link>
                      </TableCell>
                      <TableCell className="text-sm capitalize">{p.method}</TableCell>
                      <TableCell className="font-mono text-xs">
                        <Link href={`/finance/payments/${p.id}`} className="hover:underline font-bold">
                          {formatMoney(p.amount_cents, p.currency)}
                        </Link>
                      </TableCell>
                      <TableCell><StatusBadge value={p.status} /></TableCell>
                      <TableCell className="font-mono text-[10px] text-muted-foreground uppercase">
                        <Link href={`/finance/payments/${p.id}`} className="hover:underline">
                          {p.provider_short_id ?? p.id.slice(0, 8)}
                        </Link>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{formatRelative(p.created_at)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <DataTablePagination
              page={page}
              pageSize={PAGE_SIZE}
              total={count ?? 0}
              basePath="/finance/payments"
              searchParams={{ method: sp.method, status: sp.status }}
            />
          </>
        ) : (
          <EmptyState icon={CreditCard} title="No payments found" />
        )}
      </Card>
    </>
  );
}
