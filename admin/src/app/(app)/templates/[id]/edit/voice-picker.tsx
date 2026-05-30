"use client";

import { useEffect, useTransition, useState, useRef } from "react";
import { RefreshCw, Play, Square, CheckCircle2, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchVoices, fetchVoicePreview, type LiveAvatarVoice } from "@/lib/actions/liveavatar";

interface Props {
  value: string;
  onChange: (voiceId: string) => void;
  disabled?: boolean;
}

export function VoicePicker({ value, onChange, disabled }: Props) {
  const [voices, setVoices] = useState<LiveAvatarVoice[]>([]);
  const [notConfigured, setNotConfigured] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [pending, start] = useTransition();

  // Audio playback state
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [previewPending, startPreview] = useTransition();
  const audioRef = useRef<HTMLAudioElement | null>(null);

  function load() {
    start(async () => {
      const res = await fetchVoices({ page_size: 200 });
      if (res.notConfigured) { setNotConfigured(true); return; }
      if (!res.ok || !res.voices) { setError(res.error ?? "Failed to load voices"); return; }
      setVoices(res.voices);
    });
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  function stopAudio() {
    audioRef.current?.pause();
    audioRef.current = null;
    setPlayingId(null);
  }

  function playPreview(voiceId: string) {
    if (playingId === voiceId) { stopAudio(); return; }
    stopAudio();
    startPreview(async () => {
      const res = await fetchVoicePreview(voiceId);
      if (!res.ok || !res.audio_base64) return;
      const audio = new Audio(`data:audio/mpeg;base64,${res.audio_base64}`);
      audioRef.current = audio;
      setPlayingId(voiceId);
      audio.onended = () => setPlayingId(null);
      audio.play().catch(() => setPlayingId(null));
    });
  }

  const filtered = voices.filter((v) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      v.name.toLowerCase().includes(q) ||
      v.language.toLowerCase().includes(q) ||
      (v.gender ?? "").toLowerCase().includes(q)
    );
  });

  const selectedVoice = voices.find((v) => v.voice_id === value);

  // Fallback: provider not configured
  if (notConfigured) {
    return (
      <div className="space-y-1.5">
        <Label htmlFor="et-voice">Voice ID *</Label>
        <Input
          id="et-voice"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="HeyGen voice UUID"
          className="font-mono text-xs"
          disabled={disabled}
        />
        <p className="text-xs text-muted-foreground">
          LIVEAVATAR_API_URL / LIVEAVATAR_API_KEY not configured — enter UUID manually.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>Voice *</Label>
        <Button type="button" variant="ghost" size="sm" onClick={load} disabled={pending || disabled}>
          <RefreshCw className={`size-3.5 ${pending ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* Selected voice preview */}
      {selectedVoice && (
        <div className="flex items-center gap-3 rounded-md border bg-muted/40 px-3 py-2">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium">{selectedVoice.name}</div>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span>{selectedVoice.language}</span>
              {selectedVoice.gender && <Badge variant="outline" className="text-[9px] py-0 px-1">{selectedVoice.gender}</Badge>}
            </div>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => playPreview(selectedVoice.voice_id)} disabled={previewPending || disabled}>
            {previewPending && playingId === null ? <Loader2 className="size-3.5 animate-spin" /> : playingId === selectedVoice.voice_id ? <Square className="size-3.5" /> : <Play className="size-3.5" />}
          </Button>
          <CheckCircle2 className="size-4 text-green-500 shrink-0" />
        </div>
      )}

      {/* Search */}
      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by name, language, gender…"
        className="h-8 text-xs"
        disabled={disabled}
      />

      {/* Voice list */}
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : pending && voices.length === 0 ? (
        <div className="space-y-1">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-9 w-full rounded-md" />)}
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-xs text-muted-foreground">{voices.length === 0 ? "No voices found." : "No voices match your search."}</p>
      ) : (
        <div className="max-h-64 overflow-y-auto space-y-0.5 pr-1">
          {filtered.map((v) => {
            const selected = v.voice_id === value;
            const isPlaying = playingId === v.voice_id;
            return (
              <div
                key={v.voice_id}
                className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors
                  ${selected ? "bg-primary/10 ring-1 ring-primary/30" : "hover:bg-accent"}`}
              >
                <button type="button" className="flex-1 text-left min-w-0" onClick={() => onChange(v.voice_id)} disabled={disabled}>
                  <span className="font-medium truncate block">{v.name}</span>
                  <span className="text-xs text-muted-foreground">{v.language}{v.gender ? ` · ${v.gender}` : ""}</span>
                </button>
                <Button
                  type="button"
                  variant={isPlaying ? "default" : "ghost"}
                  size="sm"
                  className="h-6 w-6 p-0 shrink-0"
                  onClick={() => playPreview(v.voice_id)}
                  disabled={disabled}
                  title={isPlaying ? "Stop" : "Preview"}
                >
                  {previewPending && playingId === null && v.voice_id === value ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : isPlaying ? (
                    <Square className="size-3" />
                  ) : (
                    <Play className="size-3" />
                  )}
                </Button>
                {selected && <CheckCircle2 className="size-3.5 text-primary shrink-0" />}
              </div>
            );
          })}
        </div>
      )}

      {/* Manual override */}
      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Enter UUID manually</summary>
        <Input
          className="mt-1.5 font-mono text-xs"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="voice UUID"
          disabled={disabled}
        />
      </details>
    </div>
  );
}
