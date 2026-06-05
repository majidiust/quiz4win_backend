/**
 * Public Leaderboard Edge Function — Quiz4Win
 *
 * Read-only, unauthenticated endpoint. The only public surface where
 * individual players are exposed — ranks them by games ended as a survivor
 * and total credits earned over a window.
 *
 *   GET /public-leaderboard?period=weekly|all_time[&limit=N&language=xx]
 *
 * Query params:
 *   period    REQUIRED. "weekly" (rolling 7 days) | "all_time".
 *   limit     1..100, default 20.
 *   language  optional. one of en|ar|fa|tr. Filters games by `games.language`.
 *
 * R-01: no PII surfaced — full_name is rendered as "<first> <initial>." inside
 *       the SQL function; emails/wallet/KYC never leave the DB.
 * R-04: anon client; aggregation runs inside a SECURITY DEFINER SQL function
 *       (20260528200000_public_leaderboard_rpc.sql) that defines the exposed
 *       surface — no service-role bypass in app code.
 */

import { handleCors } from "../_shared/cors.ts";
import { errorResponse, successResponse } from "../_shared/errors.ts";
import { queryClient as sql } from "../_shared/db/client.ts";

const ALLOWED_LANGUAGES = new Set(["en", "ar", "fa", "tr"]);
const ALLOWED_PERIODS = new Set(["weekly", "all_time"]);
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

interface LeaderboardPlayer {
  rank: number;
  player_name: string;
  avatar_url: string | null;
  games_won: number;
  games_played: number;
  total_credits: number;
  favourite_show: string | null;
}

interface LeaderboardPayload {
  players: LeaderboardPlayer[];
  totals: {
    players_listed: number;
    credits_distributed_in_window: number;
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleCors(req);

  const url = new URL(req.url);
  const tail = url.pathname.replace(/^\/public-leaderboard\/?/, "");
  if (req.method !== "GET" || tail.length > 0) return errorResponse("not_found", 404);

  const period = url.searchParams.get("period");
  if (!period || !ALLOWED_PERIODS.has(period)) {
    return errorResponse("invalid_period", 400);
  }

  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") ?? "20")));

  const language = url.searchParams.get("language");
  if (language && !ALLOWED_LANGUAGES.has(language)) {
    return errorResponse("invalid_language", 400);
  }

  const now = new Date();
  const to = now;
  const from = period === "weekly" ? new Date(now.getTime() - WEEK_MS) : null;

  try {
    // Call the SECURITY DEFINER RPC directly over the postgres connection.
    // postgres.js deserialises the returned JSONB into a plain JS object.
    const rows = await sql`
      SELECT get_public_leaderboard(
        ${from ? from.toISOString() : null}::timestamptz,
        ${to.toISOString()}::timestamptz,
        ${limit}::int,
        ${language ?? null}::text
      ) AS result
    `;

    const payload = (rows[0]?.result ?? {
      players: [],
      totals: { players_listed: 0, credits_distributed_in_window: 0 },
    }) as LeaderboardPayload;

    return successResponse({
      period,
      window: {
        from: from ? from.toISOString() : null,
        to: to.toISOString(),
      },
      players: payload.players ?? [],
      totals: payload.totals ?? {
        players_listed: 0,
        credits_distributed_in_window: 0,
      },
    });
  } catch (err) {
    console.error("[public-leaderboard] query failed:", err);
    return errorResponse("failed_to_fetch_leaderboard", 500);
  }
});
