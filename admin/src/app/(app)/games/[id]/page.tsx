import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Trophy, Users, Palette, Image as ImageIcon, User, Pencil } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusBadge, hostAssignmentLabel } from "@/components/status-badge";
import { PageHeader } from "@/components/shell/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { formatDateTime, formatMoneyDecimal, formatRelative, formatNumber } from "@/lib/utils";
import { GameLifecycleActions, RemoveParticipantButton, AssetUploadButton } from "./game-actions";
import { ExportButton } from "@/components/export-button";

export const metadata = { title: "Game detail" };

interface ProfileShape { full_name?: string | null; email?: string | null }

export default async function GameDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin(["super_admin", "admin", "moderator"]);
  const { id } = await params;
  const db = createSupabaseAdminClient();

  const [{ data: game, error }, { data: participants }, { data: winners }] = await Promise.all([
    db.from("games").select("*").eq("id", id).maybeSingle(),
    db
      .from("game_participants")
      .select("user_id, score, rank, prize_earned, entry_fee_paid, status, joined_at, profiles!game_participants_user_id_fkey(full_name, email)")
      .eq("game_id", id)
      .order("rank", { ascending: true, nullsFirst: false }),
    db
      .from("game_participants")
      .select("user_id, score, rank, prize_earned, profiles!game_participants_user_id_fkey(full_name, email)")
      .eq("game_id", id)
      .gt("prize_earned", 0)
      .order("rank", { ascending: true }),
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
            <ExportButton href={`/api/exports/games/${game.id}`} label="Export results" />
            {["upcoming", "open"].includes(game.status) ? (
              <Button asChild variant="outline" size="sm">
                <Link href={`/games/${game.id}/edit`}><Pencil className="size-3.5" /> Edit</Link>
              </Button>
            ) : null}
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
            <Row label="Prize pool">
              <span className="font-mono text-success">{formatMoneyDecimal(game.prize_pool)}</span>
              <span className="ml-1 text-xs text-muted-foreground">{game.prize_pool_currency ?? "USD"}</span>
            </Row>
            <Row label="AI cost">
              {game.ai_cost_microdollars
                ? <span className="font-mono text-xs">${(Number(game.ai_cost_microdollars) / 1_000_000).toFixed(4)}</span>
                : <span className="text-muted-foreground">—</span>}
            </Row>
            <Row label="Featured">
              {game.is_featured
                ? <Badge variant="default" className="text-xs">Featured</Badge>
                : <span className="text-muted-foreground">No</span>}
            </Row>
            <Row label="Max players">{game.max_players ?? "Unlimited"}</Row>
            <Row label="Questions">{game.questions_count}</Row>
            <Row label="Per question">{game.time_per_question}s</Row>
            <Row label="Lives">{game.allowed_wrong_answers ?? "Unlimited"}</Row>
            {game.scheduled_at ? <Row label="Scheduled">{formatDateTime(game.scheduled_at)}</Row> : null}
            {game.started_at ? <Row label="Started">{formatDateTime(game.started_at)}</Row> : null}
            {game.ended_at ? <Row label="Ended">{formatDateTime(game.ended_at)}</Row> : null}
            {game.sponsor ? <Row label="Sponsor">{game.sponsor}</Row> : null}
            {Array.isArray(game.tags) && game.tags.length > 0 ? (
              <Row label="Tags">
                <div className="flex flex-wrap gap-1 justify-end">
                  {(game.tags as string[]).map((t) => <Badge key={t} variant="muted" className="text-xs">{t}</Badge>)}
                </div>
              </Row>
            ) : null}
            {game.cancelled_reason ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive">
                Cancelled: {game.cancelled_reason}
              </div>
            ) : null}
          </CardContent>
        </Card>

        {/* Styling & Assets card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Palette className="size-4" /> Styling &amp; Assets
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {/* Colors */}
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Colors</p>
              <Row label="Accent">
                {game.accent_color ? (
                  <span className="flex items-center gap-1.5 font-mono text-xs">
                    <span className="inline-block size-4 rounded-sm border" style={{ background: game.accent_color }} />
                    {game.accent_color}
                  </span>
                ) : "—"}
              </Row>
              <Row label="Glow">
                {game.glow_color ? (
                  <span className="flex items-center gap-1.5 font-mono text-xs">
                    <span className="inline-block size-4 rounded-sm border" style={{ background: game.glow_color }} />
                    {game.glow_color}
                  </span>
                ) : "—"}
              </Row>
              {Array.isArray(game.gradient_colors) && game.gradient_colors.length > 0 ? (
                <Row label="Gradient">
                  <div className="flex gap-1">
                    {(game.gradient_colors as string[]).map((c) => (
                      <span key={c} title={c} className="inline-block size-4 rounded-sm border" style={{ background: c }} />
                    ))}
                  </div>
                </Row>
              ) : null}
            </div>
            {/* Assets */}
            <div className="space-y-3">
              <p className="text-xs font-medium text-muted-foreground">Assets</p>
              <div className="flex items-start gap-4">
                <div className="flex flex-col items-center gap-1">
                  <p className="text-xs text-muted-foreground flex items-center gap-1"><ImageIcon className="size-3" /> Icon</p>
                  <AssetUploadButton gameId={game.id} field="icon" label="Icon" currentUrl={game.icon} />
                </div>
                <div className="flex flex-col items-center gap-1">
                  <p className="text-xs text-muted-foreground flex items-center gap-1"><ImageIcon className="size-3" /> Thumbnail</p>
                  <AssetUploadButton gameId={game.id} field="thumbnail_url" label="Thumbnail" currentUrl={game.thumbnail_url} />
                </div>
                <div className="flex flex-col items-center gap-1">
                  <p className="text-xs text-muted-foreground flex items-center gap-1"><ImageIcon className="size-3" /> Poster</p>
                  <AssetUploadButton gameId={game.id} field="poster_url" label="Poster" currentUrl={game.poster_url} />
                </div>
              </div>
            </div>
            {/* Host info */}
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground flex items-center gap-1"><User className="size-3" /> Host</p>
              <div className="flex items-start gap-3">
                <AssetUploadButton gameId={game.id} field="host_avatar_url" label="Host avatar" currentUrl={game.host_avatar_url} />
                <div className="space-y-1">
                  <p className="font-medium">{game.host_name ?? <span className="text-muted-foreground">—</span>}</p>
                  <p className="text-xs text-muted-foreground">{game.host_title ?? ""}</p>
                  {game.host_id ? (
                    <StatusBadge
                      value={game.host_assignment_status}
                      label={hostAssignmentLabel(game.host_assignment_status)}
                    />
                  ) : null}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Trophy className="size-4 text-yellow-500" />
              Prize distribution
              <span className="ml-auto text-xs font-normal">
                {game.prizes_distributed_at
                  ? <Badge variant="default" className="text-[10px]">Distributed · {formatRelative(game.prizes_distributed_at)}</Badge>
                  : <Badge variant="muted" className="text-[10px]">Pending</Badge>}
                {game.prize_notifications_sent_at
                  ? <Badge variant="muted" className="ml-1 text-[10px]">Notified</Badge>
                  : null}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div>
                <div className="text-xs text-muted-foreground">Prize pool</div>
                <div className="font-mono text-success">{formatMoneyDecimal(game.prize_pool)} {game.prize_pool_currency ?? "USD"}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Winners</div>
                <div className="font-mono">{game.total_winners ?? (winners?.length ?? 0)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Distributed at</div>
                <div className="text-xs">{game.prizes_distributed_at ? formatDateTime(game.prizes_distributed_at) : "—"}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Notified at</div>
                <div className="text-xs">{game.prize_notifications_sent_at ? formatDateTime(game.prize_notifications_sent_at) : "—"}</div>
              </div>
            </div>
            {game.prize_breakdown && Array.isArray((game.prize_breakdown as { tiers?: unknown[] }).tiers) ? (
              <div>
                <div className="mb-1 text-xs font-medium text-muted-foreground">Tiers</div>
                <div className="flex flex-wrap gap-1.5">
                  {((game.prize_breakdown as { tiers: Array<Record<string, unknown>> }).tiers).map((t, i) => {
                    const rankFrom = (t.rank_from ?? t.rank) as number | undefined;
                    const rankTo   = (t.rank_to ?? t.rank) as number | undefined;
                    const rankLabel = rankFrom === rankTo ? `#${rankFrom}` : `#${rankFrom}–${rankTo}`;
                    const payout = t.amount !== undefined
                      ? `${formatMoneyDecimal(Number(t.amount))} ${game.prize_pool_currency ?? "USD"}`
                      : t.percent !== undefined ? `${t.percent}%` : "—";
                    return (
                      <Badge key={i} variant="muted" className="font-mono text-[10px]">
                        {rankLabel} → {payout}
                      </Badge>
                    );
                  })}
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No prize breakdown defined — winner takes all.</p>
            )}
            {winners && winners.length > 0 ? (
              <div>
                <div className="mb-1 text-xs font-medium text-muted-foreground">Winners</div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Player</TableHead>
                      <TableHead className="text-right">Rank</TableHead>
                      <TableHead className="text-right">Score</TableHead>
                      <TableHead className="text-right">Prize</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {winners.map((w) => {
                      const profile = w.profiles as ProfileShape | null;
                      return (
                        <TableRow key={w.user_id}>
                          <TableCell>
                            <Link href={`/users/${w.user_id}`} className="hover:underline">
                              <div className="text-sm font-medium">{profile?.full_name ?? "—"}</div>
                              <div className="text-xs text-muted-foreground">{profile?.email}</div>
                            </Link>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {w.rank === 1 ? <Trophy className="inline size-3.5 text-yellow-500" /> : null} #{w.rank}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{w.score}</TableCell>
                          <TableCell className="text-right font-mono text-xs text-success">
                            {formatMoneyDecimal(w.prize_earned)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
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
