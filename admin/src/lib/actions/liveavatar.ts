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
}

// ─────────────────────────────────────────────────────────────
// fetchAvatars — merges private + public catalogs, deduped
// ─────────────────────────────────────────────────────────────

/**
 * Shape returned by LiveAvatar (`{ code, data: { count, results: [...] } }`).
 * AvatarSchema has `id`, `name`, `preview_url`, `default_voice` — we map these
 * to the picker's expected fields (avatar_id / avatar_name / preview_image_url).
 */
interface ProviderEnvelope<T> {
  code?: number;
  message?: string;
  data?: { count?: number; results?: T[] } | null;
}
interface ProviderAvatar {
  id: string;
  name: string;
  preview_url?: string | null;
  default_voice?: { id: string; name: string } | null;
  type?: string;
}
interface ProviderVoice {
  id: string;
  name: string;
  language: string;
  gender: string | null;
  description?: string | null;
  tags?: string[];
}

function mapAvatar(a: ProviderAvatar, isPublic: boolean): LiveAvatar {
  // LiveAvatar returns a single preview_url that can be either an image or a
  // short video (mp4). Best-effort: treat URLs ending in known video
  // extensions as preview_video_url, everything else as preview_image_url.
  const url = a.preview_url ?? null;
  const isVideo = !!url && /\.(mp4|webm|mov)(\?|$)/i.test(url);
  return {
    avatar_id: a.id,
    avatar_name: a.name,
    preview_image_url: isVideo ? null : url,
    preview_video_url: isVideo ? url : null,
    gender: null,
    is_public: isPublic,
  };
}

export async function fetchAvatars(): Promise<{
  ok: boolean;
  avatars?: LiveAvatar[];
  notConfigured?: boolean;
  error?: string;
}> {
  await requireAdmin(["super_admin", "admin"]);

  const [privateRes, publicRes] = await Promise.all([
    callBackend<ProviderEnvelope<ProviderAvatar>>("/admin/liveavatar/avatars", { page_size: "100" }),
    callBackend<ProviderEnvelope<ProviderAvatar>>("/admin/liveavatar/avatars/public", { page_size: "100" }),
  ]);

  if (privateRes.notConfigured || publicRes.notConfigured) {
    return { ok: false, notConfigured: true };
  }

  const toArr = (res: typeof privateRes): ProviderAvatar[] => res.data?.data?.results ?? [];

  const seen = new Set<string>();
  const merged: LiveAvatar[] = [];
  for (const [list, isPublic] of [[toArr(privateRes), false], [toArr(publicRes), true]] as const) {
    for (const a of list) {
      if (!seen.has(a.id)) {
        seen.add(a.id);
        merged.push(mapAvatar(a, isPublic));
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

function mapVoice(v: ProviderVoice): LiveAvatarVoice {
  return {
    voice_id: v.id,
    name: v.name,
    language: v.language,
    gender: v.gender ?? null,
  };
}

export async function fetchVoices(params?: {
  voice_type?: "public" | "private" | string;
  page?: number;
  page_size?: number;
}): Promise<{
  ok: boolean;
  voices?: LiveAvatarVoice[];
  notConfigured?: boolean;
  error?: string;
}> {
  await requireAdmin(["super_admin", "admin"]);

  // Provider's list-voices defaults to voice_type=public. When the caller
  // doesn't specify, fetch both public + private and merge so users see all
  // available voices on their plan. Page size is capped at 100 by the API.
  const basePageSize = String(Math.min(params?.page_size ?? 100, 100));
  const targets: Array<"public" | "private"> =
    params?.voice_type === "public" || params?.voice_type === "private"
      ? [params.voice_type]
      : ["public", "private"];

  const results = await Promise.all(
    targets.map((vt) => {
      const query: Record<string, string> = { page_size: basePageSize, voice_type: vt };
      if (params?.page != null) query.page = String(params.page);
      return callBackend<ProviderEnvelope<ProviderVoice>>("/admin/liveavatar/voices", query);
    }),
  );

  if (results.some((r) => r.notConfigured)) {
    return { ok: false, notConfigured: true };
  }

  const seen = new Set<string>();
  const merged: LiveAvatarVoice[] = [];
  for (const r of results) {
    for (const v of r.data?.data?.results ?? []) {
      if (!seen.has(v.id)) {
        seen.add(v.id);
        merged.push(mapVoice(v));
      }
    }
  }

  const anyOk = results.some((r) => r.ok);
  if (!anyOk && merged.length === 0) {
    return { ok: false, error: results.find((r) => r.error)?.error ?? "Failed to load voices" };
  }
  return { ok: true, voices: merged };
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

  const res = await callBackend<ProviderEnvelope<never> & { data?: { audio_base64?: string } | null }>(
    `/admin/liveavatar/voices/${encodeURIComponent(voiceId)}/preview`,
  );
  // Provider envelope: { code, data: { audio_base64 }, message }
  const audio: string | undefined = (res.data?.data as { audio_base64?: string } | null | undefined)?.audio_base64;
  return { ok: res.ok, audio_base64: audio, error: res.error };
}
