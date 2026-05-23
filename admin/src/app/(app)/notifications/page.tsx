import { Megaphone } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/status-badge";
import { DataTablePagination } from "@/components/data-table-pagination";
import { PageHeader } from "@/components/shell/page-header";
import { EmptyState } from "@/components/empty-state";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { formatDateTime, formatNumber } from "@/lib/utils";
import { SendBroadcastDialog } from "./send-broadcast-dialog";

export const metadata = { title: "Broadcasts" };
const PAGE_SIZE = 25;
interface SearchParams { page?: string }

export default async function BroadcastsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireAdmin(["super_admin", "admin"]);
  const sp = await searchParams;
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10));
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const db = createSupabaseAdminClient();
  const { data, count, error } = await db
    .from("notification_broadcasts")
    .select(
      "id, title, body, type, scheduled_at, sent_at, recipients_count, delivered_count, failed_count, created_at",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range(from, to);
  if (error) throw error;

  return (
    <>
      <PageHeader
        title="Broadcasts"
        description="Push notification campaigns sent to players."
        actions={<SendBroadcastDialog />}
      />

      <Card className="overflow-hidden">
        {data && data.length > 0 ? (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Recipients</TableHead>
                  <TableHead className="text-right">Delivered</TableHead>
                  <TableHead className="text-right">Failed</TableHead>
                  <TableHead>Scheduled</TableHead>
                  <TableHead>Sent</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell>
                      <div className="text-sm font-medium">{b.title}</div>
                      <div className="max-w-md truncate text-xs text-muted-foreground">{b.body}</div>
                    </TableCell>
                    <TableCell><StatusBadge value={b.type} /></TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(b.recipients_count)}</TableCell>
                    <TableCell className="text-right tabular-nums text-success">{formatNumber(b.delivered_count)}</TableCell>
                    <TableCell className="text-right tabular-nums text-destructive">{formatNumber(b.failed_count)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatDateTime(b.scheduled_at)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatDateTime(b.sent_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <DataTablePagination page={page} pageSize={PAGE_SIZE} total={count ?? 0} basePath="/notifications" />
          </>
        ) : (
          <EmptyState icon={Megaphone} title="No broadcasts sent yet" description="Compose your first push campaign." />
        )}
      </Card>
    </>
  );
}
