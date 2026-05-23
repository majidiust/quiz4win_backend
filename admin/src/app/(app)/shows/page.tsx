import Link from "next/link";
import { Radio } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusBadge } from "@/components/status-badge";
import { PageHeader } from "@/components/shell/page-header";
import { EmptyState } from "@/components/empty-state";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { formatDateTime, formatMoneyDecimal, initials } from "@/lib/utils";
import { CreateHostDialog } from "./create-host-dialog";

export const metadata = { title: "Live Shows" };

export default async function ShowsPage() {
  await requireAdmin(["super_admin", "admin", "moderator"]);
  const db = createSupabaseAdminClient();

  const [{ data: hosts }, { data: shows }] = await Promise.all([
    db.from("show_hosts").select("id, name, bio, avatar_url, shows_hosted, avg_rating, status").order("shows_hosted", { ascending: false }),
    db.from("games").select("id, title, status, prize_pool, viewer_count, scheduled_at, started_at, ended_at, host_name").eq("mode", "live").order("scheduled_at", { ascending: false }).limit(50),
  ]);

  return (
    <>
      <PageHeader
        title="Live Shows"
        description="Manage shows and the talent roster."
        actions={<CreateHostDialog />}
      />

      <div className="space-y-6">
        {/* Shows list */}
        <Card className="overflow-hidden">
          <CardHeader><CardTitle className="text-base">Shows</CardTitle></CardHeader>
          <CardContent className="px-0 pt-0">
            {shows && shows.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Host</TableHead>
                    <TableHead className="text-right">Viewers</TableHead>
                    <TableHead className="text-right">Prize pool</TableHead>
                    <TableHead>Scheduled</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shows.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell>
                        <Link href={`/shows/${s.id}`} className="text-sm font-medium hover:underline">{s.title}</Link>
                      </TableCell>
                      <TableCell><StatusBadge value={s.status} /></TableCell>
                      <TableCell className="text-sm">{s.host_name ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{s.viewer_count ?? 0}</TableCell>
                      <TableCell className="text-right font-mono text-xs">{formatMoneyDecimal(s.prize_pool)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{formatDateTime(s.scheduled_at)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <EmptyState icon={Radio} title="No shows yet" description="Create a show from the Games page (mode = live)." />
            )}
          </CardContent>
        </Card>

        {/* Hosts roster */}
        <Card className="overflow-hidden">
          <CardHeader><CardTitle className="text-base">Hosts</CardTitle></CardHeader>
          <CardContent className="px-0 pt-0">
            {hosts && hosts.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Host</TableHead>
                    <TableHead>Bio</TableHead>
                    <TableHead className="text-right">Shows hosted</TableHead>
                    <TableHead className="text-right">Avg rating</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {hosts.map((h) => (
                    <TableRow key={h.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Avatar className="size-8">
                            {h.avatar_url ? <AvatarImage src={h.avatar_url} alt={h.name} /> : null}
                            <AvatarFallback className="text-[10px]">{initials(h.name)}</AvatarFallback>
                          </Avatar>
                          <span className="text-sm font-medium">{h.name}</span>
                        </div>
                      </TableCell>
                      <TableCell className="max-w-md truncate text-xs text-muted-foreground">{h.bio ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{h.shows_hosted}</TableCell>
                      <TableCell className="text-right tabular-nums">{h.avg_rating ?? "—"}</TableCell>
                      <TableCell><StatusBadge value={h.status} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <EmptyState icon={Radio} title="No show hosts yet" description="Add a host using the button above." />
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
