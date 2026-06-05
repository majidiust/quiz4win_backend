/**
 * Public Winners Edge Function — Quiz4Win
 *
 * Read-only, unauthenticated endpoint for the public marketing/winners page.
 * Returns aggregate results per *completed* game run plus rolling totals.
 * NOT one row per player — a single Saturday show may have 10k+ survivors,
 * which is neither meaningful nor shippable to public callers. Each row in
 * `runs` represents one game that finished and how its pool was split.
 *
 *   GET /public-winners
 *
 * Query params:
 *   limit     1..100, default 20 — caps the size of `runs`.
 *   game_id   optional. If it looks like a UUID, matches games.id; otherwise
 *             matches games.show_id (slug). Filters BOTH runs and totals.
 *   language  optional. one of en|ar|fa|tr. Filters BOTH runs and totals.
 *
 * RLS: relies on `games_select_all FOR SELECT TO anon USING (true)` from
 * 20260524200000_customer_rls_policies.sql.
 *
 * R-01: no PII surfaced (no participant identities/emails/IDs).
 * R-04: anon client, RLS enforced — no service-role bypass.
 */

import { handleCors } from "../_shared/cors.ts";
import { errorResponse, successResponse } from "../_shared/errors.ts";
import { queryClient as sql } from "../_shared/db/client.ts";

const ALLOWED_LANGUAGES = new Set(["en", "ar", "fa", "tr"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface CompletedRun {
  id: string;
  show_id: string | null;
  title: string;
  category: string | null;
  mode: string;
  tags: string[] | null;
  prize_pool: number | string | null;
  total_participants: number | null;
  total_winners: number | null;
  ended_at: string | null;
  scheduled_at: string | null;
  language: string | null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleCors(req);

  const url = new URL(req.url);
  const tail = url.pathname.replace(/^\/public-winners\/?/, "");
  if (req.method !== "GET" || tail.length > 0) return errorResponse("not_found", 404);

  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") ?? "20")));
  const gameId = url.searchParams.get("game_id");
  const language = url.searchParams.get("language");
  if (language && !ALLOWED_LANGUAGES.has(language)) {
    return errorResponse("invalid_language", 400);
  }

  // The same filter set is applied to every query so `totals` always describes
  // the same population that `runs` is paged from. Filters are composed as
  // parameterised SQL fragments — no string interpolation of user input.
  try {
    let completedWhere = sql`WHERE status = 'completed'`;
    let activeWhere = sql`WHERE status IN ('upcoming', 'open', 'live')`;
    if (language) {
      completedWhere = sql`${completedWhere} AND language = ${language}`;
      activeWhere = sql`${activeWhere} AND language = ${language}`;
    }
    if (gameId) {
      // game_id filters BOTH runs and totals (not the active-show count).
      completedWhere = UUID_RE.test(gameId)
        ? sql`${completedWhere} AND id = ${gameId}`
        : sql`${completedWhere} AND show_id = ${gameId}`;
    }

    const [listRows, aggRows, activeRows] = await Promise.all([
      sql`
        SELECT id, show_id, title, category, mode, tags, prize_pool,
               total_participants, total_winners, ended_at, scheduled_at, language
        FROM games ${completedWhere}
        ORDER BY ended_at DESC NULLS LAST
        LIMIT ${limit}
      `,
      sql`
        SELECT COALESCE(SUM(ROUND(prize_pool)), 0)::bigint AS credits_distributed,
               COALESCE(SUM(total_winners), 0)::bigint    AS survivors_paid_total,
               COUNT(*)::int                              AS runs_listed
        FROM games ${completedWhere}
      `,
      sql`SELECT COUNT(*)::int AS active FROM games ${activeWhere}`,
    ]);

    const rows = listRows as unknown as CompletedRun[];

    const runs = rows.map((g) => {
      const survivors = g.total_winners ?? 0;
      const pool = Math.round(Number(g.prize_pool ?? 0));
      const isoDate = g.ended_at ?? g.scheduled_at ?? null;
      return {
        run_id: g.id,
        date: isoDate ? isoDate.slice(0, 10) : null,
        game_id: g.show_id ?? g.id,
        game_title: g.title,
        game_tag: g.tags?.[0] ?? g.category ?? g.mode,
        participants: g.total_participants ?? 0,
        survivors,
        pool_credits: pool,
        share_per_survivor_credits: survivors > 0 ? Math.floor(pool / survivors) : 0,
      };
    });

    const creditsDistributed = Number(aggRows[0]?.credits_distributed ?? 0);
    const survivorsPaidTotal = Number(aggRows[0]?.survivors_paid_total ?? 0);
    const runsListed = Number(aggRows[0]?.runs_listed ?? 0);
    const avgWeekly = runsListed > 0 ? Math.round(creditsDistributed / runsListed) : 0;

    return successResponse({
      runs,
      totals: {
        credits_distributed: creditsDistributed,
        runs_listed: runsListed,
        survivors_paid_total: survivorsPaidTotal,
        active_shows: Number(activeRows[0]?.active ?? 0),
        avg_weekly_pool_credits: avgWeekly,
      },
    });
  } catch (err) {
    console.error("[public-winners] query failed:", err);
    return errorResponse("failed_to_fetch_winners", 500);
  }
});
