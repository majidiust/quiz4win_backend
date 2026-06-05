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
import { queryClient as sql } from "../_shared/db/client.ts";

// Same projection as customer `/games` minus `joined_by_me`. Keep this in
// lock-step with `GAME_FIELDS` in supabase/functions/games/index.ts. NUMERIC
// money columns are cast to float8 so the JSON shape matches the previous
// PostgREST output (numbers, not strings); column aliases reproduce the
// PostgREST renames (participant_count, max_participants, start_time, end_time).
const GAME_COLS = sql`
  id, title, subtitle, description, mode, status,
  entry_fee::float8 AS entry_fee, prize_pool::float8 AS prize_pool, prize_pool_currency,
  category, difficulty, language,
  questions_count, time_per_question, allowed_wrong_answers,
  total_participants AS participant_count, max_players AS max_participants,
  scheduled_at AS start_time, ended_at AS end_time,
  is_featured,
  icon, thumbnail_url, poster_url, accent_color, glow_color, gradient_colors,
  sponsor, tags, host_name, host_avatar_url, host_title, rules
`;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  try {
    // GET /public-games/:id/result — aggregate result + prize distribution.
    // Returns the JSONB persisted by distribute_prizes() so the response is
    // stable across calls (no recomputation) and matches the GAME_RESULT
    // LiveKit broadcast emitted by the orchestrator.
    if (gameId && extra === "result") {
      if (!UUID_RE.test(gameId)) return errorResponse("game_not_found", 404);
      const rows = await sql`
        SELECT id, status, result_summary, prizes_distributed_at, ended_at
        FROM games WHERE id = ${gameId} LIMIT 1
      `;
      if (rows.length === 0) return errorResponse("game_not_found", 404);
      const data = rows[0];
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
      if (!UUID_RE.test(gameId)) return errorResponse("game_not_found", 404);
      const rows = await sql`SELECT ${GAME_COLS} FROM games WHERE id = ${gameId} LIMIT 1`;
      if (rows.length === 0) return errorResponse("game_not_found", 404);
      return successResponse({ game: rows[0] });
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

    // Build the WHERE clause incrementally as a composed SQL fragment. Every
    // user-supplied value is bound as a parameter ($n) — never string-interpolated.
    let where = sql`WHERE true`;
    if (mode) where = sql`${where} AND mode = ${mode}`;
    if (featured === "true") where = sql`${where} AND is_featured = true`;
    if (featured === "false") where = sql`${where} AND is_featured = false`;
    if (category) where = sql`${where} AND category = ${category}`;
    if (difficulty) where = sql`${where} AND difficulty = ${difficulty}`;
    if (language) where = sql`${where} AND language = ${language}`;
    if (search) {
      // Strip ILIKE wildcards so callers can't run arbitrary patterns; we wrap
      // the cleaned value in % ourselves and bind it as a parameter.
      const safe = search.replace(/[%_]/g, "").trim();
      if (safe) {
        const pat = `%${safe}%`;
        where = sql`${where} AND (title ILIKE ${pat} OR subtitle ILIKE ${pat})`;
      }
    }
    if (statuses.length === 1) where = sql`${where} AND status = ${statuses[0]}`;
    else where = sql`${where} AND status = ANY(${statuses})`;

    let orderBy = sql`ORDER BY scheduled_at ASC`;
    switch (sort) {
      case "start_desc":     orderBy = sql`ORDER BY scheduled_at DESC`; break;
      case "prize_desc":     orderBy = sql`ORDER BY prize_pool DESC`; break;
      case "prize_asc":      orderBy = sql`ORDER BY prize_pool ASC`; break;
      case "featured_first": orderBy = sql`ORDER BY is_featured DESC, scheduled_at ASC`; break;
      case "start_asc":
      default:               orderBy = sql`ORDER BY scheduled_at ASC`; break;
    }

    // Data page + exact total in parallel; both reuse the same WHERE fragment.
    const [rows, countRows] = await Promise.all([
      sql`SELECT ${GAME_COLS} FROM games ${where} ${orderBy} LIMIT ${limit} OFFSET ${offset}`,
      sql`SELECT COUNT(*)::int AS total FROM games ${where}`,
    ]);
    const total = (countRows[0]?.total as number) ?? 0;

    return successResponse({
      games: rows,
      pagination: {
        page,
        limit,
        total,
        total_pages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    console.error("[public-games] query failed:", err);
    return errorResponse("failed_to_fetch_games", 500);
  }
});
