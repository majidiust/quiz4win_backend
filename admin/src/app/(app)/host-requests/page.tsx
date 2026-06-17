import Link from "next/link";
import { ListChecks } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/status-badge";
import { PageHeader } from "@/components/shell/page-header";
import { EmptyState } from "@/components/empty-state";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { formatDateTime, formatRelative } from "@/lib/utils";
import { RequestActions } from "@/app/(app)/hosts/[id]/host-actions";

export const metadata = { title: "Host requests — Quiz4Win Admin" };

type Status = "pending" | "approved" | "rejected" | "cancelled" | "all";
const TABS: { value: Status; label: string }[] = [
  { value: "pending",   label: "Pending"   },
  { value: "approved",  label: "Approved"  },
  { value: "rejected",  label: "Rejected"  },
  { value: "cancelled", label: "Cancelled" },
  { value: "all",       label: "All"       },
];

interface SearchParams { status?: string; q?: string }

export default async function HostRequestsPage({
  searchParams,
}: { searchParams: Promise<SearchParams> }) {
  await requireAdmin(["super_admin", "admin", "moderator"]);
  const sp = await searchParams;
  const status: Status = (TABS.find((t) => t.value === sp.status)?.value ?? "pending");
  const q = (sp.q ?? "").trim();

  const db = createSupabaseAdminClient();
  let query = db.from("host_game_requests")
    .select("id, host_id, game_id, status, host_note, admin_note, created_at, reviewed_at, games(id, title, scheduled_at, status, mode), show_hosts!host_id(id, name, avatar_url)")
    .order("created_at", { ascending: false })
    .limit(200);
  if (status !== "all") query = query.eq("status", status);
  const { data } = await query;
  let rows = (data ?? []) as unknown as Array<{
    id: string; host_id: string; game_id: string; status: string;
    host_note: string | null; admin_note: string | null;
    created_at: string; reviewed_at: string | null;
    games: { id: string; title: string; scheduled_at: string | null; status: string; mode: string } | null;
    show_hosts: { id: string; name: string; avatar_url: string | null } | null;
  }>;
  if (q) {
    const needle = q.toLowerCase();
    rows = rows.filter((r) =>
      (r.games?.title ?? "").toLowerCase().includes(needle) ||
      (r.show_hosts?.name ?? "").toLowerCase().includes(needle),
    );
  }

  // Per-status counts for the tab badges (use a separate quick query so the
  // counts don't change when the user types in the search box).
  const { data: countsRaw } = await db
    .from("host_game_requests").select("status");
  const counts: Record<string, number> = { all: countsRaw?.length ?? 0 };
  for (const r of countsRaw ?? []) {
    const s = (r as { status: string }).status;
    counts[s] = (counts[s] ?? 0) + 1;
  }

  return (
    <>
      <PageHeader
        title="Host requests"
        description="Hosts apply to run available games — review and accept here."
      />

      <Card>
        <CardHeader className="gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {TABS.map((t) => {
              const active = t.value === status;
              const c = counts[t.value] ?? 0;
              const href = `/host-requests?status=${t.value}${q ? `&q=${encodeURIComponent(q)}` : ""}`;
              return (
                <Button
                  key={t.value} asChild size="sm"
                  variant={active ? "default" : "outline"}
                >
                  <Link href={href}>
                    {t.label}
                    <Badge variant="secondary" className="ml-1.5">{c}</Badge>
                  </Link>
                </Button>
              );
            })}
          </div>
          <form className="flex max-w-sm gap-2" action="/host-requests" method="get">
            <input type="hidden" name="status" value={status} />
            <Input name="q" defaultValue={q} placeholder="Search game or host…" />
            <Button size="sm" type="submit" variant="outline">Search</Button>
          </form>
        </CardHeader>

        <CardContent className="p-0">
          {rows.length === 0 ? (
            <EmptyState
              icon={ListChecks}
              title="No host requests"
              description={status === "pending" ? "There are no pending requests." : "No requests match this filter."}
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Host</TableHead>
                  <TableHead>Game</TableHead>
                  <TableHead>Scheduled</TableHead>
                  <TableHead>Requested</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Note</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">
                      {r.show_hosts ? (
                        <Link href={`/hosts/${r.show_hosts.id}`} className="hover:underline">
                          {r.show_hosts.name}
                        </Link>
                      ) : "—"}
                    </TableCell>
                    <TableCell>
                      {r.games ? (
                        <Link href={`/games/${r.games.id}`} className="hover:underline">
                          {r.games.title}
                        </Link>
                      ) : "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{r.games?.scheduled_at ? formatDateTime(r.games.scheduled_at) : "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{formatRelative(r.created_at)}</TableCell>
                    <TableCell><StatusBadge value={r.status} /></TableCell>
                    <TableCell className="max-w-[14rem]">
                      <div className="line-clamp-1 text-muted-foreground">{r.host_note ?? "—"}</div>
                      {r.admin_note ? <div className="line-clamp-1 text-[11px] text-muted-foreground/80">Admin: {r.admin_note}</div> : null}
                    </TableCell>
                    <TableCell className="text-right">
                      <RequestActions requestId={r.id} status={r.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
