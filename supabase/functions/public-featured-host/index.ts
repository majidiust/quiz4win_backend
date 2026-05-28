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
import { getPublicClient } from "../_shared/supabase.ts";

interface FeaturedGameRow {
  id: string;
  title: string;
  prize_pool: number | string | null;
  scheduled_at: string | null;
  status: string;
  host_id: string | null;
  host_name: string | null;
  host_avatar_url: string | null;
  host_title: string | null;
  show_hosts: {
    id: string;
    name: string;
    bio: string | null;
    avatar_url: string | null;
    shows_hosted: number | null;
    avg_rating: number | string | null;
    years_on_air: number | null;
  } | null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleCors(req);

  const url = new URL(req.url);
  const tail = url.pathname.replace(/^\/public-featured-host\/?/, "");
  if (req.method !== "GET" || tail.length > 0) return errorResponse("not_found", 404);

  const supabase = getPublicClient();

  try {
    const { data, error } = await supabase
      .from("games")
      .select(
        "id, title, prize_pool, scheduled_at, status, " +
          "host_id, host_name, host_avatar_url, host_title, " +
          "show_hosts!host_id ( id, name, bio, avatar_url, shows_hosted, avg_rating, years_on_air )",
      )
      .eq("is_featured", true)
      .in("status", ["upcoming", "open", "live"])
      .order("scheduled_at", { ascending: true, nullsFirst: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("[public-featured-host] query failed:", error.message);
      return errorResponse("failed_to_fetch_featured_host", 500);
    }

    if (!data) return successResponse({ host: null });

    const row = data as unknown as FeaturedGameRow;
    const linked = row.show_hosts;

    // The card only makes sense when we have a presenter to spotlight. Games
    // with no host_id (only inline host_name/avatar/title) get hidden.
    if (!linked) return successResponse({ host: null });

    return successResponse({
      host: {
        name: linked.name,
        title: row.host_title ?? "Show Host",
        avatar_url: linked.avatar_url ?? row.host_avatar_url ?? null,
        bio: linked.bio ?? null,
        years_on_air: linked.years_on_air ?? null,
        shows_hosted: linked.shows_hosted ?? 0,
        rating: linked.avg_rating != null ? Number(linked.avg_rating) : null,
        next_show_title: row.title,
        next_show_pool_credits: Math.round(Number(row.prize_pool ?? 0)),
        next_show_start_time: row.scheduled_at,
      },
    });
  } catch (err) {
    console.error("[public-featured-host] unhandled error:", err);
    return errorResponse("internal_server_error", 500);
  }
});
