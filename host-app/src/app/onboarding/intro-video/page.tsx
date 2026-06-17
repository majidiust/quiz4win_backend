"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Video, Square, RotateCcw, CheckCircle2, CameraOff, Lightbulb } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "https://api.quiz4win.com").replace(/\/$/, "");

const MAX_SECONDS = 120;
const REVEAL_AT = 10;
const MAX_BYTES = 25 * 1024 * 1024;

const SAMPLE = {
  question: "Which planet in our solar system is known as the Red Planet?",
  options: ["Venus", "Mars", "Jupiter", "Saturn"],
  correct: 1,
};

// Step-by-step script the host follows on camera.
const STEPS: { title: string; detail: string }[] = [
  { title: "Introduce yourself", detail: "Smile and say your name plus one line about you — e.g. \u201cHi, I\u2019m Sam and I love trivia nights!\u201d" },
  { title: "Host the question", detail: "Read the question below and all four options (A\u2013D) aloud, clearly and with energy, like you\u2019re live on air." },
  { title: "Build suspense", detail: "Pause for a beat, look into the camera, and give the audience a moment to think." },
  { title: "Reveal the answer", detail: "After 10 seconds the correct option lights up below \u2014 announce it with excitement and wrap up." },
];

// Quick best-practice tips for a great recording.
const TIPS: string[] = [
  "Find a bright, quiet spot \u2014 face a window or light source.",
  "Hold the phone steady at eye level and look into the lens.",
  "Speak clearly; keep it under 2 minutes.",
  "Not happy with a take? Re-record as many times as you like.",
];

function pickMime(): { type: string; ext: string } {
  const candidates = [
    "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4",
  ];
  const support = typeof MediaRecorder !== "undefined"
    ? MediaRecorder.isTypeSupported.bind(MediaRecorder) : () => false;
  const chosen = candidates.find((c) => support(c)) ?? "video/webm";
  return chosen.startsWith("video/mp4") ? { type: "video/mp4", ext: "mp4" } : { type: "video/webm", ext: "webm" };
}

type Phase = "idle" | "previewing" | "recording" | "recorded";

export default function IntroVideoPage() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const blobRef = useRef<Blob | null>(null);

  const [phase, setPhase] = useState<Phase>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [pending, startTransition] = useTransition();

  // ── Bug fix 1: unmount-only cleanup — never stops the stream mid-session ──
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // ── Bug fix 2: revoke blob URL only when it genuinely changes ──
  useEffect(() => {
    const url = recordedUrl;
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [recordedUrl]);

  // ── Bug fix 3: timer driven by phase, not by side effects inside setState ──
  useEffect(() => {
    if (phase !== "recording") return;
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [phase]);

  // ── Bug fix 4: reveal + auto-stop driven by elapsed, outside state updater ──
  const stopRecording = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      recorderRef.current.stop();
    }
  }, []);

  useEffect(() => {
    if (phase !== "recording") return;
    if (elapsed >= REVEAL_AT) setRevealed(true);
    if (elapsed >= MAX_SECONDS) stopRecording();
  }, [elapsed, phase, stopRecording]);

  // ── Auto-start camera preview on mount ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 1280 } }, audio: true,
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setCameraReady(true);
        setPhase("previewing");
      } catch {
        setError("Camera and microphone access is required. Please allow access and refresh.");
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startRecording() {
    setError(null);
    setRevealed(false);
    setElapsed(0);
    blobRef.current = null;
    if (recordedUrl) { URL.revokeObjectURL(recordedUrl); setRecordedUrl(null); }

    const stream = streamRef.current;
    if (!stream) { setError("Camera not ready — please allow access and try again."); return; }

    // Ensure live feed is showing
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      videoRef.current.muted = true;
      await videoRef.current.play().catch(() => {});
    }

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
    rec.start(500); // collect chunks every 500ms
    setPhase("recording");
  }

  function reRecord() {
    stopRecording();
    if (recordedUrl) { URL.revokeObjectURL(recordedUrl); setRecordedUrl(null); }
    blobRef.current = null;
    setElapsed(0);
    setRevealed(false);
    // Restore live preview
    if (videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.muted = true;
    }
    setPhase("previewing");
  }

  function upload() {
    const blob = blobRef.current;
    if (!blob) { setError("Record your intro first."); return; }
    if (blob.size > MAX_BYTES) { setError("Recording too large — record a shorter clip."); return; }
    const { ext, type } = pickMime();
    const file = new File([blob], `intro.${ext}`, { type });
    setError(null);
    startTransition(async () => {
      // Upload directly from the browser to the backend API so the video never
      // passes through a Next.js server action (which has a 1 MB default body
      // limit that is unreliable in standalone/Docker deployments).
      let token: string | undefined;
      try {
        const supabase = createSupabaseBrowserClient();
        const { data: { session } } = await supabase.auth.getSession();
        token = session?.access_token;
      } catch { /* proceed without token — backend will 401 */ }

      const fd = new FormData();
      fd.set("file_type", "intro_video");
      fd.set("file", file);

      let res: Response;
      try {
        res = await fetch(`${API_URL}/host/me/files`, {
          method: "POST",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body: fd,
        });
      } catch (e) {
        setError((e as Error).message ?? "Network error — please try again.");
        return;
      }

      if (res.ok) {
        streamRef.current?.getTracks().forEach((t) => t.stop());
        router.push("/onboarding/status");
      } else {
        let errCode = `http_${res.status}`;
        try {
          const json = await res.json() as { error?: string };
          errCode = json.error ?? errCode;
        } catch { /* ignore */ }
        const msg = errCode === "file_too_large" ? "Recording too large — please record a shorter clip"
          : errCode === "unsupported_mime" ? "This recording format isn't supported"
          : errCode === "unauthorized" ? "Session expired — please sign in again"
          : errCode;
        setError(msg);
      }
    });
  }

  const mmss = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;
  const remaining = Math.max(0, REVEAL_AT - elapsed);

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pb-6 pt-[max(env(safe-area-inset-top),24px)]">
      {/* Compact header */}
      <h1 className="text-xl font-semibold">Record your intro</h1>
      <p className="mt-0.5 text-xs text-[var(--color-q4w-muted)]">
        A short clip (up to 2 min) so our team can meet you — this is the final,
        required step of your application. Follow the steps below, host the sample
        question, and reveal the answer after 10 seconds.
      </p>

      {/* ── Video preview — always visible, compact 16:9 ── */}
      <div className="relative mt-3 overflow-hidden rounded-2xl border border-white/10 bg-black">
        {/* Playback after recording */}
        {phase === "recorded" && recordedUrl ? (
          <video src={recordedUrl} controls playsInline className="aspect-video w-full object-cover" />
        ) : (
          /* Live preview (idle / previewing / recording) */
          <div className="relative aspect-video w-full bg-black">
            <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-cover" />
            {!cameraReady && !error ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/20 border-t-white" />
              </div>
            ) : null}
            {error && phase === "idle" ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70 p-4 text-center">
                <CameraOff className="h-8 w-8 text-rose-400" />
                <p className="text-xs text-rose-300">{error}</p>
              </div>
            ) : null}
          </div>
        )}

        {/* REC badge */}
        {phase === "recording" ? (
          <div className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-black/70 px-2.5 py-1 text-xs font-semibold text-white">
            <span className="h-2 w-2 animate-pulse rounded-full bg-rose-500" />
            REC {mmss}
          </div>
        ) : null}

        {/* Progress bar */}
        {phase === "recording" ? (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-white/10">
            <div className="h-full bg-[var(--color-q4w-primary)] transition-all" style={{ width: `${(elapsed / MAX_SECONDS) * 100}%` }} />
          </div>
        ) : null}

        {/* Preview label when idle/previewing */}
        {(phase === "idle" || phase === "previewing") && cameraReady ? (
          <div className="absolute left-3 top-3 rounded-full bg-black/60 px-2 py-0.5 text-[10px] text-white/60">
            Preview
          </div>
        ) : null}
      </div>

      {/* ── Teleprompter card — always visible below video ── */}
      <Card className="mt-3 py-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-q4w-muted)]">Read aloud</span>
          {phase === "recording" ? (
            <span className={cn(
              "text-[11px] font-medium transition",
              revealed ? "text-emerald-400" : "text-amber-400",
            )}>
              {revealed ? "✓ Reveal answer now" : `Answer reveals in ${remaining}s`}
            </span>
          ) : (
            <span className="text-[11px] text-[var(--color-q4w-muted)]">Answer reveals after 10 s</span>
          )}
        </div>
        <p className="text-sm font-medium leading-snug">{SAMPLE.question}</p>
        <ul className="mt-2 flex flex-col gap-1.5">
          {SAMPLE.options.map((opt, i) => {
            const isAnswer = revealed && i === SAMPLE.correct;
            return (
              <li
                key={opt}
                className={cn(
                  "flex items-center gap-2 rounded-xl px-2.5 py-1.5 text-xs transition",
                  isAnswer
                    ? "border border-emerald-500/50 bg-emerald-500/10 text-emerald-200"
                    : "bg-white/5 text-[var(--color-q4w-muted)]",
                )}
              >
                <span className="w-4 shrink-0 font-bold">{String.fromCharCode(65 + i)}.</span>
                {opt}
                {isAnswer ? <CheckCircle2 className="ml-auto h-3.5 w-3.5" /> : null}
              </li>
            );
          })}
        </ul>
      </Card>

      {/* ── Comprehensive guide — steps + tips, shown before recording ── */}
      {(phase === "idle" || phase === "previewing") ? (
        <Card className="mt-3 py-3">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-q4w-muted)]">
            How to record a great intro
          </span>
          <ol className="mt-2 flex flex-col gap-2.5">
            {STEPS.map((step, i) => (
              <li key={step.title} className="flex items-start gap-2.5">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--color-q4w-primary)]/20 text-[11px] font-bold text-[var(--color-q4w-primary)]">
                  {i + 1}
                </span>
                <div>
                  <div className="text-xs font-medium text-[var(--color-q4w-text)]">{step.title}</div>
                  <div className="text-[11px] leading-snug text-[var(--color-q4w-muted)]">{step.detail}</div>
                </div>
              </li>
            ))}
          </ol>
          <div className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-2.5">
            <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-amber-300">
              <Lightbulb className="h-3.5 w-3.5" /> Tips
            </div>
            <ul className="flex flex-col gap-1">
              {TIPS.map((tip) => (
                <li key={tip} className="flex items-start gap-1.5 text-[11px] leading-snug text-[var(--color-q4w-muted)]">
                  <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-[var(--color-q4w-muted)]" />
                  {tip}
                </li>
              ))}
            </ul>
          </div>
        </Card>
      ) : null}

      {/* Error banner (non-camera errors) */}
      {error && phase !== "idle" ? (
        <div className="mt-3 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
          {error}
        </div>
      ) : null}

      {/* ── Controls ── */}
      <div className="mt-4 flex flex-col gap-2.5">
        {(phase === "idle" || phase === "previewing") ? (
          <Button type="button" onClick={startRecording} disabled={!cameraReady || !!error}>
            <Video className="mr-2 h-4 w-4" />
            {cameraReady ? "Start recording" : "Waiting for camera…"}
          </Button>
        ) : null}

        {phase === "recording" ? (
          <Button type="button" variant="danger" onClick={stopRecording}>
            <Square className="mr-2 h-4 w-4" /> Stop recording
          </Button>
        ) : null}

        {phase === "recorded" ? (
          <>
            <Button type="button" onClick={upload} loading={pending}>
              <CheckCircle2 className="mr-2 h-4 w-4" /> Upload &amp; continue
            </Button>
            <Button type="button" variant="secondary" onClick={reRecord} disabled={pending}>
              <RotateCcw className="mr-2 h-4 w-4" /> Re-record
            </Button>
          </>
        ) : null}
      </div>
    </main>
  );
}
