import Link from "next/link";
import { LifeBuoy, Inbox, CheckCircle2, Clock } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/status-badge";
import { StatCard } from "@/components/stat-card";
import { DataTablePagination } from "@/components/data-table-pagination";
import { PageHeader } from "@/components/shell/page-header";
import { EmptyState } from "@/components/empty-state";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { formatNumber, formatRelative } from "@/lib/utils";
import { ExportButton } from "@/components/export-button";

function formatDuration(sec: number): string {
  if (!sec) return "—";
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  if (sec < 86400) return `${(sec / 3600).toFixed(1)}h`;
  return `${(sec / 86400).toFixed(1)}d`;
}

export const metadata = { title: "Support Tickets" };
const PAGE_SIZE = 25;

interface SearchParams { status?: string; category?: string; page?: string }

export default async function SupportPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireAdmin(["super_admin", "admin", "support"]);
  const sp = await searchParams;
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10));
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const db = createSupabaseAdminClient();
  let q = db
    .from("support_tickets")
    .select(
      "id, ticket_number, subject, category, status, created_at, user_id, profiles!support_tickets_user_id_fkey(email, full_name)",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range(from, to);
  if (sp.status) q = q.eq("status", sp.status);
  if (sp.category) q = q.eq("category", sp.category);

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const [list, openC, inProgC, resolvedC, recent] = await Promise.all([
    q,
    db.from("support_tickets").select("id", { count: "exact", head: true }).eq("status", "open"),
    db.from("support_tickets").select("id", { count: "exact", head: true }).eq("status", "in_progress"),
    db.from("support_tickets").select("id", { count: "exact", head: true }).eq("status", "resolved"),
    db.from("support_tickets").select("status, created_at, updated_at").gte("updated_at", since).in("status", ["resolved", "closed"]),
  ]);
  const { data, count, error } = list;
  if (error) throw error;
  const reslv = (recent.data ?? []) as Array<{ created_at: string; updated_at: string }>;
  const totalMs = reslv.reduce((a, r) => a + (new Date(r.updated_at).getTime() - new Date(r.created_at).getTime()), 0);
  const avgResSec = reslv.length ? Math.round(totalMs / 1000 / reslv.length) : 0;

  const statuses = ["open", "in_progress", "resolved", "closed"];

  return (
    <>
      <PageHeader
        title="Support Tickets"
        description="Player conversations awaiting response."
        actions={<ExportButton href="/api/exports/support" />}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Open" value={formatNumber(openC.count ?? 0)} icon={Inbox} hint="awaiting first response" />
        <StatCard label="In progress" value={formatNumber(inProgC.count ?? 0)} icon={LifeBuoy} hint="with agent" />
        <StatCard label="Resolved" value={formatNumber(resolvedC.count ?? 0)} icon={CheckCircle2} hint="all time" />
        <StatCard label="Avg resolution" value={formatDuration(avgResSec)} icon={Clock} hint={`${reslv.length} resolved · 30d`} />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Link href="/support" className={`rounded-md border px-3 py-1 text-xs ${!sp.status ? "bg-muted" : "text-muted-foreground"}`}>All</Link>
        {statuses.map((s) => (
          <Link
            key={s}
            href={`/support?status=${s}`}
            className={`rounded-md border px-3 py-1 text-xs capitalize ${sp.status === s ? "bg-muted" : "text-muted-foreground"}`}
          >
            {s.replace(/_/g, " ")}
          </Link>
        ))}
      </div>

      <Card className="overflow-hidden">
        {data && data.length > 0 ? (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ticket</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Player</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Opened</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((t) => {
                  const p = (t.profiles as unknown as { email?: string; full_name?: string } | null) ?? null;
                  return (
                    <TableRow key={t.id}>
                      <TableCell className="font-mono text-xs">
                        <Link href={`/support/${t.id}`} className="hover:underline">{t.ticket_number}</Link>
                      </TableCell>
                      <TableCell className="max-w-md truncate text-sm">
                        <Link href={`/support/${t.id}`} className="hover:underline">{t.subject}</Link>
                      </TableCell>
                      <TableCell>
                        <Link href={`/users/${t.user_id}`} className="text-xs hover:underline">
                          <div>{p?.full_name ?? "—"}</div>
                          <div className="text-muted-foreground">{p?.email}</div>
                        </Link>
                      </TableCell>
                      <TableCell className="text-xs capitalize">{t.category}</TableCell>
                      <TableCell><StatusBadge value={t.status} /></TableCell>
                      <TableCell className="text-xs text-muted-foreground">{formatRelative(t.created_at)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <DataTablePagination
              page={page}
              pageSize={PAGE_SIZE}
              total={count ?? 0}
              basePath="/support"
              searchParams={{ status: sp.status, category: sp.category }}
            />
          </>
        ) : (
          <EmptyState icon={LifeBuoy} title="No tickets match the current filters" />
        )}
      </Card>
    </>
  );
}
