"use client";

import { useState } from "react";
import { Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AREffect } from "@/components/ar-preview";

export interface ARBackground { id: string; name: string; url: string; sort_order: number }

interface ARPanelProps {
  presets: ARBackground[];
  onEffectChange: (effect: AREffect | null) => void;
  selectedEffect: AREffect | null;
}

const STATIC_EFFECTS: AREffect[] = [
  { id: "none",       name: "No Effect",   type: "none",       icon: "🚫",  category: "none" },
  { id: "blur",       name: "Blur BG",     type: "blur",       icon: "🌫️", category: "backgrounds" },
  { id: "silhouette", name: "Stealth",     type: "silhouette", icon: "🖤",  category: "backgrounds" },
];

export function ARPanel({ presets, onEffectChange, selectedEffect }: ARPanelProps) {
  // Build preset effects from admin-managed backgrounds
  const presetEffects: AREffect[] = presets.map((p) => ({
    id: `preset-${p.id}`,
    name: p.name,
    type: "preset-bg" as const,
    icon: "🖼️",
    presetImage: p.url,
    category: "backgrounds" as const,
  }));

  const allEffects = [...STATIC_EFFECTS, ...presetEffects];

  return (
    <div className="mt-3 rounded-2xl border border-white/10 bg-white/5 p-3">
      <p className="mb-2 text-xs font-medium text-[var(--color-q4w-muted)]">AR Effects</p>
      <div className="flex flex-wrap gap-2">
        {allEffects.map((effect) => (
          <button
            key={effect.id}
            type="button"
            onClick={() => onEffectChange(effect.type === "none" ? null : effect)}
            className={cn(
              "flex flex-col items-center gap-1 rounded-xl border px-3 py-2 text-xs transition-colors",
              selectedEffect?.id === effect.id || (effect.type === "none" && !selectedEffect)
                ? "border-purple-500 bg-purple-500/20 text-purple-300"
                : "border-white/10 bg-white/5 text-[var(--color-q4w-muted)] hover:border-white/20 hover:text-white"
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

  function toggleAR() {
    setArEnabled((v) => {
      if (v) { setSelectedEffect(null); setArStream(null); }
      return !v;
    });
  }

  return { arEnabled, selectedEffect, setSelectedEffect, arStream, setArStream, toggleAR };
}
