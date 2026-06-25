"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Room } from "livekit-client";
import { Eye, Play, Square, SkipForward, Flag, CheckCircle2, AlertTriangle } from "lucide-react";
import { Card, CardSubtitle, CardTitle } from "@/components/ui/card";
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
  const canPreview = !ended && (phase === "idle" || phase === "closed");
  const canReveal = phase === "prepared";
  const canClose = phase === "active";

  return (
    <Card className="mb-3">
      <div className="flex items-center justify-between">
        <CardTitle>Game control</CardTitle>
        <StatusChip status={phase} />
      </div>
      <CardSubtitle>You drive the questions. Preview privately, then reveal to players.</CardSubtitle>

      {error ? (
        <div className="mt-3 flex items-center gap-2 rounded-2xl border border-[var(--color-q4w-danger)]/40 bg-[var(--color-q4w-danger)]/10 px-3 py-2 text-xs text-rose-300">
          <AlertTriangle className="h-4 w-4" /> {error}
        </div>
      ) : null}

      {current ? (
        <div className="mt-3 rounded-2xl bg-black/30 p-3">
          <p className="text-xs text-[var(--color-q4w-muted)]">Question {current.index + 1}</p>
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
      ) : (
        <p className="mt-3 text-xs text-[var(--color-q4w-muted)]">Waiting for the game to start…</p>
      )}

      <div className="mt-4 grid grid-cols-2 gap-3">
        <Button variant="secondary" onClick={() => send("PrepareQuestion")} disabled={!canPreview || busy !== null} loading={busy === "PrepareQuestion"}>
          <Eye className="mr-2 h-4 w-4" /> Preview
        </Button>
        <Button onClick={() => send("StartQuestion")} disabled={!canReveal || busy !== null} loading={busy === "StartQuestion"}>
          <Play className="mr-2 h-4 w-4" /> Reveal
        </Button>
        <Button variant="secondary" onClick={() => send("CloseQuestion")} disabled={!canClose || busy !== null} loading={busy === "CloseQuestion"}>
          <Square className="mr-2 h-4 w-4" /> Close now
        </Button>
        <Button variant="secondary" onClick={() => send("AdvanceQuestion")} disabled={!canPreview || busy !== null} loading={busy === "AdvanceQuestion"}>
          <SkipForward className="mr-2 h-4 w-4" /> Skip preview
        </Button>
      </div>
      <Button variant="danger" className="mt-3" onClick={() => send("FinalizeGame")} disabled={ended || busy !== null} loading={busy === "FinalizeGame"}>
        <Flag className="mr-2 h-4 w-4" /> Finalize game
      </Button>
    </Card>
  );
}
