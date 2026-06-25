"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Mic, Wifi, CheckCircle2, AlertTriangle, Radio } from "lucide-react";
import { Card, CardSubtitle, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
import { cn } from "@/lib/utils";
import { patchSession, goLive, endStream } from "./actions";
import { ARToggleButton, ARPanel, useARState, type ARBackground } from "./ar-panel";
import { GameControlPanel } from "./game-control-panel";
import MediaPipeAR from "@/components/ar-preview";

interface Session { id: string; status: string; camera_ok: boolean; mic_ok: boolean; connection_ok: boolean }

export function StreamWizard({
  gameId, initialSession, arBackgrounds, runMode,
}: { gameId: string; initialSession: Session | null; livekitRoom: string; arBackgrounds: ARBackground[]; runMode?: string | null }) {
  const [session, setSession] = useState<Session | null>(initialSession);
  const [camOk, setCamOk]   = useState(initialSession?.camera_ok ?? false);
  const [micOk, setMicOk]   = useState(initialSession?.mic_ok ?? false);
  const [netOk, setNetOk]   = useState(initialSession?.connection_ok ?? false);
  const [busy, setBusy]     = useState<string | null>(null);
  const [error, setError]   = useState<string | null>(null);
  const [token, setToken]   = useState<string | null>(null);
  const [room, setRoom]     = useState<import("livekit-client").Room | null>(null);
  const videoRef  = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const arContainerRef = useRef<HTMLDivElement | null>(null);
  const livekitRoomRef = useRef<import("livekit-client").Room | null>(null);

  // AR + voice state
  const {
    arEnabled, selectedEffect, setSelectedEffect, arStream, setArStream, toggleAR,
    selectedVoiceEffect, setSelectedVoiceEffect, applyVoiceEffect, destroyVoiceEffect,
  } = useARState();

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    livekitRoomRef.current?.disconnect();
    destroyVoiceEffect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const persist = useCallback(async (patch: Parameters<typeof patchSession>[1]) => {
    const r = await patchSession(gameId, patch);
    if (r.ok && r.data && typeof r.data === "object" && "session" in r.data) {
      setSession((r.data as { session: Session }).session);
    }
  }, [gameId]);

  async function testCamera() {
    setBusy("cam"); setError(null);
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = s;
      if (videoRef.current) { videoRef.current.srcObject = s; videoRef.current.play().catch(() => {}); }
      setCamOk(true);
      await persist({ camera_ok: true, status: "testing" });
    } catch (e) { setError((e as Error).message || "Camera failed"); setCamOk(false); await persist({ camera_ok: false }); }
    finally { setBusy(null); }
  }

  async function testMic() {
    setBusy("mic"); setError(null);
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      const src = ctx.createMediaStreamSource(s);
      const an = ctx.createAnalyser();
      src.connect(an);
      await new Promise((r) => setTimeout(r, 600));
      s.getTracks().forEach((t) => t.stop()); await ctx.close();
      setMicOk(true);
      await persist({ mic_ok: true, status: "testing" });
    } catch (e) { setError((e as Error).message || "Microphone failed"); setMicOk(false); await persist({ mic_ok: false }); }
    finally { setBusy(null); }
  }

  async function testNet() {
    setBusy("net"); setError(null);
    try {
      const t0 = performance.now();
      await fetch(`${window.location.origin}/?_=${Date.now()}`, { method: "HEAD", cache: "no-store" });
      const ok = performance.now() - t0 < 2500;
      setNetOk(ok);
      await persist({ connection_ok: ok, status: "testing" });
    } catch { setNetOk(false); await persist({ connection_ok: false }); }
    finally { setBusy(null); }
  }

  async function markReady() {
    setBusy("ready");
    await persist({ camera_ok: camOk, mic_ok: micOk, connection_ok: netOk, status: "ready" });
    setBusy(null);
  }

  async function startLive() {
    setBusy("live"); setError(null);
    const r = await goLive(gameId);
    if (!r.ok) { setError((r as { error: string }).error || "Failed to go live"); setBusy(null); return; }

    const { token: lkToken, room_name, livekit_url } = r.data as { token: string; room_name: string; livekit_url: string };
    setToken(lkToken);
    setSession({ ...(session as Session), status: "live" });

    // Browser-based LiveKit publishing
    if (livekit_url && lkToken) {
      try {
        const { Room, RoomEvent } = await import("livekit-client");
        const room = new Room();
        livekitRoomRef.current = room;

        // Determine video source: AR canvas stream or raw camera
        const videoSource = arEnabled && arStream ? arStream.getVideoTracks()[0] : streamRef.current?.getVideoTracks()[0];
        // Get mic and apply selected voice effect (passthrough when effect is "none")
        let audioTrack: MediaStreamTrack | undefined;
        try {
          const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          const processedStream = await applyVoiceEffect(micStream);
          audioTrack = processedStream.getAudioTracks()[0];
        } catch { /* mic optional */ }

        await room.connect(livekit_url, lkToken);
        setRoom(room);

        if (videoSource) {
          const { LocalVideoTrack } = await import("livekit-client");
          const lvt = new LocalVideoTrack(videoSource);
          await room.localParticipant.publishTrack(lvt);
        }
        if (audioTrack) {
          const { LocalAudioTrack } = await import("livekit-client");
          const lat = new LocalAudioTrack(audioTrack);
          await room.localParticipant.publishTrack(lat);
        }

        room.on(RoomEvent.Disconnected, () => { livekitRoomRef.current = null; setRoom(null); });
      } catch (err) {
        console.error("[stream-wizard] LiveKit publish error:", err instanceof Error ? err.message : err);
        // Non-fatal: token is still shown so OBS fallback works
      }
    }

    setBusy(null);
  }

  async function stopLive() {
    setBusy("end");
    livekitRoomRef.current?.disconnect();
    livekitRoomRef.current = null;
    setRoom(null);
    destroyVoiceEffect();
    await endStream(gameId, {});
    setSession({ ...(session as Session), status: "ended" });
    streamRef.current?.getTracks().forEach((t) => t.stop());
    setBusy(null);
  }

  const allOk = camOk && micOk && netOk;
  const isLive = session?.status === "live";

  return (
    <>
      {error ? (
        <div className="mb-3 flex items-center gap-2 rounded-2xl border border-[var(--color-q4w-danger)]/40 bg-[var(--color-q4w-danger)]/10 px-3 py-2 text-xs text-rose-300">
          <AlertTriangle className="h-4 w-4" /> {error}
        </div>
      ) : null}

      <Card className="mb-3">
        <div className="flex items-center justify-between">
          <CardTitle>Session</CardTitle>
          <StatusChip status={session?.status ?? "created"} />
        </div>

        {/* Camera / AR preview */}
        <div ref={arContainerRef} className="relative mt-3 aspect-video w-full overflow-hidden rounded-2xl bg-black/40">
          {/* Raw camera preview — hidden when AR is active (AR canvas overlays it) */}
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video ref={videoRef} playsInline muted className={cn("h-full w-full object-cover", arEnabled && "invisible")} />
          {/* AR component renders its canvas inside arContainerRef */}
          <MediaPipeAR
            enabled={arEnabled}
            selectedEffect={selectedEffect}
            containerRef={arContainerRef}
            onStreamReady={setArStream}
          />
        </div>

        {/* AR toggle */}
        <div className="mt-3 flex justify-end">
          <ARToggleButton arEnabled={arEnabled} onToggle={toggleAR} disabled={!camOk} />
        </div>

        {/* AR + voice effects panel — shown only when AR is on */}
        {arEnabled && (
          <ARPanel
            presets={arBackgrounds}
            selectedEffect={selectedEffect}
            onEffectChange={setSelectedEffect}
            selectedVoiceEffect={selectedVoiceEffect}
            onVoiceEffectChange={setSelectedVoiceEffect}
          />
        )}
      </Card>

      <Check icon={Camera} label="Camera"          ok={camOk} busy={busy === "cam"} onClick={testCamera} />
      <Check icon={Mic}    label="Microphone"      ok={micOk} busy={busy === "mic"} onClick={testMic} />
      <Check icon={Wifi}   label="Internet"        ok={netOk} busy={busy === "net"} onClick={testNet} />

      <div className="mt-4 flex flex-col gap-3">
        <Button variant="secondary" onClick={markReady} disabled={!allOk || busy !== null}>
          Mark ready
        </Button>
        {isLive ? (
          <Button variant="danger" onClick={stopLive} loading={busy === "end"}>End stream</Button>
        ) : (
          <Button onClick={startLive} disabled={!allOk || busy !== null} loading={busy === "live"}>
            <Radio className="mr-2 h-4 w-4" /> Go live
          </Button>
        )}
        {token ? (
          <Card>
            <CardSubtitle>
              {arEnabled
                ? "You are live with AR effects. The processed video is being published directly from your browser."
                : "You are live. Use the LiveKit token to join from an external streaming client (e.g. OBS) if needed."}
            </CardSubtitle>
          </Card>
        ) : null}
      </div>

      {/* Presenter-mode host controls — only for command-driven games once live */}
      {runMode === "presenter" && isLive ? (
        <div className="mt-3">
          <GameControlPanel gameId={gameId} room={room} />
        </div>
      ) : null}
    </>
  );
}

function Check({
  icon: Icon, label, ok, busy, onClick,
}: { icon: React.ComponentType<{ className?: string }>; label: string; ok: boolean; busy: boolean; onClick: () => void }) {
  return (
    <Card className="mb-3">
      <button type="button" onClick={onClick} disabled={busy}
        className="flex w-full items-center gap-3 disabled:opacity-60">
        <span className={cn(
          "inline-flex h-9 w-9 items-center justify-center rounded-full",
          ok ? "bg-emerald-500/15 text-emerald-400" : "bg-white/5 text-[var(--color-q4w-muted)]"
        )}><Icon className="h-4 w-4" /></span>
        <span className="flex-1 text-left text-sm">{label}</span>
        {ok ? <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          : <span className="text-xs text-[var(--color-q4w-muted)]">{busy ? "testing…" : "tap to test"}</span>}
      </button>
    </Card>
  );
}
