"use server";

import { requireAdmin } from "@/lib/auth";

const PROVIDER_URL = process.env.LIVEAVATAR_API_URL ?? "";
const PROVIDER_KEY = process.env.LIVEAVATAR_API_KEY ?? "";

function configured() {
  return !!(PROVIDER_URL && PROVIDER_KEY);
}

async function callProvider<T = unknown>(
  path: string,
  query?: Record<string, string>,
): Promise<{ ok: boolean; data?: T; notConfigured?: boolean; error?: string }> {
  if (!configured()) return { ok: false, notConfigured: true };
  const qs = query && Object.keys(query).length > 0 ? `?${new URLSearchParams(query)}` : "";
  const url = `${PROVIDER_URL.replace(/\/$/, "")}${path}${qs}`;
  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "X-Api-Key": PROVIDER_KEY,
        Authorization: `Bearer ${PROVIDER_KEY}`,
      },
      // Cache avatar/voice lists for 5 minutes server-side
      next: { revalidate: 300 },
    });
    if (!res.ok) return { ok: false, error: `Provider error ${res.status}` };
    const data = (await res.json()) as T;
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Network error" };
  }
}

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface LiveAvatar {
  avatar_id: string;
  avatar_name: string;
  preview_image_url: string | null;
  preview_video_url: string | null;
  gender: string | null;
  /** true when sourced from the public catalog */
  is_public: boolean;
}

export interface LiveAvatarVoice {
  voice_id: string;
  name: string;
  language: string;
  gender: string | null;
  support_pause?: boolean;
  emotion_support?: boolean;
}

// ─────────────────────────────────────────────────────────────
// fetchAvatars — merges private + public catalogs, deduped
// ─────────────────────────────────────────────────────────────

export async function fetchAvatars(): Promise<{
  ok: boolean;
  avatars?: LiveAvatar[];
  notConfigured?: boolean;
  error?: string;
}> {
  await requireAdmin(["super_admin", "admin"]);
  if (!configured()) return { ok: false, notConfigured: true };

  const [privateRes, publicRes] = await Promise.all([
    callProvider<Record<string, unknown>>("/avatars"),
    callProvider<Record<string, unknown>>("/avatars/public"),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const toArr = (res: typeof privateRes): LiveAvatar[] => (res.data as any)?.data?.avatars ?? [];

  const seen = new Set<string>();
  const merged: LiveAvatar[] = [];
  for (const [list, isPublic] of [[toArr(privateRes), false], [toArr(publicRes), true]] as const) {
    for (const a of list as LiveAvatar[]) {
      if (!seen.has(a.avatar_id)) {
        seen.add(a.avatar_id);
        merged.push({ ...a, is_public: isPublic });
      }
    }
  }

  return { ok: true, avatars: merged };
}

// ─────────────────────────────────────────────────────────────
// fetchVoices — paginated voice list
// ─────────────────────────────────────────────────────────────

export async function fetchVoices(params?: {
  voice_type?: string;
  page?: number;
  page_size?: number;
}): Promise<{
  ok: boolean;
  voices?: LiveAvatarVoice[];
  notConfigured?: boolean;
  error?: string;
}> {
  await requireAdmin(["super_admin", "admin"]);
  if (!configured()) return { ok: false, notConfigured: true };

  const query: Record<string, string> = {};
  if (params?.voice_type) query.voice_type = params.voice_type;
  if (params?.page != null) query.page = String(params.page);
  if (params?.page_size != null) query.page_size = String(params.page_size);

  const res = await callProvider<Record<string, unknown>>("/voices", query);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const voices: LiveAvatarVoice[] = (res.data as any)?.data?.voices ?? [];
  return { ok: res.ok, voices, notConfigured: res.notConfigured, error: res.error };
}

// ─────────────────────────────────────────────────────────────
// fetchVoicePreview — returns base64-encoded audio for playback
// ─────────────────────────────────────────────────────────────

export async function fetchVoicePreview(voiceId: string): Promise<{
  ok: boolean;
  audio_base64?: string;
  error?: string;
}> {
  await requireAdmin(["super_admin", "admin"]);
  if (!configured()) return { ok: false, error: "Provider not configured" };

  const res = await callProvider<Record<string, unknown>>(
    `/voices/${encodeURIComponent(voiceId)}/preview`,
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const audio: string | undefined = (res.data as any)?.data?.audio_base64;
  return { ok: res.ok, audio_base64: audio, error: res.error };
}
