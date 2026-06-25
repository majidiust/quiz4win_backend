"use client";

import { useCallback, useRef, useState } from "react";
import { Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AREffect } from "@/components/ar-preview";

export interface ARBackground { id: string; name: string; url: string; sort_order: number }

// ── Voice effects ──────────────────────────────────────────────────────────────

export interface VoiceEffect {
  id: string;
  name: string;
  icon: string;
  description: string;
}

export const VOICE_EFFECTS: VoiceEffect[] = [
  { id: "none",    name: "Normal",   icon: "🎤", description: "No effect" },
  { id: "deep",    name: "Deep",     icon: "🔉", description: "Bass boost, deeper sound" },
  { id: "robot",   name: "Robot",    icon: "🤖", description: "Robotic ring modulation" },
  { id: "echo",    name: "Echo",     icon: "🔁", description: "Delay with feedback" },
  { id: "radio",   name: "Radio",    icon: "📻", description: "Walkie-talkie bandpass" },
  { id: "alien",   name: "Alien",    icon: "👽", description: "High-freq ring modulation" },
];

function makeDistortionCurve(amount: number): Float32Array<ArrayBuffer> {
  const n = 256;
  const curve = new Float32Array(new ArrayBuffer(n * 4));
  const deg = Math.PI / 180;
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = ((3 + amount) * x * 20 * deg) / (Math.PI + amount * Math.abs(x));
  }
  return curve;
}

/** Builds a Web-Audio-API processing chain for the given voice effect.
 *  Returns a processed MediaStream whose audio track can be published to LiveKit. */
export async function buildVoiceChain(
  rawMicStream: MediaStream,
  effectId: string,
  prevCtx?: AudioContext | null,
  prevOsc?: OscillatorNode | null,
): Promise<{ stream: MediaStream; ctx: AudioContext; osc: OscillatorNode | null }> {
  // Tear down any previous chain
  prevOsc?.stop();
  try { await prevCtx?.close(); } catch { /* ignore */ }

  const ctx = new AudioContext();
  const source = ctx.createMediaStreamSource(rawMicStream);
  const dest = ctx.createMediaStreamDestination();
  let osc: OscillatorNode | null = null;

  if (effectId === "none") {
    source.connect(dest);

  } else if (effectId === "deep") {
    const shelf = ctx.createBiquadFilter();
    shelf.type = "lowshelf"; shelf.frequency.value = 250; shelf.gain.value = 8;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = 3500;
    source.connect(shelf); shelf.connect(lp); lp.connect(dest);

  } else if (effectId === "robot") {
    // Ring modulation at 50 Hz → metallic robotic sound
    const ringGain = ctx.createGain();
    ringGain.gain.value = 0; // base 0, oscillator modulates
    osc = ctx.createOscillator();
    osc.frequency.value = 50; osc.type = "sine"; osc.start();
    osc.connect(ringGain.gain);
    source.connect(ringGain); ringGain.connect(dest);

  } else if (effectId === "echo") {
    const delay = ctx.createDelay(1.0); delay.delayTime.value = 0.28;
    const fb = ctx.createGain(); fb.gain.value = 0.4;
    source.connect(dest); // dry
    source.connect(delay); delay.connect(fb); fb.connect(delay); // wet loop
    delay.connect(dest);

  } else if (effectId === "radio") {
    const ws = ctx.createWaveShaper(); ws.curve = makeDistortionCurve(50);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass"; bp.frequency.value = 1800; bp.Q.value = 1.5;
    const boost = ctx.createGain(); boost.gain.value = 3;
    source.connect(ws); ws.connect(bp); bp.connect(boost); boost.connect(dest);

  } else if (effectId === "alien") {
    // Higher-freq ring modulation + highpass for alien texture
    const ringGain = ctx.createGain(); ringGain.gain.value = 0;
    osc = ctx.createOscillator();
    osc.frequency.value = 200; osc.type = "square"; osc.start();
    osc.connect(ringGain.gain);
    const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 300;
    source.connect(ringGain); ringGain.connect(hp); hp.connect(dest);

  } else {
    source.connect(dest); // fallback passthrough
  }

  return { stream: dest.stream, ctx, osc };
}

// ── Video effect static list ────────────────────────────────────────────────

const VIDEO_EFFECTS: AREffect[] = [
  { id: "none",           name: "Off",         type: "none",           icon: "🚫", category: "none" },
  { id: "blur",           name: "Blur BG",     type: "blur",           icon: "🌫️", category: "backgrounds" },
  { id: "silhouette",     name: "Stealth",     type: "silhouette",     icon: "🖤", category: "backgrounds" },
  { id: "face-blur",      name: "Face Blur",   type: "face-blur",      icon: "🫥", category: "face" },
  { id: "beauty",         name: "Beauty",      type: "beauty",         icon: "✨", category: "face" },
  { id: "face-mask-cat",  name: "Cat",         type: "face-mask-cat",  icon: "🐱", category: "face" },
  { id: "face-mask-star", name: "Star",        type: "face-mask-star", icon: "⭐", category: "face" },
];

// ── ARPanel ─────────────────────────────────────────────────────────────────

interface ARPanelProps {
  presets: ARBackground[];
  onEffectChange: (effect: AREffect | null) => void;
  selectedEffect: AREffect | null;
  selectedVoiceEffect: VoiceEffect;
  onVoiceEffectChange: (v: VoiceEffect) => void;
}

export function ARPanel({
  presets,
  onEffectChange,
  selectedEffect,
  selectedVoiceEffect,
  onVoiceEffectChange,
}: ARPanelProps) {
  const presetEffects: AREffect[] = presets.map((p) => ({
    id: `preset-${p.id}`,
    name: p.name,
    type: "preset-bg" as const,
    icon: "🖼️",
    presetImage: p.url,
    category: "backgrounds" as const,
  }));
  const allVideoEffects = [...VIDEO_EFFECTS, ...presetEffects];

  return (
    <div className="mt-3 rounded-2xl border border-white/10 bg-white/5 p-3 space-y-3">
      {/* ── Video effects ── */}
      <div>
        <p className="mb-2 text-xs font-semibold text-[var(--color-q4w-muted)] uppercase tracking-wider">
          🎥 Video Effects
        </p>
        <div className="flex flex-wrap gap-2">
          {allVideoEffects.map((effect) => (
            <button
              key={effect.id}
              type="button"
              onClick={() => onEffectChange(effect.type === "none" ? null : effect)}
              className={cn(
                "flex flex-col items-center gap-1 rounded-xl border px-3 py-2 text-xs transition-colors",
                selectedEffect?.id === effect.id || (effect.type === "none" && !selectedEffect)
                  ? "border-purple-500 bg-purple-500/20 text-purple-300"
                  : "border-white/10 bg-white/5 text-[var(--color-q4w-muted)] hover:border-white/20 hover:text-white",
              )}
            >
              {effect.type === "preset-bg" && effect.presetImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={effect.presetImage} alt={effect.name} className="h-10 w-16 rounded object-cover" />
              ) : (
                <span className="text-xl">{effect.icon}</span>
              )}
              <span className="max-w-[4rem] truncate">{effect.name}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Voice effects ── */}
      <div>
        <p className="mb-2 text-xs font-semibold text-[var(--color-q4w-muted)] uppercase tracking-wider">
          🎙️ Voice Effects
        </p>
        <p className="mb-2 text-[10px] text-[var(--color-q4w-muted)]/70 italic">
          Applied when you go live — selected effect will be streamed to viewers.
        </p>
        <div className="flex flex-wrap gap-2">
          {VOICE_EFFECTS.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => onVoiceEffectChange(v)}
              title={v.description}
              className={cn(
                "flex flex-col items-center gap-1 rounded-xl border px-3 py-2 text-xs transition-colors",
                selectedVoiceEffect.id === v.id
                  ? "border-blue-500 bg-blue-500/20 text-blue-300"
                  : "border-white/10 bg-white/5 text-[var(--color-q4w-muted)] hover:border-white/20 hover:text-white",
              )}
            >
              <span className="text-xl">{v.icon}</span>
              <span className="max-w-[4rem] truncate">{v.name}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── ARModal — accessible bottom-sheet for live AR access ──────────── */

interface ARModalProps extends ARPanelProps {
  open: boolean;
  onClose: () => void;
  arEnabled: boolean;
  onToggle: () => void;
}

export function ARModal({
  open,
  onClose,
  arEnabled,
  onToggle,
  ...panelProps
}: ARModalProps) {
  if (!open) return null;
  return (
    <>
      {/* Backdrop — tap to dismiss */}
      <div
        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Bottom sheet */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="AR Effects"
        className="fixed bottom-0 left-0 right-0 z-50 flex max-h-[78vh] flex-col rounded-t-3xl border-t border-white/10 bg-[#0e0e1a]"
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-1 shrink-0">
          <span className="h-1 w-10 rounded-full bg-white/20" />
        </div>

        {/* Header row */}
        <div className="flex shrink-0 items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-purple-400" />
            <span className="text-sm font-semibold">AR Effects</span>
            {arEnabled && (
              <span className="rounded-full bg-purple-500/20 px-2 py-0.5 text-[10px] font-medium text-purple-300">
                ON
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <ARToggleButton arEnabled={arEnabled} onToggle={onToggle} />
            <button
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-[var(--color-q4w-muted)] hover:bg-white/20 transition-colors"
              aria-label="Close AR panel"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Scrollable effects content */}
        <div className="flex-1 overflow-y-auto px-4 pb-8">
          <ARPanel {...panelProps} />
        </div>
      </div>
    </>
  );
}

/* ── AR Toggle Button ──────────────────────────────────────────────── */

interface ARToggleButtonProps {
  arEnabled: boolean;
  onToggle: () => void;
  disabled?: boolean;
}

export function ARToggleButton({ arEnabled, onToggle, disabled }: ARToggleButtonProps) {
  return (
    <Button
      type="button"
      variant="secondary"
      onClick={onToggle}
      disabled={disabled}
      className={cn(arEnabled && "border-purple-500 bg-purple-500/20 text-purple-300")}
    >
      {arEnabled ? <X className="mr-2 h-4 w-4" /> : <Sparkles className="mr-2 h-4 w-4" />}
      {arEnabled ? "Disable AR" : "AR Effects"}
    </Button>
  );
}

/* ── useARState hook ────────────────────────────────────────────────── */

export function useARState() {
  const [arEnabled, setArEnabled] = useState(false);
  const [selectedEffect, setSelectedEffect] = useState<AREffect | null>(null);
  const [arStream, setArStream] = useState<MediaStream | null>(null);

  // Voice effect state
  const [selectedVoiceEffect, setSelectedVoiceEffect] = useState<VoiceEffect>(VOICE_EFFECTS[0]);
  const audioCtxRef  = useRef<AudioContext | null>(null);
  const oscillatorRef = useRef<OscillatorNode | null>(null);

  /** Builds the voice-processing chain and returns the processed MediaStream.
   *  Call this just before publishing to LiveKit. */
  const applyVoiceEffect = useCallback(async (rawMicStream: MediaStream): Promise<MediaStream> => {
    const result = await buildVoiceChain(
      rawMicStream,
      selectedVoiceEffect.id,
      audioCtxRef.current,
      oscillatorRef.current,
    );
    audioCtxRef.current = result.ctx;
    oscillatorRef.current = result.osc;
    return result.stream;
  }, [selectedVoiceEffect.id]);

  /** Tear down the voice-processing chain (call on stream end). */
  const destroyVoiceEffect = useCallback(() => {
    oscillatorRef.current?.stop();
    oscillatorRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
  }, []);

  function toggleAR() {
    setArEnabled((v) => {
      if (v) { setSelectedEffect(null); setArStream(null); }
      return !v;
    });
  }

  return {
    arEnabled, selectedEffect, setSelectedEffect, arStream, setArStream, toggleAR,
    selectedVoiceEffect, setSelectedVoiceEffect, applyVoiceEffect, destroyVoiceEffect,
  };
}
