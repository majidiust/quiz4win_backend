import Link from "next/link";
import { Gamepad2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/status-badge";
import { DataTablePagination } from "@/components/data-table-pagination";
import { PageHeader } from "@/components/shell/page-header";
import { EmptyState } from "@/components/empty-state";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { formatDateTime, formatMoneyDecimal, formatNumber } from "@/lib/utils";

export const metadata = { title: "Games" };
const PAGE_SIZE = 25;
interface SearchParams { status?: string; mode?: string; page?: string }

export default async function GamesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requireAdmin(["super_admin", "admin", "moderator"]);
  const sp = await searchParams;
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10));
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const db = createSupabaseAdminClient();
  let q = db
    .from("games")
    .select(
      "id, title, mode, status, category, entry_fee, prize_pool, max_players, total_participants, viewer_count, scheduled_at, started_at, ended_at",
      { count: "exact" },
    )
    .order("scheduled_at", { ascending: false, nullsFirst: false })
    .range(from, to);
  if (sp.status) q = q.eq("status", sp.status);
  if (sp.mode) q = q.eq("mode", sp.mode);

  const { data, count, error } = await q;
  if (error) throw error;

  const statuses = ["upcoming", "open", "live", "completed", "cancelled"];

  return (
    <>
      <PageHeader title="Games" description="All games — scheduled, live, and historical." />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Link href="/games" className={`rounded-md border px-3 py-1 text-xs capitalize ${!sp.status ? "bg-muted" : "text-muted-foreground"}`}>All</Link>
        {statuses.map((s) => (
          <Link
            key={s}
            href={`/games?status=${s}`}
            className={`rounded-md border px-3 py-1 text-xs capitalize ${sp.status === s ? "bg-muted" : "text-muted-foreground"}`}
          >
            {s}
          </Link>
        ))}
      </div>

      <Card className="overflow-hidden">
        {data && data.length > 0 ? (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Mode</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Entry / Pool</TableHead>
                  <TableHead className="text-right">Players</TableHead>
                  <TableHead className="text-right">Viewers</TableHead>
                  <TableHead>Scheduled</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((g) => (
                  <TableRow key={g.id}>
                    <TableCell>
                      <Link href={`/games/${g.id}`} className="hover:underline">
                        <div className="text-sm font-medium">{g.title}</div>
                        <div className="text-xs text-muted-foreground">{g.category ?? "—"}</div>
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm capitalize">{g.mode}</TableCell>
                    <TableCell><StatusBadge value={g.status} /></TableCell>
                    <TableCell className="font-mono text-xs">
                      {formatMoneyDecimal(g.entry_fee)} <span className="text-muted-foreground">/</span>{" "}
                      <span className="text-success">{formatMoneyDecimal(g.prize_pool)}</span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatNumber(g.total_participants ?? 0)}
                      {g.max_players ? <span className="text-muted-foreground">/{g.max_players}</span> : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(g.viewer_count)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{formatDateTime(g.scheduled_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <DataTablePagination page={page} pageSize={PAGE_SIZE} total={count ?? 0} basePath="/games" searchParams={{ status: sp.status, mode: sp.mode }} />
          </>
        ) : (
          <EmptyState icon={Gamepad2} title="No games match these filters" />
        )}
      </Card>
    </>
  );
}
