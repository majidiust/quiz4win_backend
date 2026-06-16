import Link from "next/link";
import { Users } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/status-badge";
import { PageHeader } from "@/components/shell/page-header";
import { EmptyState } from "@/components/empty-state";
import { DataTablePagination } from "@/components/data-table-pagination";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { formatRelative, formatNumber } from "@/lib/utils";

export const metadata = { title: "Hosts" };

const PAGE_SIZE = 25;
const STATUSES = ["pending", "approved", "rejected", "suspended"] as const;

interface SearchParams { application_status?: string; q?: string; page?: string }

export default async function HostsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAdmin(["super_admin", "admin", "moderator", "finance"]);
  const sp = await searchParams;
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10));
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const db = createSupabaseAdminClient();
  let q = db
    .from("show_hosts")
    .select(
      "id, name, avatar_url, country, languages, application_status, status, auth_user_id, total_earnings, shows_hosted, created_at, approved_at",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range(from, to);

  if (sp.application_status && STATUSES.includes(sp.application_status as typeof STATUSES[number])) {
    q = q.eq("application_status", sp.application_status);
  }
  if (sp.q) q = q.ilike("name", `%${sp.q}%`);

  const [list, pendingC] = await Promise.all([
    q,
    db.from("show_hosts").select("id", { count: "exact", head: true }).eq("application_status", "pending"),
  ]);

  const { data, count, error } = list;
  if (error) throw error;

  return (
    <>
      <PageHeader
        title="Hosts"
        description={`${formatNumber(pendingC.count ?? 0)} pending approval`}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Link
          href="/hosts"
          className={`rounded-md border px-3 py-1.5 text-xs ${!sp.application_status ? "border-foreground/40 bg-foreground/5" : "border-border"}`}
        >All</Link>
        {STATUSES.map((s) => (
          <Link
            key={s}
            href={`/hosts?application_status=${s}`}
            className={`rounded-md border px-3 py-1.5 text-xs ${sp.application_status === s ? "border-foreground/40 bg-foreground/5" : "border-border"}`}
          >{s}</Link>
        ))}
      </div>

      <Card className="overflow-hidden">
        {data && data.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Country</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Visibility</TableHead>
                <TableHead className="text-right">Earnings</TableHead>
                <TableHead className="text-right">Shows</TableHead>
                <TableHead>Applied</TableHead>
                <TableHead className="w-0"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((h) => (
                <TableRow key={h.id as string}>
                  <TableCell className="font-medium">
                    {h.name as string}
                    {h.auth_user_id ? null : (
                      <span className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-amber-600">
                        admin-managed
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{(h.country as string) ?? "—"}</TableCell>
                  <TableCell><StatusBadge value={h.application_status as string} /></TableCell>
                  <TableCell><StatusBadge value={h.status as string} /></TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatNumber(Number(h.total_earnings ?? 0))}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{(h.shows_hosted as number) ?? 0}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {h.created_at ? formatRelative(h.created_at as string) : "—"}
                  </TableCell>
                  <TableCell>
                    <Link href={`/hosts/${h.id}`} className="text-xs text-primary hover:underline">Open</Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <EmptyState icon={Users} title="No hosts yet" description="Approved hosts will appear here once they apply." />
        )}
      </Card>

      {count && count > PAGE_SIZE ? (
        <DataTablePagination total={count} pageSize={PAGE_SIZE} page={page} basePath="/hosts"
          searchParams={{ application_status: sp.application_status, q: sp.q }} />
      ) : null}
    </>
  );
}
