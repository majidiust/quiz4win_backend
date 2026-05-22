import Link from "next/link";
import { Ticket } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/status-badge";
import { SearchInput } from "@/components/search-input";
import { DataTablePagination } from "@/components/data-table-pagination";
import { PageHeader } from "@/components/shell/page-header";
import { EmptyState } from "@/components/empty-state";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { formatDateTime, formatMoneyDecimal, formatNumber } from "@/lib/utils";

export const metadata = { title: "Vouchers" };
const PAGE_SIZE = 25;

interface SearchParams { q?: string; status?: string; type?: string; page?: string }

export default async function VouchersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireAdmin(["super_admin", "admin"]);
  const sp = await searchParams;
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10));
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const db = createSupabaseAdminClient();
  let q = db
    .from("vouchers")
    .select(
      "id, code, name, type, reward_type, reward_value, status, redemption_count, max_redemptions, valid_from, valid_until, created_at",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range(from, to);
  if (sp.q) q = q.or(`code.ilike.%${sp.q}%,name.ilike.%${sp.q}%`);
  if (sp.status) q = q.eq("status", sp.status);
  if (sp.type) q = q.eq("type", sp.type);

  const { data, count, error } = await q;
  if (error) throw error;

  return (
    <>
      <PageHeader title="Vouchers" description="Promo codes, partner offers, and free-entry vouchers." />

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3">
          <SearchInput placeholder="Search code or name…" />
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {["active", "paused", "exhausted", "expired", "cancelled"].map((s) => (
              <Link
                key={s}
                href={`/vouchers?status=${s}`}
                className={`rounded border px-2 py-0.5 capitalize ${sp.status === s ? "bg-muted" : "text-muted-foreground"}`}
              >
                {s}
              </Link>
            ))}
          </div>
        </div>

        {data && data.length > 0 ? (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Reward</TableHead>
                  <TableHead className="text-right">Redeemed</TableHead>
                  <TableHead>Validity</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((v) => (
                  <TableRow key={v.id}>
                    <TableCell className="font-mono text-xs">{v.code}</TableCell>
                    <TableCell className="text-sm">{v.name}</TableCell>
                    <TableCell className="text-xs capitalize">{v.type}</TableCell>
                    <TableCell className="text-xs">
                      <span className="capitalize">{v.reward_type?.replace(/_/g, " ") ?? "—"}</span>
                      {v.reward_value ? <span className="ml-1 font-mono">{formatMoneyDecimal(v.reward_value)}</span> : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatNumber(v.redemption_count)}
                      {v.max_redemptions ? <span className="text-muted-foreground">/{formatNumber(v.max_redemptions)}</span> : null}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {v.valid_from ? formatDateTime(v.valid_from) : "—"}
                      {v.valid_until ? <> → {formatDateTime(v.valid_until)}</> : null}
                    </TableCell>
                    <TableCell><StatusBadge value={v.status} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <DataTablePagination
              page={page}
              pageSize={PAGE_SIZE}
              total={count ?? 0}
              basePath="/vouchers"
              searchParams={{ q: sp.q, status: sp.status, type: sp.type }}
            />
          </>
        ) : (
          <EmptyState icon={Ticket} title="No vouchers match these filters" />
        )}
      </Card>
    </>
  );
}
