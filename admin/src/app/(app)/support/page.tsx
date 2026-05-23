import Link from "next/link";
import { LifeBuoy } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/status-badge";
import { DataTablePagination } from "@/components/data-table-pagination";
import { PageHeader } from "@/components/shell/page-header";
import { EmptyState } from "@/components/empty-state";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { formatRelative } from "@/lib/utils";

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

  const { data, count, error } = await q;
  if (error) throw error;

  const statuses = ["open", "in_progress", "resolved", "closed"];

  return (
    <>
      <PageHeader title="Support Tickets" description="Player conversations awaiting response." />

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
