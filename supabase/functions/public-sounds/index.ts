/**
 * Public Sounds Edge Function — Quiz4Win
 *
 * GET /public-sounds            — Returns all active app sounds (flat list + grouped by usage)
 * GET /public-sounds?usage=x    — Filter to a single usage slot
 * GET /public-sounds/:id/stream — Proxy the audio bytes through the API (Range-aware)
 *
 * Unauthenticated. Intended for the mobile app to fetch on startup and cache
 * the correct audio file for each UI event (correct_answer, countdown, etc.).
 *
 * Each sound carries both a `url` (the direct DigitalOcean Spaces CDN link) and
 * a `proxy_url` (`/public-sounds/:id/stream`). Some client networks filter the
 * direct CDN host, so the app falls back to `proxy_url`, which streams the same
 * bytes through the always-reachable API host.
 *
 * RLS on app_sounds enforces `is_active = true` for the anon role, so the
 * filter here is an belt-and-suspenders explicit WHERE.
 *
 * Rule compliance: R-01 (no PII), R-04 (anon/public client only, RLS active).
 */

import { corsHeaders, handleCors } from "../_shared/cors.ts";
import { errorResponse, successResponse } from "../_shared/errors.ts";
import { getPublicClient } from "../_shared/supabase.ts";
import { fetchObject } from "../_shared/s3.ts";

const VALID_USAGES = new Set([
  "splash", "home", "home_before_start", "register", "game_details",
  "correct_answer", "incorrect_answer", "countdown", "pregame_music",
  "winner", "loser", "announcement", "livestream",
]);

/**
 * Public base URL for building `proxy_url`. Derived from the proxied request
 * (nginx forwards `Host` + `X-Forwarded-Proto`) so it is environment-agnostic;
 * `PUBLIC_API_URL` overrides it when set.
 */
function apiBaseUrl(req: Request): string {
  const override = Deno.env.get("PUBLIC_API_URL");
  if (override) return override.replace(/\/+$/, "");
  const u = new URL(req.url);
  const proto = req.headers.get("x-forwarded-proto") ?? u.protocol.replace(/:$/, "");
  const host = req.headers.get("host") ?? u.host;
  return `${proto}://${host}`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleCors(req);

  const url = new URL(req.url);
  const parts = url.pathname.replace(/^\/public-sounds\/?/, "").split("/").filter(Boolean);

  // ── GET /public-sounds/:id/stream — proxy the audio bytes ───────────────────
  if (parts.length === 2 && parts[1] === "stream") {
    return await streamSound(req, parts[0]);
  }
  // Any other sub-path under /public-sounds is unknown.
  if (parts.length > 0) return errorResponse("not_found", 404);

  // ── GET /public-sounds — list active sounds ─────────────────────────────────
  if (req.method !== "GET") return errorResponse("Method not allowed", 405);

  const usageFilter = url.searchParams.get("usage");
  if (usageFilter && !VALID_USAGES.has(usageFilter)) {
    return errorResponse(`Unknown usage. Valid values: ${[...VALID_USAGES].join(", ")}`, 400);
  }

  const client = getPublicClient();
  let q = client
    .from("app_sounds")
    .select("id, name, usage, url, mime_type, duration_seconds, updated_at")
    .eq("is_active", true)
    .order("usage", { ascending: true })
    .order("created_at", { ascending: false });

  if (usageFilter) q = q.eq("usage", usageFilter);

  const { data, error } = await q;
  if (error) {
    console.error("[public-sounds] query failed:", error.message);
    return errorResponse("Failed to fetch sounds", 500);
  }

  // Attach a proxy_url fallback to every sound.
  const base = apiBaseUrl(req);
  const sounds = (data ?? []).map((s) => ({
    ...s,
    proxy_url: `${base}/public-sounds/${s.id}/stream`,
  }));

  // Group by usage so mobile clients can do O(1) lookup by event name
  const grouped: Record<string, typeof sounds> = {};
  for (const s of sounds) {
    if (!grouped[s.usage]) grouped[s.usage] = [];
    grouped[s.usage].push(s);
  }

  return successResponse({ sounds, grouped });
});

/**
 * Stream a single active sound's bytes through the API so clients that cannot
 * reach the direct CDN host still receive the audio. Forwards the client's
 * `Range` header for seekable playback and propagates the upstream status
 * (`200`/`206`) and `Content-Range`/`Content-Length`. Never returns PII (R-01).
 */
async function streamSound(req: Request, id: string): Promise<Response> {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return errorResponse("Method not allowed", 405);
  }

  const client = getPublicClient();
  const { data: row, error } = await client
    .from("app_sounds")
    .select("id, s3_key, mime_type")
    .eq("id", id)
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    console.error("[public-sounds] stream lookup failed:", error.message);
    return errorResponse("Failed to fetch sound", 500);
  }
  if (!row) return errorResponse("sound_not_found", 404);

  try {
    const upstream = await fetchObject(row.s3_key as string, req.headers.get("range"));
    if (!upstream.ok && upstream.status !== 206) {
      console.error(`[public-sounds] upstream object fetch returned ${upstream.status}`);
      return errorResponse("sound_unavailable", 502);
    }

    const headers = new Headers(corsHeaders);
    headers.set(
      "Content-Type",
      (row.mime_type as string) || upstream.headers.get("content-type") || "application/octet-stream",
    );
    headers.set("Accept-Ranges", "bytes");
    headers.set("Cache-Control", "public, max-age=86400");
    const len = upstream.headers.get("content-length");
    if (len) headers.set("Content-Length", len);
    const range = upstream.headers.get("content-range");
    if (range) headers.set("Content-Range", range);

    return new Response(req.method === "HEAD" ? null : upstream.body, {
      status: upstream.status,
      headers,
    });
  } catch (err) {
    console.error("[public-sounds] stream proxy error:", err instanceof Error ? err.message : String(err));
    return errorResponse("sound_unavailable", 502);
  }
}
