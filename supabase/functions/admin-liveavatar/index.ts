/**
 * Admin LiveAvatar Edge Function — Quiz4Win
 *
 * Thin proxy over the configured LiveAvatar provider so the admin panel can
 * list avatars/voices when configuring an AI-enabled game template.
 *
 * GET /admin/liveavatar/avatars                — Account (private/custom) avatars
 * GET /admin/liveavatar/avatars/public         — Platform-wide public avatars
 * GET /admin/liveavatar/avatars/:id            — Single avatar
 * GET /admin/liveavatar/voices                 — Voices (params: voice_type, page, page_size)
 * GET /admin/liveavatar/voices/:id             — Single voice
 * GET /admin/liveavatar/voices/:id/preview     — Voice preview (audio_base64)
 * GET /admin/liveavatar/credits                — Remaining credits balance
 *
 * Env vars:
 *   LIVEAVATAR_API_URL   — base URL of the provider (e.g. https://api.heygen.com/v2)
 *   LIVEAVATAR_API_KEY   — bearer token / API key forwarded as X-Api-Key
 *
 * If env is not configured, all routes return 503 so the admin UI can fall
 * back to free-form UUID entry (the template stores ai_avatar_id /
 * ai_sound_id as plain strings regardless of where they came from).
 *
 * Rule compliance: R-01 (no logging of API key), R-03/R-04 (admin gated).
 */

import { handleCors } from "../_shared/cors.ts";
import { errorResponse, successResponse, sanitizeError } from "../_shared/errors.ts";
import { validateJWT, requireAdminRole, validateAdminSessionToken } from "../_shared/auth.ts";

const PROVIDER_URL = Deno.env.get("LIVEAVATAR_API_URL") ?? "";
const PROVIDER_KEY = Deno.env.get("LIVEAVATAR_API_KEY") ?? "";

function providerConfigured(): boolean {
  return !!(PROVIDER_URL && PROVIDER_KEY);
}

async function callProvider(path: string, query?: URLSearchParams): Promise<Response> {
  const qs = query && [...query.keys()].length > 0 ? `?${query.toString()}` : "";
  const target = `${PROVIDER_URL.replace(/\/$/, "")}${path}${qs}`;
  try {
    const res = await fetch(target, {
      method: "GET",
      headers: {
        "Accept": "application/json",
        "X-Api-Key": PROVIDER_KEY,
        "Authorization": `Bearer ${PROVIDER_KEY}`,
      },
    });
    const body = await res.text();
    let parsed: unknown;
    try { parsed = JSON.parse(body); } catch { parsed = body; }
    if (!res.ok) {
      return errorResponse(typeof parsed === "string" ? parsed : "upstream_error", res.status);
    }
    return successResponse(parsed as Record<string, unknown>);
  } catch (err) {
    return errorResponse(sanitizeError(err), 502);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleCors();

  const url = new URL(req.url);
  const parts = url.pathname.replace(/^\/admin\/liveavatar\/?/, "").split("/").filter(Boolean);
  const resource = parts[0] ?? null;             // "avatars" | "voices" | "credits"
  const segment = parts[1] ?? null;              // "public" | <id>
  const subAction = parts[2] ?? null;            // "preview"

  // Two auth paths:
  //   1. X-Admin-Session-Token (preferred — sent by the trusted Next.js admin
  //      panel server actions, which authenticate admins via cookie session
  //      tokens, not Supabase Auth JWTs).
  //   2. Authorization: Bearer <jwt> (fallback — for any Supabase-Auth client).
  const ALLOWED_ROLES = ["super_admin", "admin", "moderator"];
  const sessionToken = req.headers.get("X-Admin-Session-Token");
  if (sessionToken) {
    const { adminUser, error: sessErr } = await validateAdminSessionToken(sessionToken, ALLOWED_ROLES);
    if (sessErr || !adminUser) return errorResponse(sessErr ?? "unauthorized", 401);
  } else {
    const { user, error: authErr } = await validateJWT(req);
    if (authErr || !user) return errorResponse("unauthorized", 401);
    const { error: adminErr } = await requireAdminRole(user.id, ALLOWED_ROLES);
    if (adminErr) return errorResponse(adminErr, 403);
  }

  if (!providerConfigured()) {
    return errorResponse("liveavatar_provider_not_configured", 503);
  }
  if (req.method !== "GET") return errorResponse("Method not allowed", 405);

  try {
    // GET /admin/liveavatar/avatars  or  /avatars/public  or  /avatars/:id
    if (resource === "avatars") {
      if (!segment) {
        return await callProvider("/avatars", url.searchParams);
      }
      if (segment === "public") {
        return await callProvider("/avatars/public", url.searchParams);
      }
      return await callProvider(`/avatars/${encodeURIComponent(segment)}`);
    }

    // GET /admin/liveavatar/voices  or  /voices/:id  or  /voices/:id/preview
    if (resource === "voices") {
      if (!segment) {
        return await callProvider("/voices", url.searchParams);
      }
      if (subAction === "preview") {
        return await callProvider(`/voices/${encodeURIComponent(segment)}/preview`);
      }
      return await callProvider(`/voices/${encodeURIComponent(segment)}`);
    }

    // GET /admin/liveavatar/credits
    if (resource === "credits" && !segment) {
      return await callProvider("/credits");
    }

    return errorResponse("Not found", 404);
  } catch (err) {
    console.error("[admin-liveavatar] unhandled error:", err);
    return errorResponse("Internal server error", 500);
  }
});
