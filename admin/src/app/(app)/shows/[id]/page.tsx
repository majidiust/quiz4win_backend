import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { PageHeader } from "@/components/shell/page-header";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { formatDateTime, formatMoneyDecimal, formatRelative, formatNumber, initials } from "@/lib/utils";
import { ShowLifecycleActions } from "./show-actions";

export const metadata = { title: "Show detail" };

interface ProfileShape { full_name?: string | null; email?: string | null }

export default async function ShowDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin(["super_admin", "admin", "moderator"]);
  const { id } = await params;
  const db = createSupabaseAdminClient();

  const [{ data: show, error }, { data: participants }, { data: host }] = await Promise.all([
    db.from("games").select("*").eq("id", id).eq("mode", "live").maybeSingle(),
    db
      .from("game_participants")
      .select("user_id, score, rank, prize_earned, joined_at, profiles!game_participants_user_id_fkey(full_name, email)")
      .eq("game_id", id)
      .order("rank", { ascending: true, nullsFirst: false }),
    db.from("show_hosts").select("*").eq("id", id).maybeSingle().then(() =>
      db.from("show_hosts").select("*").limit(0)
    ),
  ]);

  if (error || !show) notFound();

  // Fetch host if host_id set
  const { data: showHost } = show.host_id
    ? await db.from("show_hosts").select("*").eq("id", show.host_id).maybeSingle()
    : { data: null };

  return (
    <>
      <PageHeader
        title={show.title}
        description="Live show"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href="/shows"><ArrowLeft className="size-4" /> All shows</Link>
            </Button>
            <ShowLifecycleActions showId={show.id} status={show.status} />
          </div>
        }
      />

      <section className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle className="text-base">Details</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Status"><StatusBadge value={show.status} /></Row>
            <Row label="Prize pool"><span className="font-mono text-success">{formatMoneyDecimal(show.prize_pool)}</span></Row>
            <Row label="Viewers">{formatNumber(show.viewer_count ?? 0)}</Row>
            {show.scheduled_at ? <Row label="Scheduled">{formatDateTime(show.scheduled_at)}</Row> : null}
            {show.started_at ? <Row label="Started">{formatDateTime(show.started_at)}</Row> : null}
            {show.ended_at ? <Row label="Ended">{formatDateTime(show.ended_at)}</Row> : null}
            {show.livekit_room_name ? (
              <Row label="Room"><span className="font-mono text-xs">{show.livekit_room_name}</span></Row>
            ) : null}
            {show.stream_url ? (
              <Row label="Stream">
                <a href={show.stream_url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline">Open stream</a>
              </Row>
            ) : null}
          </CardContent>
        </Card>

        {showHost && (
          <Card>
            <CardHeader><CardTitle className="text-base">Host</CardTitle></CardHeader>
            <CardContent className="flex flex-col items-center gap-3 text-center">
              <Avatar className="size-14">
                {showHost.avatar_url ? <AvatarImage src={showHost.avatar_url} alt={showHost.name} /> : null}
                <AvatarFallback>{initials(showHost.name)}</AvatarFallback>
              </Avatar>
              <div>
                <div className="font-semibold">{showHost.name}</div>
                {showHost.bio ? <p className="mt-1 text-xs text-muted-foreground">{showHost.bio}</p> : null}
              </div>
              <StatusBadge value={showHost.status} />
            </CardContent>
          </Card>
        )}

        <Card className={showHost ? "" : "lg:col-span-2"}>
          <CardHeader>
            <CardTitle className="text-base">
              Participants · {formatNumber(participants?.length ?? 0)}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-0 pt-0">
            {participants && participants.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Player</TableHead>
                    <TableHead className="text-right">Rank</TableHead>
                    <TableHead className="text-right">Score</TableHead>
                    <TableHead className="text-right">Prize</TableHead>
                    <TableHead>Joined</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {participants.map((p) => {
                    const profile = p.profiles as ProfileShape | null;
                    return (
                      <TableRow key={p.user_id}>
                        <TableCell>
                          <Link href={`/users/${p.user_id}`} className="hover:underline">
                            <div className="text-sm font-medium">{profile?.full_name ?? "—"}</div>
                            <div className="text-xs text-muted-foreground">{profile?.email}</div>
                          </Link>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{p.rank ?? "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">{p.score}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{formatMoneyDecimal(p.prize_earned)}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{formatRelative(p.joined_at)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            ) : (
              <p className="px-6 pb-4 text-sm text-muted-foreground">No participants yet.</p>
            )}
          </CardContent>
        </Card>
      </section>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b py-1.5 last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}
