/**
 * CORS helpers shared across all Quiz4Win Edge Functions.
 *
 * `ALLOWED_ORIGINS` Supabase secret controls the allowed origin(s).
 * It may be a single origin, "*", or a comma-separated list.
 *
 * Because all authenticated routes use Bearer tokens (no cookies), it is
 * safe to respond with `Access-Control-Allow-Origin: *` when no specific
 * origin can be matched statically. Per-request matching is available via
 * `makeCorsHeaders(requestOrigin)` for preflight responses.
 *
 * Usage:
 *   import { corsHeaders, handleCors } from '../_shared/cors.ts';
 *
 *   if (req.method === 'OPTIONS') return handleCors(req);
 */

const rawOrigins = (Deno.env.get("ALLOWED_ORIGINS") ?? "*").trim();

/**
 * Parse ALLOWED_ORIGINS into a Set for O(1) look-up.
 * null means "all origins allowed" (i.e. the value was "*").
 */
const allowedSet: Set<string> | null =
  rawOrigins === "*"
    ? null
    : new Set(rawOrigins.split(",").map((s) => s.trim()).filter(Boolean));

/**
 * Return CORS response headers for the given request Origin.
 *
 * - If ALLOWED_ORIGINS is "*" → always returns `Access-Control-Allow-Origin: *`.
 * - If the request origin is in the allow-list → echoes that origin (+ `Vary: Origin`).
 * - Otherwise → returns the first allowed origin as a safe fallback.
 */
export function makeCorsHeaders(requestOrigin?: string | null): Record<string, string> {
  let origin = "*";
  if (allowedSet) {
    if (requestOrigin && allowedSet.has(requestOrigin)) {
      origin = requestOrigin;
    } else {
      // Fallback: echo the first configured origin so same-domain requests still work.
      origin = [...allowedSet][0] ?? "*";
    }
  }

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-api-key, accept-language",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Max-Age": "86400",
    ...(allowedSet ? { Vary: "Origin" } : {}),
  };
}

/**
 * Static CORS headers for use in success/error response helpers where the
 * original Request object is not available. Falls back to `*` so that
 * a comma-separated ALLOWED_ORIGINS never produces an invalid header value.
 */
export const corsHeaders: Record<string, string> = makeCorsHeaders(null);

/** Return a 204 preflight response with per-request CORS headers. */
export function handleCors(req?: Request): Response {
  const origin = req?.headers.get("origin") ?? null;
  return new Response(null, { status: 204, headers: makeCorsHeaders(origin) });
}
