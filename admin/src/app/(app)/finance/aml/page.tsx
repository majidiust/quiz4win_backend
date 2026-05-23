import Link from "next/link";
import { AlertOctagon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/status-badge";
import { DataTablePagination } from "@/components/data-table-pagination";
import { PageHeader } from "@/components/shell/page-header";
import { EmptyState } from "@/components/empty-state";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { formatMoneyDecimal, formatRelative } from "@/lib/utils";
import { AmlReview } from "./aml-review";

export const metadata = { title: "AML Flags" };

const PAGE_SIZE = 25;
interface SearchParams { status?: string; page?: string }

export default async function AmlPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireAdmin(["super_admin", "admin", "finance"]);
  const sp = await searchParams;
  const status = sp.status ?? "open";
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10));
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const db = createSupabaseAdminClient();
  const { data, count, error } = await db
    .from("aml_flags")
    .select(
      "id, user_id, withdrawal_id, total_24h_usd, status, review_note, flagged_at, reviewed_at, profiles!aml_flags_user_id_fkey(email, full_name, country)",
      { count: "exact" },
    )
    .eq("status", status)
    .order("flagged_at", { ascending: false })
    .range(from, to);
  if (error) throw error;

  const tabs = ["open", "escalated", "cleared"];

  return (
    <>
      <PageHeader title="AML Flags" description="High-risk patterns automatically detected on player accounts." />

      <div className="mb-3 inline-flex rounded-md border p-0.5 text-sm">
        {tabs.map((t) => (
          <Link
            key={t}
            href={`/finance/aml?status=${t}`}
            className={`rounded px-3 py-1 text-xs font-medium capitalize ${status === t ? "bg-muted" : "text-muted-foreground"}`}
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
                  <TableHead>24h volume</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Note</TableHead>
                  <TableHead>Flagged</TableHead>
                  <TableHead>Reviewed</TableHead>
                  {status === "open" ? <TableHead className="text-right">Actions</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((a) => {
                  const p = (a.profiles as unknown as { email?: string; full_name?: string; country?: string } | null) ?? null;
                  return (
                    <TableRow key={a.id}>
                      <TableCell>
                        <Link href={`/users/${a.user_id}`} className="hover:underline">
                          <div className="text-sm font-medium">{p?.full_name ?? "—"}</div>
                          <div className="text-xs text-muted-foreground">{p?.email}{p?.country ? ` · ${p.country}` : ""}</div>
                        </Link>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{formatMoneyDecimal(a.total_24h_usd)}</TableCell>
                      <TableCell><StatusBadge value={a.status} /></TableCell>
                      <TableCell className="max-w-xs truncate text-xs text-muted-foreground">{a.review_note ?? "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{formatRelative(a.flagged_at)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{formatRelative(a.reviewed_at)}</TableCell>
                      {status === "open" ? (
                        <TableCell className="text-right"><AmlReview flagId={a.id} /></TableCell>
                      ) : null}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <DataTablePagination page={page} pageSize={PAGE_SIZE} total={count ?? 0} basePath="/finance/aml" searchParams={{ status }} />
          </>
        ) : (
          <EmptyState icon={AlertOctagon} title={`No ${status} AML flags`} />
        )}
      </Card>
    </>
  );
}
