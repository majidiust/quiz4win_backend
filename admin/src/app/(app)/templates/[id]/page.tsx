import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, CalendarClock, Bot, History as HistoryIcon, Pencil } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { PageHeader } from "@/components/shell/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import { formatDateTime, formatMoneyDecimal, formatNumber } from "@/lib/utils";
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

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <CalendarClock className="size-4" /> Schedule &amp; configuration
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[140px,1fr] gap-y-2 text-sm">
              <dt className="text-muted-foreground">Status</dt>
              <dd><Badge variant={tpl.is_active ? "default" : "outline"}>{tpl.is_active ? "Active" : "Inactive"}</Badge></dd>

              <dt className="text-muted-foreground">Cron</dt>
              <dd className="font-mono text-xs">{tpl.cron_expression}</dd>

              <dt className="text-muted-foreground">Duration</dt>
              <dd>{tpl.duration_minutes} min</dd>

              <dt className="text-muted-foreground">Start buffer</dt>
              <dd>{tpl.start_buffer_seconds} s</dd>

              <dt className="text-muted-foreground">Mode</dt>
              <dd className="capitalize">{tpl.mode}</dd>

              <dt className="text-muted-foreground">Language</dt>
              <dd className="uppercase">{tpl.language}</dd>

              <dt className="text-muted-foreground">Category</dt>
              <dd>{tpl.category ?? "—"}</dd>

              <dt className="text-muted-foreground">Difficulty</dt>
              <dd>{tpl.difficulty ?? "—"}</dd>

              <dt className="text-muted-foreground">Entry / Pool</dt>
              <dd className="font-mono text-xs">
                {formatMoneyDecimal(tpl.entry_fee)} <span className="text-muted-foreground">/</span>{" "}
                <span className="text-success">{formatMoneyDecimal(tpl.prize_pool)} {tpl.prize_pool_currency}</span>
              </dd>

              <dt className="text-muted-foreground">Max players</dt>
              <dd>{tpl.max_players ?? "Unlimited"}</dd>

              <dt className="text-muted-foreground">Questions</dt>
              <dd>{tpl.questions_count} × {tpl.time_per_question}s</dd>

              <dt className="text-muted-foreground">Q filters</dt>
              <dd className="text-xs">
                {[tpl.question_category, tpl.question_difficulty, tpl.question_language].filter(Boolean).join(" · ") || "Any"}
              </dd>

              <dt className="text-muted-foreground">Generated</dt>
              <dd>{tpl.total_games_generated ?? 0}</dd>

              <dt className="text-muted-foreground">Last run</dt>
              <dd>{formatDateTime(tpl.last_generated_at) ?? "Never"}</dd>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Bot className="size-4" /> AI Presenter
            </CardTitle>
          </CardHeader>
          <CardContent>
            {tpl.ai_enabled ? (
              <dl className="grid grid-cols-[140px,1fr] gap-y-2 text-sm">
                <dt className="text-muted-foreground">Status</dt>
                <dd><Badge>Enabled</Badge></dd>
                <dt className="text-muted-foreground">Avatar ID</dt>
                <dd className="font-mono text-xs break-all">{tpl.ai_avatar_id ?? "—"}</dd>
                <dt className="text-muted-foreground">Voice ID</dt>
                <dd className="font-mono text-xs break-all">{tpl.ai_sound_id ?? "—"}</dd>
                <dt className="text-muted-foreground">Duration</dt>
                <dd>{tpl.ai_duration ? `${tpl.ai_duration} s` : "—"}</dd>
                <dt className="text-muted-foreground">Language</dt>
                <dd className="uppercase">{tpl.ai_language ?? tpl.language}</dd>
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">AI presenter is disabled for this template.</p>
            )}
          </CardContent>
        </Card>

        {currentGame ? (
          <Card>
            <CardHeader><CardTitle className="text-sm">Current game</CardTitle></CardHeader>
            <CardContent>
              <Link href={`/games/${currentGame.id}`} className="hover:underline">
                <div className="text-sm font-medium">{currentGame.title}</div>
              </Link>
              <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                <StatusBadge value={currentGame.status} />
                <span>Scheduled: {formatDateTime(currentGame.scheduled_at) ?? "—"}</span>
                <span>· {formatNumber(currentGame.total_participants ?? 0)} players</span>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {lastGame ? (
          <Card>
            <CardHeader><CardTitle className="text-sm">Last completed game</CardTitle></CardHeader>
            <CardContent>
              <Link href={`/games/${lastGame.id}`} className="hover:underline">
                <div className="text-sm font-medium">{lastGame.title}</div>
              </Link>
              <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                <StatusBadge value={lastGame.status} />
                <span>Ended: {formatDateTime(lastGame.ended_at) ?? "—"}</span>
                <span>· {formatNumber(lastGame.total_participants ?? 0)} players</span>
              </div>
            </CardContent>
          </Card>
        ) : null}
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <HistoryIcon className="size-4" /> Generated games ({games.length})
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
    </>
  );
}
