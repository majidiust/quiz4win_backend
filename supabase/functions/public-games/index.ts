/**
 * Public Games Edge Function — Quiz4Win
 *
 * Read-only, unauthenticated endpoints intended for the public marketing
 * website. Mirrors the customer `/games` projection but never requires a
 * JWT and never returns user-scoped fields (no `joined_by_me`).
 *
 *   GET /public-games        — List games (filterable, paginated)
 *   GET /public-games/:id    — Game detail
 *
 * Filters on the list endpoint:
 *   mode       — exact match
 *   status     — single value OR pipe-separated set (default upcoming|open|live)
 *   featured   — "true" | "false"
 *   category   — exact match
 *   difficulty — easy|medium|hard (case-insensitive; normalised to Easy/Medium/Hard)
 *   language   — en|ar|fa|tr
 *   search     — ILIKE against title and subtitle
 *   sort       — start_asc (default) | start_desc | prize_desc | prize_asc | featured_first
 *   page       — 1-based, default 1
 *   limit      — capped at 50, default 20
 *
 * RLS: `public.games` already has `games_select_all FOR SELECT TO anon USING (true)`
 * (see 20260524200000_customer_rls_policies.sql) so the anon client is sufficient.
 *
 * Rule compliance: R-01 (no PII surfaced), R-04 (anon client only, RLS in force).
 */

import { handleCors } from "../_shared/cors.ts";
import { errorResponse, successResponse } from "../_shared/errors.ts";
import { getPublicClient } from "../_shared/supabase.ts";

// Same shape as customer `/games` minus `joined_by_me`. Keep this in lock-step
// with `GAME_FIELDS` in supabase/functions/games/index.ts.
const GAME_FIELDS =
  "id, title, subtitle, description, mode, status, " +
  "entry_fee, prize_pool, prize_pool_currency, " +
  "category, difficulty, language, " +
  "questions_count, time_per_question, allowed_wrong_answers, " +
  "participant_count:total_participants, max_participants:max_players, " +
  "start_time:scheduled_at, end_time:ended_at, " +
  "is_featured, " +
  "icon, thumbnail_url, poster_url, accent_color, glow_color, gradient_colors, " +
  "sponsor, tags, host_name, host_avatar_url, host_title, rules";

const ALLOWED_STATUSES = new Set(["upcoming", "open", "live", "closed", "completed", "cancelled"]);
const ALLOWED_DIFFICULTY = new Set(["Easy", "Medium", "Hard"]);
const ALLOWED_LANGUAGES = new Set(["en", "ar", "fa", "tr"]);

function normaliseDifficulty(raw: string): string | null {
  const v = raw.trim();
  const cap = v.charAt(0).toUpperCase() + v.slice(1).toLowerCase();
  return ALLOWED_DIFFICULTY.has(cap) ? cap : null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleCors(req);

  const url = new URL(req.url);
  const parts = url.pathname.replace(/^\/public-games\/?/, "").split("/").filter(Boolean);
  const gameId = parts[0] ?? null;
  const extra = parts[1] ?? null;

  if (req.method !== "GET") return errorResponse("not_found", 404);
  // Only `/public-games/:id/result` is a valid sub-path. Anything else 404s.
  if (extra && extra !== "result") return errorResponse("not_found", 404);

  const supabase = getPublicClient();

  try {
    // GET /public-games/:id/result — aggregate result + prize distribution.
    // Returns the JSONB persisted by distribute_prizes() so the response is
    // stable across calls (no recomputation) and matches the GAME_RESULT
    // LiveKit broadcast emitted by the orchestrator.
    if (gameId && extra === "result") {
      const { data, error } = await supabase
        .from("games")
        .select("id, status, result_summary, prizes_distributed_at, ended_at")
        .eq("id", gameId)
        .single();
      if (error || !data) return errorResponse("game_not_found", 404);
      if (!data.result_summary) {
        // Distribution still pending — surface a structured 409 so the client
        // can poll/await instead of treating it as a hard failure.
        return errorResponse(
          data.status === "completed" ? "result_pending" : "game_not_completed",
          409,
        );
      }
      return successResponse({
        game_id:               data.id,
        status:                data.status,
        ended_at:              data.ended_at,
        prizes_distributed_at: data.prizes_distributed_at,
        result:                data.result_summary,
      });
    }

    // GET /public-games/:id
    if (gameId) {
      const { data, error } = await supabase
        .from("games")
        .select(GAME_FIELDS)
        .eq("id", gameId)
        .single();
      if (error || !data) return errorResponse("game_not_found", 404);
      return successResponse({ game: data });
    }

    // GET /public-games — list with filters
    const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1"));
    const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get("limit") ?? "20")));
    const offset = (page - 1) * limit;

    const mode = url.searchParams.get("mode");
    const featured = url.searchParams.get("featured");
    const category = url.searchParams.get("category");
    const language = url.searchParams.get("language");
    const search = url.searchParams.get("search");
    const sort = url.searchParams.get("sort") ?? "start_asc";
    const difficultyRaw = url.searchParams.get("difficulty");
    const statusParam = url.searchParams.get("status") ?? "upcoming|open|live";

    // Validate & normalise inputs before they touch the query builder so we
    // never round-trip an obviously-bad value to Postgres.
    const statuses = statusParam.split("|").map((s) => s.trim()).filter(Boolean);
    if (statuses.some((s) => !ALLOWED_STATUSES.has(s))) {
      return errorResponse("invalid_status", 400);
    }
    if (language && !ALLOWED_LANGUAGES.has(language)) {
      return errorResponse("invalid_language", 400);
    }
    let difficulty: string | null = null;
    if (difficultyRaw) {
      difficulty = normaliseDifficulty(difficultyRaw);
      if (!difficulty) return errorResponse("invalid_difficulty", 400);
    }

    let query = supabase
      .from("games")
      .select(GAME_FIELDS, { count: "exact" })
      .range(offset, offset + limit - 1);

    if (mode) query = query.eq("mode", mode);
    if (featured === "true") query = query.eq("is_featured", true);
    if (featured === "false") query = query.eq("is_featured", false);
    if (category) query = query.eq("category", category);
    if (difficulty) query = query.eq("difficulty", difficulty);
    if (language) query = query.eq("language", language);
    if (search) {
      // ILIKE escaping — strip wildcards so callers can't run arbitrary
      // patterns; we wrap the cleaned value in % ourselves.
      const safe = search.replace(/[%_]/g, "").trim();
      if (safe) query = query.or(`title.ilike.%${safe}%,subtitle.ilike.%${safe}%`);
    }
    if (statuses.length === 1) query = query.eq("status", statuses[0]);
    else query = query.in("status", statuses);

    switch (sort) {
      case "start_desc":     query = query.order("scheduled_at", { ascending: false }); break;
      case "prize_desc":     query = query.order("prize_pool", { ascending: false }); break;
      case "prize_asc":      query = query.order("prize_pool", { ascending: true }); break;
      case "featured_first": query = query.order("is_featured", { ascending: false }).order("scheduled_at", { ascending: true }); break;
      case "start_asc":
      default:               query = query.order("scheduled_at", { ascending: true }); break;
    }

    const { data, error, count } = await query;
    if (error) {
      console.error(`[public-games] list query failed: ${error.message}`, error);
      return errorResponse("failed_to_fetch_games", 500);
    }

    return successResponse({
      games: data ?? [],
      pagination: {
        page,
        limit,
        total: count ?? 0,
        total_pages: Math.ceil((count ?? 0) / limit),
      },
    });
  } catch (err) {
    console.error("[public-games] unhandled error:", err);
    return errorResponse("internal_server_error", 500);
  }
});
