import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Trophy, Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { PageHeader } from "@/components/shell/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { formatDateTime, formatMoneyDecimal, formatRelative, formatNumber } from "@/lib/utils";
import { GameLifecycleActions, RemoveParticipantButton } from "./game-actions";

export const metadata = { title: "Game detail" };

interface ProfileShape { full_name?: string | null; email?: string | null }

export default async function GameDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin(["super_admin", "admin", "moderator"]);
  const { id } = await params;
  const db = createSupabaseAdminClient();

  const [{ data: game, error }, { data: participants }] = await Promise.all([
    db.from("games").select("*").eq("id", id).maybeSingle(),
    db
      .from("game_participants")
      .select("user_id, score, rank, prize_earned, entry_fee_paid, status, joined_at, profiles!game_participants_user_id_fkey(full_name, email)")
      .eq("game_id", id)
      .order("rank", { ascending: true, nullsFirst: false }),
  ]);

  if (error || !game) notFound();

  return (
    <>
      <PageHeader
        title={game.title}
        description={`${game.mode} · ${game.category ?? "General"}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href="/games"><ArrowLeft className="size-4" /> All games</Link>
            </Button>
            <GameLifecycleActions gameId={game.id} status={game.status} />
          </div>
        }
      />

      <section className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle className="text-base">Details</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Status"><StatusBadge value={game.status} /></Row>
            <Row label="Mode"><span className="capitalize">{game.mode}</span></Row>
            <Row label="Difficulty">{game.difficulty ?? "—"}</Row>
            <Row label="Entry fee"><span className="font-mono">{formatMoneyDecimal(game.entry_fee)}</span></Row>
            <Row label="Prize pool"><span className="font-mono text-success">{formatMoneyDecimal(game.prize_pool)}</span></Row>
            <Row label="Max players">{game.max_players ?? "Unlimited"}</Row>
            <Row label="Questions">{game.questions_count}</Row>
            <Row label="Time/question">{game.time_per_question}s</Row>
            {game.scheduled_at ? <Row label="Scheduled">{formatDateTime(game.scheduled_at)}</Row> : null}
            {game.started_at ? <Row label="Started">{formatDateTime(game.started_at)}</Row> : null}
            {game.ended_at ? <Row label="Ended">{formatDateTime(game.ended_at)}</Row> : null}
            {game.cancelled_reason ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
                Cancelled: {game.cancelled_reason}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="size-4" />
              Participants
              <span className="ml-auto text-sm font-normal text-muted-foreground">
                {formatNumber(participants?.length ?? 0)} / {game.max_players ?? "∞"}
              </span>
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
                    <TableHead />
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
                        <TableCell className="text-right tabular-nums">
                          {p.rank === 1 ? <Trophy className="inline size-3.5 text-yellow-500" /> : null} {p.rank ?? "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{p.score}</TableCell>
                        <TableCell className="text-right font-mono text-xs">{formatMoneyDecimal(p.prize_earned)}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{formatRelative(p.joined_at)}</TableCell>
                        <TableCell>
                          {!["completed", "cancelled"].includes(game.status) ? (
                            <RemoveParticipantButton
                              gameId={id}
                              userId={p.user_id}
                              name={profile?.full_name ?? profile?.email ?? p.user_id}
                            />
                          ) : null}
                        </TableCell>
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
