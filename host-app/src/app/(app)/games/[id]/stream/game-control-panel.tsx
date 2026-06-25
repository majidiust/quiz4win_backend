"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Room } from "livekit-client";
import {
  Eye, Play, Square, SkipForward, Flag, CheckCircle2,
  AlertTriangle, Clock, Users, Trophy, Hash,
} from "lucide-react";
import { Card, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
import { cn } from "@/lib/utils";
import { sendGameCommand, type GameCommand } from "./actions";

// ── Types ──────────────────────────────────────────────────────────────────────

interface QOption { id: string; text?: string }
interface CurrentQ { index: number; text: string; options: QOption[]; correctOptionId?: string }
interface ClosedStats {
  noAnswerCount: number;
  eliminatedCount: number;
  activeSurvivorCount: number;
  totalAnswers: number;
  prizePool: number | null;
  projectedPrizePerSurvivor: number | null;
}

/** waiting  — connected, GAME_STARTED not yet received
 *  countdown — GAME_STARTED received, ticking to firstQuestionStartsAt
 *  idle      — game running, ready for first question
 *  prepared  — QUESTION_PREPARED received (presenter preview)
 *  active    — QUESTION_STARTED broadcast (players answering)
 *  closed    — QUESTION_CLOSED (correct answer revealed, stats shown)
 *  ended     — GAME_ENDED */
type Phase = "waiting" | "countdown" | "idle" | "prepared" | "active" | "closed" | "ended";

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtCountdown(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function fmtMoney(v: number | null | undefined): string {
  if (v == null) return "—";
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

// ── Sub-components ─────────────────────────────────────────────────────────────

/** Animated waiting card shown before GAME_STARTED arrives. */
function WaitingCard({ onUnlock }: { onUnlock: () => void }) {
  const [showUnlock, setShowUnlock] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShowUnlock(true), 7000);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl bg-black/30 px-4 py-8 text-center gap-3">
      <div className="relative flex h-10 w-10 items-center justify-center">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400/30" />
        <Clock className="relative h-6 w-6 text-amber-400" />
      </div>
      <div>
        <p className="text-sm font-medium">Waiting for game to start</p>
        <p className="mt-1 text-xs text-[var(--color-q4w-muted)]">
          Controls unlock automatically when the orchestrator signals game start.
        </p>
      </div>
      {showUnlock && (
        <button
          type="button"
          onClick={onUnlock}
          className="text-xs text-[var(--color-q4w-muted)] underline underline-offset-2 hover:text-white transition-colors"
        >
          Game already running? Unlock controls
        </button>
      )}
    </div>
  );
}

/** Large countdown clock shown after GAME_STARTED (auto mode). */
function CountdownCard({ seconds }: { seconds: number }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl bg-black/30 px-4 py-8 text-center gap-2">
      <p className="text-[10px] uppercase tracking-widest text-[var(--color-q4w-muted)]">First question in</p>
      <p className="text-5xl font-bold tabular-nums tracking-tight">{fmtCountdown(seconds)}</p>
      <p className="text-xs text-[var(--color-q4w-muted)]">Get ready to host! ✨</p>
    </div>
  );
}

/** Stats grid — prize pool, survivors, prize per survivor, question number. */
function StatsBar({
  prizePool, survivors, prizePerSurvivor, questionNum, questionsCount,
}: {
  prizePool: number | null;
  survivors: number | null;
  prizePerSurvivor: number | null;
  questionNum: number | null;
  questionsCount: number | null;
}) {
  const qLabel = questionNum
    ? questionsCount ? `${questionNum}/${questionsCount}` : String(questionNum)
    : "—";
  return (
    <div className="mt-3 grid grid-cols-2 gap-2">
      <StatCell icon={Trophy} label="Prize pool" value={fmtMoney(prizePool)} accent={prizePool != null ? "emerald" : "muted"} />
      <StatCell icon={Hash} label="Question" value={qLabel} accent="muted" />
      <StatCell icon={Users} label="Survivors" value={survivors != null ? survivors.toLocaleString() : "—"} accent="muted" />
      <StatCell icon={Trophy} label="Per survivor" value={fmtMoney(prizePerSurvivor)} accent={prizePerSurvivor != null ? "emerald" : "muted"} />
    </div>
  );
}

function StatCell({
  icon: Icon, label, value, accent,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  accent: "emerald" | "muted";
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-xl bg-white/5 px-3 py-2.5">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-[var(--color-q4w-muted)]">
        <Icon className="h-3 w-3" />
        <span>{label}</span>
      </div>
      <span className={cn(
        "text-sm font-semibold tabular-nums",
        accent === "emerald" ? "text-emerald-400" : "text-white/80",
      )}>
        {value}
      </span>
    </div>
  );
}

/** Question detail card — question text, options, correct answer, post-close stats. */
function QuestionCard({
  current, phase, stats,
}: { current: CurrentQ; phase: Phase; stats: ClosedStats | null }) {
  return (
    <div className="rounded-2xl bg-black/30 p-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-[var(--color-q4w-muted)]">Question {current.index + 1}</p>
        {phase === "active" && (
          <span className="text-[11px] font-medium text-pink-400">● players answering</span>
        )}
        {phase === "prepared" && (
          <span className="text-[11px] font-medium text-purple-300">preview only</span>
        )}
      </div>
      <p className="mt-1 text-sm font-medium leading-snug">{current.text}</p>
      <div className="mt-2 flex flex-col gap-1.5">
        {current.options.map((o) => {
          const isCorrect = !!current.correctOptionId && o.id === current.correctOptionId;
          return (
            <div key={o.id} className={cn(
              "flex items-center gap-2 rounded-xl px-3 py-2 text-sm",
              isCorrect ? "bg-emerald-500/15 text-emerald-300" : "bg-white/5",
            )}>
              <span className="font-semibold">{o.id}.</span>
              <span className="flex-1">{o.text ?? ""}</span>
              {isCorrect && <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />}
            </div>
          );
        })}
      </div>
      {stats && (
        <div className="mt-2.5 space-y-1">
          <p className="text-xs text-[var(--color-q4w-muted)]">
            <span className="text-white/70">{stats.activeSurvivorCount}</span> survived ·{" "}
            <span className="text-rose-400">{stats.eliminatedCount}</span> eliminated ·{" "}
            {stats.noAnswerCount} no answer
          </p>
          {stats.projectedPrizePerSurvivor != null && (
            <p className="text-xs font-medium text-emerald-400">
              Prize per survivor: {fmtMoney(stats.projectedPrizePerSurvivor)}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

/**
 * Presenter-mode host control. Shown only for run_mode='presenter' games once the
 * host is live. Drives the question flow via the orchestrator (two-click flow:
 * Preview → Reveal) and renders the private QUESTION_PREPARED (correct answer)
 * plus live close stats received over the LiveKit data channel.
 *
 * Phase machine:
 *   waiting → (GAME_STARTED) → countdown / idle → prepared → active → closed → … → ended
 */
export function GameControlPanel({
  gameId, room, prizePool: initialPrize, questionsCount,
}: {
  gameId: string;
  room: Room | null;
  prizePool: number | null;
  questionsCount: number | null;
}) {
  const [phase, setPhase]     = useState<Phase>("waiting");
  const [current, setCurrent] = useState<CurrentQ | null>(null);
  const [stats, setStats]     = useState<ClosedStats | null>(null);
  const [busy, setBusy]       = useState<GameCommand | null>(null);
  const [error, setError]     = useState<string | null>(null);

  // Countdown
  const [firstQAt, setFirstQAt]     = useState<number | null>(null);
  const [countdown, setCountdown]   = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Running game stats (updated from events)
  const [survivors, setSurvivors]           = useState<number | null>(null);
  const [livePrize, setLivePrize]           = useState<number | null>(null);         // prizePool from events
  const [prizePerSurvivor, setPrizePerSurv] = useState<number | null>(null);
  const [liveQuestionsCount, setLiveQCount] = useState<number | null>(null);         // from GAME_STARTED

  const correctRef = useRef<string | undefined>(undefined);

  // Cleanup timer on unmount
  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  // Countdown ticker — re-runs whenever firstQAt changes
  useEffect(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (!firstQAt) return;
    const tick = () => {
      const secs = Math.max(0, Math.round((firstQAt - Date.now()) / 1000));
      setCountdown(secs);
      if (secs <= 0) {
        if (timerRef.current) clearInterval(timerRef.current);
        timerRef.current = null;
        setPhase((p) => p === "countdown" ? "idle" : p);
      }
    };
    tick(); // immediate first tick
    timerRef.current = setInterval(tick, 500);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [firstQAt]);

  // LiveKit data channel listener
  useEffect(() => {
    if (!room) return;
    const decoder = new TextDecoder();
    const onData = (payload: Uint8Array) => {
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(decoder.decode(payload)); } catch { return; }
      switch (String(msg.type ?? "")) {

        case "GAME_STARTED": {
          const fqAt = (msg.firstQuestionStartsAt as number | null) ?? null;
          setFirstQAt(fqAt);
          // Capture total questions count from the live event as a fallback
          const qc = msg.questionsCount != null ? Number(msg.questionsCount) : null;
          if (qc && !isNaN(qc)) setLiveQCount(qc);
          // presenter mode: fqAt is null → jump straight to idle
          setPhase(fqAt && fqAt > Date.now() ? "countdown" : "idle");
          break;
        }

        case "QUESTION_PREPARED":
          correctRef.current = msg.correctOptionId as string | undefined;
          setStats(null);
          setCurrent({
            index: Number(msg.questionIndex ?? 0),
            text: String(msg.canonicalText ?? ""),
            options: (msg.options as QOption[]) ?? [],
            correctOptionId: msg.correctOptionId as string | undefined,
          });
          setPhase("prepared");
          break;

        case "QUESTION_STARTED":
          setCurrent({
            index: Number(msg.questionIndex ?? 0),
            text: String(msg.questionText ?? ""),
            options: (msg.options as QOption[]) ?? [],
            correctOptionId: correctRef.current,
          });
          setPhase("active");
          break;

        case "QUESTION_CLOSED": {
          const closedStats: ClosedStats = {
            noAnswerCount: Number(msg.noAnswerCount ?? 0),
            eliminatedCount: Number(msg.eliminatedCount ?? 0),
            activeSurvivorCount: Number(msg.activeSurvivorCount ?? 0),
            totalAnswers: Number((msg.answerStats as { totalAnswers?: number })?.totalAnswers ?? 0),
            prizePool: (msg.prizePool as number | null) ?? null,
            projectedPrizePerSurvivor: (msg.projectedPrizePerSurvivor as number | null) ?? null,
          };
          setCurrent((c) => c ? { ...c, correctOptionId: (msg.correctOptionId as string) ?? c.correctOptionId } : c);
          setStats(closedStats);
          setSurvivors(closedStats.activeSurvivorCount);
          if (closedStats.prizePool != null) setLivePrize(closedStats.prizePool);
          setPrizePerSurv(closedStats.projectedPrizePerSurvivor);
          setPhase("closed");
          break;
        }

        case "GAME_ENDED":
          setPhase("ended");
          break;
      }
    };
    let cancelled = false; let cleanup = () => {};
    (async () => {
      const { RoomEvent } = await import("livekit-client");
      if (cancelled) return;
      room.on(RoomEvent.DataReceived, onData);
      cleanup = () => room.off(RoomEvent.DataReceived, onData);
    })();
    return () => { cancelled = true; cleanup(); };
  }, [room]);

  const send = useCallback(async (type: GameCommand) => {
    setBusy(type); setError(null);
    const r = await sendGameCommand(gameId, type);
    if (!r.ok) setError((r as { error: string }).error || "command_failed");
    setBusy(null);
  }, [gameId]);

  // Derived state
  const effectivePrize         = livePrize ?? initialPrize;
  const effectiveQuestionsCount = liveQuestionsCount ?? questionsCount;
  const currentQNum            = current ? current.index + 1 : null;
  const showStats              = !["waiting", "countdown"].includes(phase);
  const canAct                 = !["waiting", "countdown"].includes(phase);
  const ended          = phase === "ended";

  const primary: { label: string; Icon: typeof Eye; cmd: GameCommand } | null =
    phase === "idle"    ? { label: "Preview first question", Icon: Eye,    cmd: "PrepareQuestion" }
    : phase === "closed"  ? { label: "Preview next question",  Icon: Eye,    cmd: "PrepareQuestion" }
    : phase === "prepared"? { label: "Reveal to players",      Icon: Play,   cmd: "StartQuestion"   }
    : phase === "active"  ? { label: "Close question",         Icon: Square, cmd: "CloseQuestion"   }
    : null;

  const showSkip = phase === "idle" || phase === "closed";

  return (
    <Card className="flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between">
        <CardTitle>Game control</CardTitle>
        <StatusChip status={phase} />
      </div>

      {/* Error bar */}
      {error ? (
        <div className="mt-3 flex items-center gap-2 rounded-2xl border border-[var(--color-q4w-danger)]/40 bg-[var(--color-q4w-danger)]/10 px-3 py-2 text-xs text-rose-300">
          <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
        </div>
      ) : null}

      {/* Stats bar — prize, survivors, per-survivor, question # */}
      {showStats && (
        <StatsBar
          prizePool={effectivePrize}
          survivors={survivors}
          prizePerSurvivor={prizePerSurvivor}
          questionNum={currentQNum}
          questionsCount={effectiveQuestionsCount}
        />
      )}

      {/* Phase-specific content — max-height caps height so action bar stays visible */}
      <div className="mt-3 max-h-[38vh] overflow-y-auto">
        {phase === "waiting" ? (
          <WaitingCard onUnlock={() => setPhase("idle")} />
        ) : phase === "countdown" && countdown != null ? (
          <CountdownCard seconds={countdown} />
        ) : current ? (
          <QuestionCard current={current} phase={phase} stats={stats} />
        ) : ended ? (
          <div className="flex flex-col items-center justify-center rounded-2xl bg-black/30 px-4 py-6 text-center">
            <CheckCircle2 className="h-8 w-8 text-emerald-400" />
            <p className="mt-2 text-sm font-medium">Game finished</p>
            <p className="text-xs text-[var(--color-q4w-muted)]">All questions complete — you can end the stream.</p>
          </div>
        ) : (
          <p className="py-4 text-center text-xs text-[var(--color-q4w-muted)]">Waiting for the first question…</p>
        )}
      </div>

      {/* Action bar — hidden during waiting / countdown */}
      {canAct && (
        <div className="mt-3 flex flex-col gap-2">
          {primary ? (
            <Button onClick={() => send(primary.cmd)} disabled={busy !== null} loading={busy === primary.cmd}>
              <primary.Icon className="mr-2 h-4 w-4" /> {primary.label}
            </Button>
          ) : null}
          <div className="flex gap-2">
            {showSkip && (
              <Button variant="secondary" className="flex-1" onClick={() => send("AdvanceQuestion")} disabled={busy !== null} loading={busy === "AdvanceQuestion"}>
                <SkipForward className="mr-2 h-4 w-4" /> Skip preview
              </Button>
            )}
            <Button
              variant="danger"
              className={showSkip ? "flex-1" : "w-full"}
              onClick={() => send("FinalizeGame")}
              disabled={ended || busy !== null}
              loading={busy === "FinalizeGame"}
            >
              <Flag className="mr-2 h-4 w-4" /> Finalize
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
