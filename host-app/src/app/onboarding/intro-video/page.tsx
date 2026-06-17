"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Video, Square, RotateCcw, CheckCircle2 } from "lucide-react";
import { Card, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { uploadIntroVideoAction } from "./actions";

const MAX_SECONDS = 120; // 2-minute cap
const REVEAL_AT = 10; // reveal the answer after 10s, for the audience
const MAX_BYTES = 25 * 1024 * 1024;

// Sample question the host reads aloud while recording their intro.
const SAMPLE = {
  question: "Which planet in our solar system is known as the Red Planet?",
  options: ["Venus", "Mars", "Jupiter", "Saturn"],
  correct: 1,
};

type Phase = "idle" | "recording" | "recorded";

export default function IntroVideoPage() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const blobRef = useRef<Blob | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    if (recordedUrl) URL.revokeObjectURL(recordedUrl);
  }, [recordedUrl]);

  function pickMime(): { type: string; ext: string } {
    const candidates = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"];
    const support = typeof MediaRecorder !== "undefined" ? MediaRecorder.isTypeSupported.bind(MediaRecorder) : () => false;
    const chosen = candidates.find((c) => support(c)) ?? "video/webm";
    return chosen.startsWith("video/mp4") ? { type: "video/mp4", ext: "mp4" } : { type: "video/webm", ext: "webm" };
  }

  async function startRecording() {
    setError(null);
    setRevealed(false);
    setElapsed(0);
    blobRef.current = null;
    if (recordedUrl) { URL.revokeObjectURL(recordedUrl); setRecordedUrl(null); }
    try {
      const stream = streamRef.current ?? await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 } }, audio: true,
      });
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.muted = true; await videoRef.current.play().catch(() => {}); }

      const { type } = pickMime();
      chunksRef.current = [];
      const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 1_000_000, audioBitsPerSecond: 128_000 });
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type });
        blobRef.current = blob;
        setRecordedUrl(URL.createObjectURL(blob));
        setPhase("recorded");
      };
      recorderRef.current = rec;
      rec.start();
      setPhase("recording");
      timerRef.current = setInterval(() => {
        setElapsed((s) => {
          const next = s + 1;
          if (next >= REVEAL_AT) setRevealed(true);
          if (next >= MAX_SECONDS) stopRecording();
          return next;
        });
      }, 1000);
    } catch {
      setError("Camera/microphone access is required to record your intro.");
    }
  }

  function stopRecording() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop();
  }

  function reRecord() {
    if (recordedUrl) { URL.revokeObjectURL(recordedUrl); setRecordedUrl(null); }
    blobRef.current = null;
    setPhase("idle");
    setElapsed(0);
    setRevealed(false);
    if (videoRef.current && streamRef.current) { videoRef.current.srcObject = streamRef.current; videoRef.current.muted = true; }
  }

  function upload() {
    const blob = blobRef.current;
    if (!blob) { setError("Record your intro first."); return; }
    if (blob.size > MAX_BYTES) { setError("Recording too large — please record a shorter clip."); return; }
    const { ext, type } = pickMime();
    const file = new File([blob], `intro.${ext}`, { type });
    const fd = new FormData();
    fd.set("file", file);
    setError(null);
    startTransition(async () => {
      const r = await uploadIntroVideoAction(fd);
      if (r.ok) { streamRef.current?.getTracks().forEach((t) => t.stop()); router.push("/dashboard?welcome=1"); }
      else setError(r.error);
    });
  }

  const mmss = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pb-10 pt-[max(env(safe-area-inset-top),32px)]">
      <h1 className="text-2xl font-semibold">Record your intro</h1>
      <p className="mt-1 text-sm text-[var(--color-q4w-muted)]">
        A short (up to 2 minutes) clip so our team can meet you. Read the question and its
        options aloud, then after 10 seconds reveal the correct answer to the audience.
      </p>
      <IntroBody
        videoRef={videoRef} phase={phase} elapsed={elapsed} mmss={mmss} revealed={revealed}
        recordedUrl={recordedUrl} error={error} pending={pending}
        onStart={startRecording} onStop={stopRecording} onReRecord={reRecord} onUpload={upload}
        onSkip={() => { streamRef.current?.getTracks().forEach((t) => t.stop()); router.push("/dashboard?welcome=1"); }}
      />
    </main>
  );
}

interface BodyProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  phase: Phase; elapsed: number; mmss: string; revealed: boolean;
  recordedUrl: string | null; error: string | null; pending: boolean;
  onStart: () => void; onStop: () => void; onReRecord: () => void; onUpload: () => void; onSkip: () => void;
}

function IntroBody(p: BodyProps) {
  const remaining = Math.max(0, REVEAL_AT - p.elapsed);
  return (
    <div className="mt-5 flex flex-col gap-4">
      <Card>
        <CardTitle className="mb-2">Read this aloud</CardTitle>
        <p className="text-sm font-medium">{SAMPLE.question}</p>
        <ul className="mt-3 flex flex-col gap-2">
          {SAMPLE.options.map((opt, i) => {
            const isAnswer = p.revealed && i === SAMPLE.correct;
            return (
              <li
                key={opt}
                className={cn(
                  "flex items-center gap-2 rounded-2xl px-3 py-2 text-sm transition",
                  isAnswer
                    ? "border border-emerald-500/50 bg-emerald-500/15 text-emerald-200"
                    : "glass text-[var(--color-q4w-muted)]",
                )}
              >
                <span className="font-semibold">{String.fromCharCode(65 + i)}.</span>
                {opt}
                {isAnswer ? <CheckCircle2 className="ml-auto h-4 w-4" /> : null}
              </li>
            );
          })}
        </ul>
        <div className="mt-3 text-[11px] text-[var(--color-q4w-muted)]">
          {p.phase !== "recording"
            ? "The answer reveals automatically 10 seconds after you start recording."
            : p.revealed
              ? "✓ Answer revealed — present it to the audience."
              : `Reveal the answer in ${remaining}s…`}
        </div>
      </Card>

      <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-black">
        {p.phase === "recorded" && p.recordedUrl ? (
          <video src={p.recordedUrl} controls playsInline className="aspect-[3/4] w-full object-cover" />
        ) : (
          <video ref={p.videoRef} autoPlay playsInline muted className="aspect-[3/4] w-full object-cover" />
        )}
        {p.phase === "recording" ? (
          <div className="absolute left-3 top-3 flex items-center gap-2 rounded-full bg-black/60 px-3 py-1 text-xs font-medium text-white">
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-rose-500" />
            REC {p.mmss}
          </div>
        ) : null}
        {p.phase === "recording" ? (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-white/10">
            <div className="h-full bg-[var(--color-q4w-primary)]" style={{ width: `${(p.elapsed / MAX_SECONDS) * 100}%` }} />
          </div>
        ) : null}
      </div>

      {p.error ? (
        <div className="rounded-2xl border border-[var(--color-q4w-danger)]/40 bg-[var(--color-q4w-danger)]/10 px-3 py-2 text-xs text-rose-300">
          {p.error}
        </div>
      ) : null}

      <div className="flex flex-col gap-3">
        {p.phase === "idle" ? (
          <Button type="button" onClick={p.onStart}>
            <Video className="mr-2 h-4 w-4" /> Start recording
          </Button>
        ) : null}
        {p.phase === "recording" ? (
          <Button type="button" variant="danger" onClick={p.onStop}>
            <Square className="mr-2 h-4 w-4" /> Stop recording
          </Button>
        ) : null}
        {p.phase === "recorded" ? (
          <>
            <Button type="button" onClick={p.onUpload} loading={p.pending}>
              <CheckCircle2 className="mr-2 h-4 w-4" /> Upload &amp; finish
            </Button>
            <Button type="button" variant="secondary" onClick={p.onReRecord} disabled={p.pending}>
              <RotateCcw className="mr-2 h-4 w-4" /> Re-record
            </Button>
          </>
        ) : null}
        <Button type="button" variant="ghost" onClick={p.onSkip} disabled={p.pending}>
          Skip for now
        </Button>
      </div>
    </div>
  );
}
