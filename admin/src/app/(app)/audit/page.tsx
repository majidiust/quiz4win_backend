import { History, Activity, Users, FileText } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatCard } from "@/components/stat-card";
import { DataTablePagination } from "@/components/data-table-pagination";
import { PageHeader } from "@/components/shell/page-header";
import { EmptyState } from "@/components/empty-state";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { formatNumber, formatRelative } from "@/lib/utils";
import { ExportButton } from "@/components/export-button";

export const metadata = { title: "Audit Log" };
const PAGE_SIZE = 50;
interface SearchParams { entity_type?: string; action?: string; page?: string }

export default async function AuditLogPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireAdmin(["super_admin"]);
  const sp = await searchParams;
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10));
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const db = createSupabaseAdminClient();
  let q = db
    .from("admin_audit_log")
    .select(
      "id, action, entity_type, entity_id, ip_address, created_at, admin_id, admin_users!admin_audit_log_admin_id_fkey(name, email)",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range(from, to);
  if (sp.entity_type) q = q.eq("entity_type", sp.entity_type);
  if (sp.action) q = q.eq("action", sp.action);

  const day = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const [list, totalC, last24C, recent] = await Promise.all([
    q,
    db.from("admin_audit_log").select("id", { count: "exact", head: true }),
    db.from("admin_audit_log").select("id", { count: "exact", head: true }).gte("created_at", day),
    db.from("admin_audit_log").select("admin_id, action").gte("created_at", since30d),
  ]);
  const { data, count, error } = list;
  if (error) throw error;
  const rows = (recent.data ?? []) as Array<{ admin_id: string; action: string }>;
  const byAction: Record<string, number> = {};
  const adminSet = new Set<string>();
  for (const r of rows) { byAction[r.action] = (byAction[r.action] ?? 0) + 1; adminSet.add(r.admin_id); }
  const topAction = Object.entries(byAction).sort((a, b) => b[1] - a[1])[0];

  return (
    <>
      <PageHeader
        title="Audit Log"
        description="Append-only record of every admin action."
        actions={<ExportButton href="/api/exports/audit" />}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total events" value={formatNumber(totalC.count ?? 0)} icon={History} hint="all time" />
        <StatCard label="Last 24h" value={formatNumber(last24C.count ?? 0)} icon={Activity} hint="recent activity" />
        <StatCard label="Active admins · 30d" value={formatNumber(adminSet.size)} icon={Users} hint={`${rows.length} events`} />
        <StatCard label="Top action" value={topAction ? topAction[0] : "—"} icon={FileText} hint={topAction ? `${formatNumber(topAction[1])} · 30d` : "no activity"} />
      </div>

      <Card className="overflow-hidden">
        {data && data.length > 0 ? (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Admin</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Entity</TableHead>
                  <TableHead>IP</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((e) => {
                  const a = (e.admin_users as unknown as { name?: string; email?: string } | null) ?? null;
                  return (
                    <TableRow key={e.id}>
                      <TableCell className="text-xs text-muted-foreground">{formatRelative(e.created_at)}</TableCell>
                      <TableCell>
                        <div className="text-sm font-medium">{a?.name ?? "—"}</div>
                        <div className="text-xs text-muted-foreground">{a?.email}</div>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{e.action}</TableCell>
                      <TableCell className="text-xs">
                        <span className="capitalize">{e.entity_type ?? "—"}</span>
                        {e.entity_id ? <span className="ml-1 text-muted-foreground">#{e.entity_id.slice(0, 8)}</span> : null}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{e.ip_address ?? "—"}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <DataTablePagination
              page={page}
              pageSize={PAGE_SIZE}
              total={count ?? 0}
              basePath="/audit"
              searchParams={{ entity_type: sp.entity_type, action: sp.action }}
            />
          </>
        ) : (
          <EmptyState icon={History} title="No audit entries match these filters" />
        )}
      </Card>
    </>
  );
}
