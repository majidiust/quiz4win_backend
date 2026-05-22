/**
 * CORS headers shared across all Quiz4Win Edge Functions.
 *
 * The `Access-Control-Allow-Origin` is set to `*` for development.
 * In production, restrict to your actual domain(s) via the
 * `ALLOWED_ORIGINS` Supabase secret (comma-separated list).
 *
 * Usage:
 *   import { corsHeaders, handleCors } from '../_shared/cors.ts';
 *
 *   if (req.method === 'OPTIONS') return handleCors();
 */

const allowedOrigins = Deno.env.get("ALLOWED_ORIGINS") ?? "*";

export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": allowedOrigins,
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-api-key, accept-language",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

/** Return a 200 preflight response with CORS headers. */
export function handleCors(): Response {
  return new Response(null, { status: 204, headers: corsHeaders });
}
