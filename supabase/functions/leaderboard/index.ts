/**
 * Leaderboard Edge Function — Quiz4Win
 *
 * GET /leaderboard/global — Global leaderboard (API #37)
 *
 * Rule compliance: R-01, R-03
 */

import { handleCors } from "../_shared/cors.ts";
import { errorResponse, successResponse } from "../_shared/errors.ts";
import { validateJWT } from "../_shared/auth.ts";
import { getAnonClient } from "../_shared/supabase.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleCors();

  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/leaderboard\/?/, "");

  const { user, error: authErr } = await validateJWT(req);
  if (authErr || !user) return errorResponse("unauthorized", 401);

  const supabase = getAnonClient(req);

  try {
    // GET /leaderboard/global
    if (path === "global" && req.method === "GET") {
      const period = url.searchParams.get("period") ?? "alltime"; // alltime|weekly|monthly
      const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get("limit") ?? "100")));

      // Determine date filter for period
      let dateFilter: string | null = null;
      if (period === "weekly") {
        const d = new Date();
        d.setDate(d.getDate() - 7);
        dateFilter = d.toISOString();
      } else if (period === "monthly") {
        const d = new Date();
        d.setMonth(d.getMonth() - 1);
        dateFilter = d.toISOString();
      }

      // Aggregate scores from game_participants
      // Join with profiles for display info
      let query = supabase
        .from("game_participants")
        .select("user_id, score, profiles!inner(id, name:full_name, avatar_url)")
        .not("score", "is", null);

      if (dateFilter) {
        query = query.gte("completed_at", dateFilter);
      }

      // We need to aggregate by user. Supabase doesn't support GROUP BY natively in select,
      // so we fetch and aggregate in-memory for now. In production, use a DB view.
      const { data, error } = await query.limit(5000);
      if (error) return errorResponse("Failed to fetch leaderboard", 500);

      // Aggregate scores per user
      const userScores: Record<string, { user_id: string; name: string; avatar_url: string | null; total_score: number; games_played: number }> = {};
      for (const row of (data ?? [])) {
        const uid = row.user_id;
        const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
        if (!userScores[uid]) {
          userScores[uid] = {
            user_id: uid,
            name: profile?.name ?? "Unknown",
            avatar_url: profile?.avatar_url ?? null,
            total_score: 0,
            games_played: 0,
          };
        }
        userScores[uid].total_score += row.score ?? 0;
        userScores[uid].games_played += 1;
      }

      const ranked = Object.values(userScores)
        .sort((a, b) => b.total_score - a.total_score)
        .slice(0, limit)
        .map((entry, idx) => ({ rank: idx + 1, ...entry }));

      // Find current user's rank
      const myRank = ranked.findIndex((e) => e.user_id === user.id);

      return successResponse({
        period,
        leaderboard: ranked,
        my_rank: myRank >= 0 ? myRank + 1 : null,
      });
    }

    return errorResponse("Not found", 404);
  } catch (err) {
    console.error("[leaderboard] unhandled error:", err);
    return errorResponse("Internal server error", 500);
  }
});
