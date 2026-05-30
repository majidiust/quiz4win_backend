"use server";

import { requireAdmin } from "@/lib/auth";
import { readSessionCookie } from "@/lib/admin-auth";

/**
 * LiveAvatar catalog fetchers — proxied through the backend Edge Function
 * (admin-liveavatar) at ${API_URL}/admin/liveavatar/*. The provider's API
 * credentials live only on the api container; the admin panel forwards its
 * admin_sessions cookie token via the X-Admin-Session-Token header so the
 * backend can re-validate the caller as an active admin.
 *
 * Rule compliance:
 *  - R-01: provider key never leaves the api container, never logged here.
 *  - R-03/R-04: requireAdmin() gates the action; backend re-validates the
 *    session token before contacting the provider.
 */

const API_URL =
  process.env.API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "https://api.quiz4win.com";

async function callBackend<T = unknown>(
  path: string,
  query?: Record<string, string>,
): Promise<{ ok: boolean; data?: T; notConfigured?: boolean; error?: string }> {
  const sessionToken = await readSessionCookie();
  if (!sessionToken) return { ok: false, error: "Unauthorized" };

  const qs = query && Object.keys(query).length > 0 ? `?${new URLSearchParams(query)}` : "";
  const url = `${API_URL.replace(/\/$/, "")}${path}${qs}`;
  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "X-Admin-Session-Token": sessionToken,
      },
      // Cache avatar/voice lists for 5 minutes server-side
      next: { revalidate: 300 },
    });
    const body = await res.text();
    let parsed: unknown;
    try { parsed = JSON.parse(body); } catch { parsed = body; }

    if (res.status === 503) {
      // Provider not configured on the backend
      return { ok: false, notConfigured: true };
    }
    if (!res.ok) {
      const msg = (parsed && typeof parsed === "object" && "error" in parsed)
        ? String((parsed as { error: unknown }).error)
        : `Backend error ${res.status}`;
      return { ok: false, error: msg };
    }
    return { ok: true, data: parsed as T };
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

  const [privateRes, publicRes] = await Promise.all([
    callBackend<Record<string, unknown>>("/admin/liveavatar/avatars"),
    callBackend<Record<string, unknown>>("/admin/liveavatar/avatars/public"),
  ]);

  if (privateRes.notConfigured || publicRes.notConfigured) {
    return { ok: false, notConfigured: true };
  }

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

  if (!privateRes.ok && !publicRes.ok && merged.length === 0) {
    return { ok: false, error: privateRes.error ?? publicRes.error ?? "Failed to load avatars" };
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

  const query: Record<string, string> = {};
  if (params?.voice_type) query.voice_type = params.voice_type;
  if (params?.page != null) query.page = String(params.page);
  if (params?.page_size != null) query.page_size = String(params.page_size);

  const res = await callBackend<Record<string, unknown>>("/admin/liveavatar/voices", query);
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

  const res = await callBackend<Record<string, unknown>>(
    `/admin/liveavatar/voices/${encodeURIComponent(voiceId)}/preview`,
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const audio: string | undefined = (res.data as any)?.data?.audio_base64;
  return { ok: res.ok, audio_base64: audio, error: res.error };
}
