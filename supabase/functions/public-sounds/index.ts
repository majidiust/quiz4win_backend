/**
 * Public Sounds Edge Function — Quiz4Win
 *
 * GET /public-sounds           — Returns all active app sounds (flat list + grouped by usage)
 * GET /public-sounds?usage=x   — Filter to a single usage slot
 *
 * Unauthenticated. Intended for the mobile app to fetch on startup and cache
 * the correct audio file for each UI event (correct_answer, countdown, etc.).
 *
 * RLS on app_sounds enforces `is_active = true` for the anon role, so the
 * filter here is an belt-and-suspenders explicit WHERE.
 *
 * Rule compliance: R-01 (no PII), R-04 (anon/public client only, RLS active).
 */

import { handleCors } from "../_shared/cors.ts";
import { errorResponse, successResponse } from "../_shared/errors.ts";
import { getPublicClient } from "../_shared/supabase.ts";

const VALID_USAGES = new Set([
  "splash", "home", "home_before_start", "register", "game_details",
  "correct_answer", "incorrect_answer", "countdown", "pregame_music",
  "winner", "announcement", "livestream",
]);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleCors(req);
  if (req.method !== "GET") return errorResponse("Method not allowed", 405);

  const url = new URL(req.url);
  const usageFilter = url.searchParams.get("usage");

  // Reject unknown usage values early
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

  const sounds = data ?? [];

  // Group by usage so mobile clients can do O(1) lookup by event name
  const grouped: Record<string, typeof sounds> = {};
  for (const s of sounds) {
    if (!grouped[s.usage]) grouped[s.usage] = [];
    grouped[s.usage].push(s);
  }

  return successResponse({ sounds, grouped });
});
