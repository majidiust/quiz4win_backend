"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Room } from "livekit-client";
import { Eye, Play, Square, SkipForward, Flag, CheckCircle2, AlertTriangle } from "lucide-react";
import { Card, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
import { cn } from "@/lib/utils";
import { sendGameCommand, type GameCommand } from "./actions";

interface QOption { id: string; text?: string }
interface CurrentQ { index: number; text: string; options: QOption[]; correctOptionId?: string }
interface ClosedStats { noAnswerCount: number; eliminatedCount: number; activeSurvivorCount: number; totalAnswers: number }
type Phase = "idle" | "prepared" | "active" | "closed" | "ended";

/**
 * Presenter-mode host control. Shown only for run_mode='presenter' games once the
 * host is live. Drives the question flow via the orchestrator (two-click flow:
 * Preview → Reveal) and renders the private QUESTION_PREPARED (correct answer)
 * plus live close stats received over the LiveKit data channel.
 */
export function GameControlPanel({ gameId, room }: { gameId: string; room: Room | null }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [current, setCurrent] = useState<CurrentQ | null>(null);
  const [stats, setStats] = useState<ClosedStats | null>(null);
  const [busy, setBusy] = useState<GameCommand | null>(null);
  const [error, setError] = useState<string | null>(null);
  const correctRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!room) return;
    const decoder = new TextDecoder();
    const onData = (payload: Uint8Array) => {
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(decoder.decode(payload)); } catch { return; }
      switch (String(msg.type ?? "")) {
        case "QUESTION_PREPARED":
          correctRef.current = msg.correctOptionId as string | undefined;
          setStats(null);
          setCurrent({
            index: Number(msg.questionIndex ?? 0), text: String(msg.canonicalText ?? ""),
            options: (msg.options as QOption[]) ?? [], correctOptionId: msg.correctOptionId as string | undefined,
          });
          setPhase("prepared");
          break;
        case "QUESTION_STARTED":
          setCurrent({
            index: Number(msg.questionIndex ?? 0), text: String(msg.questionText ?? ""),
            options: (msg.options as QOption[]) ?? [], correctOptionId: correctRef.current,
          });
          setPhase("active");
          break;
        case "QUESTION_CLOSED":
          setCurrent((c) => c ? { ...c, correctOptionId: (msg.correctOptionId as string) ?? c.correctOptionId } : c);
          setStats({
            noAnswerCount: Number(msg.noAnswerCount ?? 0), eliminatedCount: Number(msg.eliminatedCount ?? 0),
            activeSurvivorCount: Number(msg.activeSurvivorCount ?? 0),
            totalAnswers: Number((msg.answerStats as { totalAnswers?: number })?.totalAnswers ?? 0),
          });
          setPhase("closed");
          break;
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

  const ended = phase === "ended";
  // One clear primary action per phase — no grid of disabled buttons.
  const primary: { label: string; Icon: typeof Eye; cmd: GameCommand } | null =
    phase === "prepared" ? { label: "Reveal to players", Icon: Play, cmd: "StartQuestion" }
    : phase === "active" ? { label: "Close question", Icon: Square, cmd: "CloseQuestion" }
    : phase === "idle" ? { label: "Preview question", Icon: Eye, cmd: "PrepareQuestion" }
    : phase === "closed" ? { label: "Next question", Icon: Eye, cmd: "PrepareQuestion" }
    : null;
  const showSkip = phase === "idle" || phase === "closed";

  return (
    <Card className="flex flex-col">
      <div className="flex items-center justify-between">
        <CardTitle>Game control</CardTitle>
        <StatusChip status={phase} />
      </div>

      {error ? (
        <div className="mt-3 flex items-center gap-2 rounded-2xl border border-[var(--color-q4w-danger)]/40 bg-[var(--color-q4w-danger)]/10 px-3 py-2 text-xs text-rose-300">
          <AlertTriangle className="h-4 w-4" /> {error}
        </div>
      ) : null}

      {/* Question detail — caps height & scrolls internally so the action
          bar below stays visible without scrolling the page. */}
      <div className="mt-3 max-h-[42vh] overflow-y-auto">
        {current ? (
          <div className="rounded-2xl bg-black/30 p-3">
            <div className="flex items-center justify-between">
              <p className="text-xs text-[var(--color-q4w-muted)]">Question {current.index + 1}</p>
              {phase === "active" ? <span className="text-[11px] font-medium text-pink-400">● players answering</span> : null}
            </div>
            <p className="mt-1 text-sm font-medium">{current.text}</p>
            <div className="mt-2 flex flex-col gap-1.5">
              {current.options.map((o) => {
                const isCorrect = current.correctOptionId && o.id === current.correctOptionId;
                return (
                  <div key={o.id} className={cn(
                    "flex items-center gap-2 rounded-xl px-3 py-2 text-sm",
                    isCorrect ? "bg-emerald-500/15 text-emerald-300" : "bg-white/5",
                  )}>
                    <span className="font-semibold">{o.id}.</span>
                    <span className="flex-1">{o.text ?? ""}</span>
                    {isCorrect ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : null}
                  </div>
                );
              })}
            </div>
            {stats ? (
              <p className="mt-2 text-xs text-[var(--color-q4w-muted)]">
                {stats.totalAnswers} answered · {stats.noAnswerCount} no-answer · {stats.eliminatedCount} eliminated · {stats.activeSurvivorCount} survivors
              </p>
            ) : null}
          </div>
        ) : ended ? (
          <div className="flex flex-col items-center justify-center rounded-2xl bg-black/30 px-4 py-6 text-center">
            <CheckCircle2 className="h-8 w-8 text-emerald-400" />
            <p className="mt-2 text-sm font-medium">Game finished</p>
            <p className="text-xs text-[var(--color-q4w-muted)]">All questions complete — you can end the stream.</p>
          </div>
        ) : (
          <p className="text-xs text-[var(--color-q4w-muted)]">Waiting for the game to start…</p>
        )}
      </div>

      {/* Action bar — always visible. One phase-driven primary action. */}
      <div className="mt-3 flex flex-col gap-2">
        {primary ? (
          <Button onClick={() => send(primary.cmd)} disabled={busy !== null} loading={busy === primary.cmd}>
            <primary.Icon className="mr-2 h-4 w-4" /> {primary.label}
          </Button>
        ) : null}
        <div className="flex gap-2">
          {showSkip ? (
            <Button variant="secondary" className="flex-1" onClick={() => send("AdvanceQuestion")} disabled={busy !== null} loading={busy === "AdvanceQuestion"}>
              <SkipForward className="mr-2 h-4 w-4" /> Skip preview
            </Button>
          ) : null}
          <Button variant="danger" className={showSkip ? "flex-1" : "w-full"} onClick={() => send("FinalizeGame")} disabled={ended || busy !== null} loading={busy === "FinalizeGame"}>
            <Flag className="mr-2 h-4 w-4" /> Finalize
          </Button>
        </div>
      </div>
    </Card>
  );
}
