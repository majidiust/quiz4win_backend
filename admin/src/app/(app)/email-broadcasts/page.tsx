import Link from "next/link";
import { Bell, Plus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/status-badge";
import { DataTablePagination } from "@/components/data-table-pagination";
import { PageHeader } from "@/components/shell/page-header";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { formatDateTime, formatNumber } from "@/lib/utils";

export const metadata = { title: "Email Broadcasts" };
const PAGE_SIZE = 25;
interface SearchParams { page?: string }

export default async function EmailBroadcastsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireAdmin(["super_admin", "admin"]);
  const sp = await searchParams;
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10));
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const db = createSupabaseAdminClient();
  const { data, count, error } = await db
    .from("email_broadcasts")
    .select(
      "id, title, subject, target_segment, status, total_count, sent_count, error_count, scheduled_at, created_at",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error) throw error;

  const actions = (
    <Button asChild>
      <Link href="/email-broadcasts/new">
        <Plus className="mr-2 size-4" />
        New Broadcast
      </Link>
    </Button>
  );

  return (
    <>
      <PageHeader
        title="Email Broadcasts"
        description="Manage bulk email campaigns and track their delivery."
        actions={actions}
      />

      <Card className="overflow-hidden">
        {data && data.length > 0 ? (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title / Subject</TableHead>
                  <TableHead>Target</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Sent</TableHead>
                  <TableHead className="text-right">Errors</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((b) => (
                  <TableRow key={b.id} className="group cursor-pointer hover:bg-muted/50">
                    <TableCell className="relative">
                      <Link href={`/email-broadcasts/${b.id}`} className="absolute inset-0" />
                      <div className="text-sm font-medium">{b.title}</div>
                      <div className="max-w-md truncate text-xs text-muted-foreground">{b.subject}</div>
                    </TableCell>
                    <TableCell className="text-xs capitalize">{b.target_segment.replace(/_/g, " ")}</TableCell>
                    <TableCell><StatusBadge value={b.status} /></TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(b.total_count)}</TableCell>
                    <TableCell className="text-right tabular-nums text-success">{formatNumber(b.sent_count)}</TableCell>
                    <TableCell className="text-right tabular-nums text-destructive">{formatNumber(b.error_count)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatDateTime(b.created_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <DataTablePagination page={page} pageSize={PAGE_SIZE} total={count ?? 0} basePath="/email-broadcasts" />
          </>
        ) : (
          <EmptyState icon={Bell} title="No email broadcasts yet" description="Compose your first bulk email campaign." />
        )}
      </Card>
    </>
  );
}
