import { notFound } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, CalendarClock, Bot, History as HistoryIcon, Pencil, Power, Hash,
  Clock, Gamepad2, Users, Trophy, Coins, Globe, Tag, Filter, Sparkles,
  Palette, Fingerprint, Languages, Star,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { PageHeader } from "@/components/shell/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { formatDateTime, formatMoneyDecimal, formatNumber, formatRelative } from "@/lib/utils";
import { nextCronRuns } from "@/lib/cron";
import { TemplateActions } from "./template-actions";

export const metadata = { title: "Template detail" };

interface GameRow {
  id: string; title: string; status: string; scheduled_at: string | null;
  started_at: string | null; ended_at: string | null;
  total_participants: number | null; created_at: string;
}

export default async function TemplateDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin(["super_admin", "admin", "moderator"]);
  const { id } = await params;
  const db = createSupabaseAdminClient();

  const { data: tpl, error } = await db
    .from("game_templates")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error || !tpl) notFound();

  const [{ data: currentGame }, { data: lastGame }, { data: history }] = await Promise.all([
    tpl.current_game_id
      ? db.from("games").select("id, title, status, scheduled_at, started_at, ended_at, total_participants").eq("id", tpl.current_game_id).maybeSingle()
      : Promise.resolve({ data: null }),
    tpl.last_completed_game_id
      ? db.from("games").select("id, title, status, scheduled_at, started_at, ended_at, total_participants").eq("id", tpl.last_completed_game_id).maybeSingle()
      : Promise.resolve({ data: null }),
    db.from("games")
      .select("id, title, status, scheduled_at, started_at, ended_at, total_participants, created_at")
      .eq("template_id", id)
      .order("created_at", { ascending: false })
      .limit(25),
  ]);

  const games = (history ?? []) as GameRow[];
  const qFilters = [tpl.question_category, tpl.question_difficulty, tpl.question_language].filter(Boolean);
  const upcomingRuns = tpl.is_active ? nextCronRuns(tpl.cron_expression, 3) : [];
  const nextRun = upcomingRuns[0] ?? null;

  return (
    <>
      <PageHeader
        title={tpl.name}
        description={tpl.cron_description ?? tpl.cron_expression}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href="/templates"><ArrowLeft className="size-4" /> All templates</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href={`/templates/${tpl.id}/edit`}><Pencil className="size-4" /> Edit</Link>
            </Button>
            <TemplateActions id={tpl.id} isActive={tpl.is_active} />
          </div>
        }
      />

      {/* KPI strip — at-a-glance metrics */}
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
        <Kpi icon={Power} label="Status" value={
          <Badge variant={tpl.is_active ? "success" : "muted"}>{tpl.is_active ? "Active" : "Inactive"}</Badge>
        } />
        <Kpi icon={Gamepad2} label="Mode" value={<span className="capitalize">{tpl.mode}</span>} />
        <Kpi icon={HistoryIcon} label="Generated" value={
          <span className="tabular-nums">{formatNumber(tpl.total_games_generated ?? 0)}</span>
        } />
        <Kpi icon={Clock} label="Last run" value={
          <span className="text-xs">{tpl.last_generated_at ? formatRelative(tpl.last_generated_at) : "Never"}</span>
        } />
        <Kpi icon={CalendarClock} label="Next run" value={
          <span className="text-xs">
            {nextRun ? formatRelative(nextRun.toISOString()) : (tpl.is_active ? "—" : "Paused")}
          </span>
        } />
        <Kpi icon={Trophy} label="Prize pool" value={
          <span className="font-mono text-success">{formatMoneyDecimal(tpl.prize_pool, tpl.prize_pool_currency)}</span>
        } />
        <Kpi icon={Coins} label="Entry fee" value={
          <span className="font-mono">{formatMoneyDecimal(tpl.entry_fee, tpl.prize_pool_currency)}</span>
        } />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Schedule — col 1-2 */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <CalendarClock className="size-4" /> Schedule
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <DetailRow icon={Hash} label="Cron expression">
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{tpl.cron_expression}</code>
              </DetailRow>
              <DetailRow label="Description">{tpl.cron_description ?? "—"}</DetailRow>
              <DetailRow icon={Clock} label="Duration">
                <span className="tabular-nums">{tpl.duration_minutes} min</span>
              </DetailRow>
              <DetailRow label="Start buffer">
                <span className="tabular-nums">{tpl.start_buffer_seconds}s</span>
              </DetailRow>
              <DetailRow label="Last run">
                {tpl.last_generated_at
                  ? <>{formatDateTime(tpl.last_generated_at)} <span className="text-muted-foreground">({formatRelative(tpl.last_generated_at)})</span></>
                  : <span className="text-muted-foreground">Never</span>}
              </DetailRow>
              <DetailRow label="Created">
                {formatDateTime(tpl.created_at)} <span className="text-muted-foreground">({formatRelative(tpl.created_at)})</span>
              </DetailRow>
            </div>
            {tpl.is_active && upcomingRuns.length > 0 ? (
              <div className="mt-4 border-t pt-3">
                <div className="mb-2 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  <CalendarClock className="size-3" />
                  Upcoming runs (UTC)
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {upcomingRuns.map((d, i) => (
                    <span
                      key={d.toISOString()}
                      className={`rounded-md border px-2 py-1 font-mono text-[11px] tabular-nums ${i === 0 ? "border-primary/40 bg-primary/5 text-primary" : "bg-muted/30"}`}
                      title={formatRelative(d.toISOString())}
                    >
                      {formatDateTime(d.toISOString())}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        {/* Activity sidebar — col 3 */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Activity</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <ActivityRow label="Current game" game={currentGame as GameRow | null} emptyText="No game in flight" />
            <ActivityRow label="Last completed" game={lastGame as GameRow | null} emptyText="No completed games yet" />
          </CardContent>
        </Card>

        {/* Gameplay — col 1-2 */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Gamepad2 className="size-4" /> Gameplay
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <DetailRow icon={Tag} label="Category">{tpl.category ?? "—"}</DetailRow>
              <DetailRow label="Difficulty">{tpl.difficulty ?? "—"}</DetailRow>
              <DetailRow icon={Languages} label="Language"><span className="uppercase">{tpl.language}</span></DetailRow>
              <DetailRow icon={Users} label="Max players">
                <span className="tabular-nums">{tpl.max_players ?? "Unlimited"}</span>
              </DetailRow>
              <DetailRow label="Questions">
                <span className="tabular-nums">{tpl.questions_count}</span>
              </DetailRow>
              <DetailRow label="Per question">
                <span className="tabular-nums">{tpl.time_per_question}s</span>
              </DetailRow>
              <DetailRow label="Lives">
                <span className="tabular-nums">{tpl.allowed_wrong_answers ?? "Unlimited"}</span>
              </DetailRow>
              <DetailRow icon={Star} label="Featured">
                {tpl.is_featured ? <Badge variant="warning">Featured</Badge> : <span className="text-muted-foreground">No</span>}
              </DetailRow>
            </div>
          </CardContent>
        </Card>

        {/* Question filters — col 3 */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Filter className="size-4" /> Question filters
            </CardTitle>
          </CardHeader>
          <CardContent>
            {qFilters.length > 0 ? (
              <div className="space-y-3">
                <DetailRow label="Category">{tpl.question_category ?? "Any"}</DetailRow>
                <DetailRow label="Difficulty">{tpl.question_difficulty ?? "Any"}</DetailRow>
                <DetailRow label="Language">
                  {tpl.question_language ? <span className="uppercase">{tpl.question_language}</span> : "Any"}
                </DetailRow>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No filters — questions drawn from any pool matching template language.</p>
            )}
          </CardContent>
        </Card>

        {/* AI Presenter — col 1-2 */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Bot className="size-4" /> AI Presenter
              {tpl.ai_enabled
                ? <Badge variant="success" className="ml-1">Enabled</Badge>
                : <Badge variant="muted" className="ml-1">Disabled</Badge>}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {tpl.ai_enabled ? (
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <DetailRow icon={Sparkles} label="Avatar ID">
                  <span className="font-mono text-[11px] break-all">{tpl.ai_avatar_id ?? "—"}</span>
                </DetailRow>
                <DetailRow label="Voice ID">
                  <span className="font-mono text-[11px] break-all">{tpl.ai_sound_id ?? "—"}</span>
                </DetailRow>
                <DetailRow label="Duration">
                  <span className="tabular-nums">{tpl.ai_duration ? `${tpl.ai_duration}s` : "—"}</span>
                </DetailRow>
                <DetailRow icon={Languages} label="Language">
                  <span className="uppercase">{tpl.ai_language ?? tpl.language}</span>
                </DetailRow>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">AI presenter is disabled — games will run with the human host configuration only.</p>
            )}
          </CardContent>
        </Card>

        {/* Branding — col 3 */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Palette className="size-4" /> Branding
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <DetailRow label="Sponsor">{tpl.sponsor ?? "—"}</DetailRow>
            <DetailRow label="Accent">
              {tpl.accent_color
                ? <ColorChip color={tpl.accent_color} />
                : <span className="text-muted-foreground">—</span>}
            </DetailRow>
            <DetailRow label="Glow">
              {tpl.glow_color
                ? <ColorChip color={tpl.glow_color} />
                : <span className="text-muted-foreground">—</span>}
            </DetailRow>
            <DetailRow label="Gradient">
              {Array.isArray(tpl.gradient_colors) && tpl.gradient_colors.length > 0
                ? <div className="flex gap-1">{tpl.gradient_colors.map((c: string) => <ColorChip key={c} color={c} compact />)}</div>
                : <span className="text-muted-foreground">—</span>}
            </DetailRow>
          </CardContent>
        </Card>

        {/* Identifiers — full width */}
        <Card className="lg:col-span-3">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Fingerprint className="size-4" /> Identifiers
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
              <DetailRow label="Template ID">
                <span className="font-mono text-[11px] break-all">{tpl.id}</span>
              </DetailRow>
              <DetailRow label="Current game">
                {tpl.current_game_id
                  ? <Link href={`/games/${tpl.current_game_id}`} className="font-mono text-[11px] text-blue-500 break-all hover:underline">{tpl.current_game_id}</Link>
                  : <span className="text-muted-foreground">—</span>}
              </DetailRow>
              <DetailRow label="Last completed game">
                {tpl.last_completed_game_id
                  ? <Link href={`/games/${tpl.last_completed_game_id}`} className="font-mono text-[11px] text-blue-500 break-all hover:underline">{tpl.last_completed_game_id}</Link>
                  : <span className="text-muted-foreground">—</span>}
              </DetailRow>
              <DetailRow icon={Globe} label="Host">
                {tpl.host_id
                  ? <span className="font-mono text-[11px] break-all">{tpl.host_id}</span>
                  : <span className="text-muted-foreground">—</span>}
              </DetailRow>
            </div>
          </CardContent>
        </Card>

        {/* Generated games — full width */}
        <Card className="lg:col-span-3">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <HistoryIcon className="size-4" /> Generated games
              <Badge variant="outline" className="ml-1 tabular-nums">{games.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {games.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Scheduled</TableHead>
                    <TableHead>Started</TableHead>
                    <TableHead>Ended</TableHead>
                    <TableHead className="text-right">Players</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {games.map((g) => (
                    <TableRow key={g.id}>
                      <TableCell>
                        <Link href={`/games/${g.id}`} className="text-sm font-medium hover:underline">{g.title}</Link>
                      </TableCell>
                      <TableCell><StatusBadge value={g.status} /></TableCell>
                      <TableCell className="text-xs text-muted-foreground">{formatDateTime(g.scheduled_at) ?? "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{formatDateTime(g.started_at) ?? "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{formatDateTime(g.ended_at) ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumber(g.total_participants ?? 0)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">No games generated yet.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function Kpi({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2">
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        <Icon className="size-3" />
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold">{value}</div>
    </div>
  );
}

function DetailRow({ icon: Icon, label, children }: { icon?: React.ComponentType<{ className?: string }>; label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {Icon && <Icon className="size-3" />}
        {label}
      </div>
      <div className="text-sm">{children}</div>
    </div>
  );
}

function ActivityRow({ label, game, emptyText }: { label: string; game: GameRow | null; emptyText: string }) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
      {game ? (
        <div className="rounded-md border bg-muted/30 p-2">
          <Link href={`/games/${game.id}`} className="text-sm font-medium hover:underline">{game.title}</Link>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <StatusBadge value={game.status} />
            <span>· {formatNumber(game.total_participants ?? 0)} players</span>
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            {game.ended_at
              ? <>Ended {formatRelative(game.ended_at)}</>
              : game.started_at
                ? <>Started {formatRelative(game.started_at)}</>
                : game.scheduled_at
                  ? <>Scheduled {formatRelative(game.scheduled_at)}</>
                  : "—"}
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{emptyText}</p>
      )}
    </div>
  );
}

function ColorChip({ color, compact = false }: { color: string; compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded border bg-muted/30 px-1.5 py-0.5">
      <span className="block size-3 rounded-sm border" style={{ backgroundColor: color }} />
      {!compact && <code className="font-mono text-[10px]">{color}</code>}
    </span>
  );
}
