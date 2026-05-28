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
import { getPublicClient } from "../_shared/supabase.ts";

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

interface AggregateRow {
  prize_pool: number | string | null;
  total_winners: number | null;
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

  const supabase = getPublicClient();

  // The same filter set is applied to every query so `totals` always describes
  // the same population that `runs` is paged from.
  try {
    let listQuery = supabase
      .from("games")
      .select(
        "id, show_id, title, category, mode, tags, prize_pool, " +
          "total_participants, total_winners, ended_at, scheduled_at, language",
      )
      .eq("status", "completed")
      .order("ended_at", { ascending: false, nullsFirst: false })
      .limit(limit);

    let aggQuery = supabase
      .from("games")
      .select("prize_pool, total_winners")
      .eq("status", "completed");

    let activeQuery = supabase
      .from("games")
      .select("id", { count: "exact", head: true })
      .in("status", ["upcoming", "open", "live"]);

    if (language) {
      listQuery = listQuery.eq("language", language);
      aggQuery = aggQuery.eq("language", language);
      activeQuery = activeQuery.eq("language", language);
    }
    if (gameId) {
      const col = UUID_RE.test(gameId) ? "id" : "show_id";
      listQuery = listQuery.eq(col, gameId);
      aggQuery = aggQuery.eq(col, gameId);
    }

    const [listRes, aggRes, activeRes] = await Promise.all([listQuery, aggQuery, activeQuery]);

    if (listRes.error || aggRes.error || activeRes.error) {
      console.error(
        "[public-winners] query failed:",
        listRes.error?.message ?? aggRes.error?.message ?? activeRes.error?.message,
      );
      return errorResponse("failed_to_fetch_winners", 500);
    }

    const rows = (listRes.data ?? []) as CompletedRun[];
    const aggRows = (aggRes.data ?? []) as AggregateRow[];

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

    const creditsDistributed = aggRows.reduce((s, r) => s + Math.round(Number(r.prize_pool ?? 0)), 0);
    const survivorsPaidTotal = aggRows.reduce((s, r) => s + (r.total_winners ?? 0), 0);
    const runsListed = aggRows.length;
    const avgWeekly = runsListed > 0 ? Math.round(creditsDistributed / runsListed) : 0;

    return successResponse({
      runs,
      totals: {
        credits_distributed: creditsDistributed,
        runs_listed: runsListed,
        survivors_paid_total: survivorsPaidTotal,
        active_shows: activeRes.count ?? 0,
        avg_weekly_pool_credits: avgWeekly,
      },
    });
  } catch (err) {
    console.error("[public-winners] unhandled error:", err);
    return errorResponse("internal_server_error", 500);
  }
});
