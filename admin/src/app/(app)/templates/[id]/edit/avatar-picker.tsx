"use client";

import { useEffect, useTransition, useState } from "react";
import { RefreshCw, CheckCircle2, UserCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchAvatars, type LiveAvatar } from "@/lib/actions/liveavatar";

interface Props {
  value: string;
  onChange: (avatarId: string) => void;
  disabled?: boolean;
}

export function AvatarPicker({ value, onChange, disabled }: Props) {
  const [avatars, setAvatars] = useState<LiveAvatar[]>([]);
  const [notConfigured, setNotConfigured] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function load() {
    start(async () => {
      const res = await fetchAvatars();
      if (res.notConfigured) { setNotConfigured(true); return; }
      if (!res.ok || !res.avatars) { setError(res.error ?? "Failed to load avatars"); return; }
      setAvatars(res.avatars);
    });
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  // Fallback: provider not configured → show UUID text input
  if (notConfigured) {
    return (
      <div className="space-y-1.5">
        <Label htmlFor="et-avatar">Avatar ID *</Label>
        <Input
          id="et-avatar"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="HeyGen avatar UUID"
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
        <Label>Avatar *</Label>
        <Button type="button" variant="ghost" size="sm" onClick={load} disabled={pending || disabled}>
          <RefreshCw className={`size-3.5 ${pending ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* Selected preview */}
      {value && (() => {
        const sel = avatars.find((a) => a.avatar_id === value);
        return sel ? (
          <div className="flex items-center gap-3 rounded-md border bg-muted/40 px-3 py-2">
            {sel.preview_image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={sel.preview_image_url} alt={sel.avatar_name} className="h-10 w-10 rounded-full border object-cover" />
            ) : (
              <UserCircle2 className="size-10 text-muted-foreground" />
            )}
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{sel.avatar_name}</div>
              <div className="font-mono text-[10px] text-muted-foreground truncate">{sel.avatar_id}</div>
            </div>
            <CheckCircle2 className="size-4 text-green-500 shrink-0" />
          </div>
        ) : (
          <div className="rounded-md border bg-muted/20 px-3 py-2">
            <p className="font-mono text-xs text-muted-foreground break-all">{value}</p>
          </div>
        );
      })()}

      {/* Avatar grid */}
      {error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : pending && avatars.length === 0 ? (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="aspect-square w-full rounded-md" />)}
        </div>
      ) : avatars.length === 0 ? (
        <p className="text-xs text-muted-foreground">No avatars found.</p>
      ) : (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 max-h-72 overflow-y-auto pr-1">
          {avatars.map((a) => {
            const selected = a.avatar_id === value;
            return (
              <button
                key={a.avatar_id}
                type="button"
                disabled={disabled}
                onClick={() => onChange(a.avatar_id)}
                className={`group relative flex flex-col items-center gap-1 rounded-md border p-2 text-left transition-colors hover:bg-accent
                  ${selected ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border"}`}
              >
                {a.preview_image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.preview_image_url} alt={a.avatar_name} className="h-14 w-14 rounded-full border object-cover" />
                ) : (
                  <UserCircle2 className="size-14 text-muted-foreground" />
                )}
                <span className="w-full truncate text-center text-[11px] font-medium leading-tight">{a.avatar_name}</span>
                {a.gender && (
                  <Badge variant="outline" className="text-[9px] py-0 px-1">{a.gender}</Badge>
                )}
                {selected && (
                  <CheckCircle2 className="absolute top-1 right-1 size-3.5 text-primary" />
                )}
              </button>
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
          placeholder="avatar UUID"
          disabled={disabled}
        />
      </details>
    </div>
  );
}
