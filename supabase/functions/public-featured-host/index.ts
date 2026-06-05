/**
 * Public Featured Host Edge Function — Quiz4Win
 *
 * Powers the homepage "Host Spotlight" card. Returns the host of the closest
 * active featured game (is_featured = TRUE AND status IN ('upcoming','open',
 * 'live')). When no such game exists, returns { host: null } so the front-end
 * can hide the section.
 *
 *   GET /public-featured-host
 *
 * "Closest" = soonest scheduled_at ascending. Currently-live shows have a
 * scheduled_at in the past, so they naturally sort to the top.
 *
 * R-01: only public host-card fields are returned (name, title, avatar, bio,
 *       years_on_air, shows_hosted, rating). No emails/PII.
 * R-04: anon client only. show_hosts has anon SELECT policy
 *       (20260528300000_show_hosts_public_access.sql).
 */

import { handleCors } from "../_shared/cors.ts";
import { errorResponse, successResponse } from "../_shared/errors.ts";
import { queryClient as sql } from "../_shared/db/client.ts";

interface FeaturedHostRow {
  title: string;
  prize_pool: number | string | null;
  scheduled_at: string | null;
  host_title: string | null;
  host_avatar_url: string | null;
  h_id: string | null;
  h_name: string | null;
  h_bio: string | null;
  h_avatar_url: string | null;
  h_shows_hosted: number | null;
  h_avg_rating: number | string | null;
  h_years_on_air: number | null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleCors(req);

  const url = new URL(req.url);
  const tail = url.pathname.replace(/^\/public-featured-host\/?/, "");
  if (req.method !== "GET" || tail.length > 0) return errorResponse("not_found", 404);

  try {
    const rows = await sql`
      SELECT g.title, g.prize_pool, g.scheduled_at,
             g.host_title, g.host_avatar_url,
             h.id            AS h_id,
             h.name          AS h_name,
             h.bio           AS h_bio,
             h.avatar_url    AS h_avatar_url,
             h.shows_hosted  AS h_shows_hosted,
             h.avg_rating    AS h_avg_rating,
             h.years_on_air  AS h_years_on_air
      FROM games g
      LEFT JOIN show_hosts h ON h.id = g.host_id
      WHERE g.is_featured = true
        AND g.status IN ('upcoming', 'open', 'live')
      ORDER BY g.scheduled_at ASC NULLS LAST
      LIMIT 1
    `;

    if (rows.length === 0) return successResponse({ host: null });

    const row = rows[0] as unknown as FeaturedHostRow;

    // The card only makes sense when we have a presenter to spotlight. Games
    // with no host_id (only inline host_name/avatar/title) get hidden.
    if (!row.h_id) return successResponse({ host: null });

    return successResponse({
      host: {
        name: row.h_name,
        title: row.host_title ?? "Show Host",
        avatar_url: row.h_avatar_url ?? row.host_avatar_url ?? null,
        bio: row.h_bio ?? null,
        years_on_air: row.h_years_on_air ?? null,
        shows_hosted: row.h_shows_hosted ?? 0,
        rating: row.h_avg_rating != null ? Number(row.h_avg_rating) : null,
        next_show_title: row.title,
        next_show_pool_credits: Math.round(Number(row.prize_pool ?? 0)),
        next_show_start_time: row.scheduled_at,
      },
    });
  } catch (err) {
    console.error("[public-featured-host] query failed:", err);
    return errorResponse("failed_to_fetch_featured_host", 500);
  }
});
