/**
 * Public Hosts Edge Function — Quiz4Win
 *
 * Read-only, unauthenticated endpoints for the customer app to browse host
 * profiles. No JWT required. Only active + approved hosts are surfaced (the
 * `show_hosts_select_active` RLS policy filters status='active' at the DB
 * layer; we also add application_status='approved' in every query for defence
 * in depth).
 *
 * Routes:
 *   GET /public-hosts                    — list hosts (paginated, filterable)
 *   GET /public-hosts/:id                — host profile + stats
 *   GET /public-hosts/:id/live           — current live show (if any)
 *   GET /public-hosts/:id/upcoming       — upcoming assigned shows (paginated)
 *   GET /public-hosts/:id/history        — past completed shows (paginated)
 *
 * Filters on /public-hosts:
 *   search   — ILIKE against name and short_bio
 *   country  — exact match
 *   language — exact match (value contained in languages[])
 *   sort     — rating_desc (default) | shows_desc | newest
 *   page     — 1-based, default 1
 *   limit    — capped at 50, default 20
 *
 * Rule compliance:
 *   R-01: no PII returned (phone, auth_user_id, lifecycle timestamps excluded)
 *   R-04: anon / public client only — RLS is in force
 */

import { handleCors } from "../_shared/cors.ts";
import { errorResponse, successResponse } from "../_shared/errors.ts";
import { getPublicClient } from "../_shared/supabase.ts";

// Public-safe host fields — deliberately excludes PII:
//   phone, auth_user_id, applied_at, approved_at, approved_by,
//   rejected_at, rejection_reason, suspended_at, suspension_reason, total_earnings.
const HOST_PUBLIC_FIELDS =
  "id, name, short_bio, bio, avatar_url, country, languages, " +
  "shows_hosted, avg_rating, years_on_air, created_at, " +
  "instagram_url, telegram_url, youtube_url, tiktok_url, twitter_url, website_url";

// Summary game fields shown inside upcoming / history lists.
const GAME_SUMMARY_FIELDS =
  "id, title, mode, status, entry_fee, prize_pool, prize_pool_currency, " +
  "participant_count:total_participants, max_participants:max_players, " +
  "start_time:scheduled_at, end_time:ended_at, " +
  "thumbnail_url, poster_url, accent_color";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleCors(req);
  if (req.method !== "GET") return errorResponse("not_found", 404);

  const url = new URL(req.url);
  const parts = url.pathname.replace(/^\/public-hosts\/?/, "").split("/").filter(Boolean);
  const hostId = parts[0] ?? null;
  const sub    = parts[1] ?? null; // "live" | "upcoming" | "history"

  const supabase = getPublicClient();

  try {
    // ── GET /public-hosts/:id/live ─────────────────────────────────────────
    if (hostId && sub === "live") {
      // Verify host exists and is visible first.
      const { data: host } = await supabase
        .from("show_hosts")
        .select("id")
        .eq("id", hostId)
        .eq("application_status", "approved")
        .maybeSingle();
      if (!host) return errorResponse("host_not_found", 404);

      const { data, error } = await supabase
        .from("games")
        .select(GAME_SUMMARY_FIELDS)
        .eq("host_id", hostId)
        .eq("status", "live")
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error("[public-hosts] live query error:", error.message);
        return errorResponse("internal_server_error", 500);
      }
      return successResponse({ live_show: data ?? null });
    }

    // ── GET /public-hosts/:id/upcoming ────────────────────────────────────
    if (hostId && sub === "upcoming") {
      const { data: host } = await supabase
        .from("show_hosts")
        .select("id")
        .eq("id", hostId)
        .eq("application_status", "approved")
        .maybeSingle();
      if (!host) return errorResponse("host_not_found", 404);

      const page  = Math.max(1, parseInt(url.searchParams.get("page")  ?? "1"));
      const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get("limit") ?? "10")));
      const offset = (page - 1) * limit;

      const { data, error, count } = await supabase
        .from("games")
        .select(GAME_SUMMARY_FIELDS, { count: "exact" })
        .eq("host_id", hostId)
        .in("status", ["upcoming", "open"])
        .order("scheduled_at", { ascending: true })
        .range(offset, offset + limit - 1);

      if (error) {
        console.error("[public-hosts] upcoming query error:", error.message);
        return errorResponse("internal_server_error", 500);
      }
      return successResponse({
        shows: data ?? [],
        pagination: { page, limit, total: count ?? 0, total_pages: Math.ceil((count ?? 0) / limit) },
      });
    }

    // ── GET /public-hosts/:id/history ─────────────────────────────────────
    if (hostId && sub === "history") {
      const { data: host } = await supabase
        .from("show_hosts")
        .select("id")
        .eq("id", hostId)
        .eq("application_status", "approved")
        .maybeSingle();
      if (!host) return errorResponse("host_not_found", 404);

      const page  = Math.max(1, parseInt(url.searchParams.get("page")  ?? "1"));
      const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get("limit") ?? "20")));
      const offset = (page - 1) * limit;

      const { data, error, count } = await supabase
        .from("games")
        .select(GAME_SUMMARY_FIELDS, { count: "exact" })
        .eq("host_id", hostId)
        .eq("status", "completed")
        .order("ended_at", { ascending: false, nullsFirst: false })
        .range(offset, offset + limit - 1);

      if (error) {
        console.error("[public-hosts] history query error:", error.message);
        return errorResponse("internal_server_error", 500);
      }
      return successResponse({
        shows: data ?? [],
        pagination: { page, limit, total: count ?? 0, total_pages: Math.ceil((count ?? 0) / limit) },
      });
    }

    // ── GET /public-hosts/:id — profile ───────────────────────────────────
    if (hostId && !sub) {
      const { data: host, error: hostErr } = await supabase
        .from("show_hosts")
        .select(HOST_PUBLIC_FIELDS)
        .eq("id", hostId)
        .eq("application_status", "approved")
        .maybeSingle();

      if (hostErr || !host) return errorResponse("host_not_found", 404);

      // Fetch live + upcoming counts in parallel.
      const [liveRes, upcomingRes] = await Promise.all([
        supabase.from("games").select("id", { count: "exact", head: true })
          .eq("host_id", hostId).eq("status", "live"),
        supabase.from("games").select("id", { count: "exact", head: true })
          .eq("host_id", hostId).in("status", ["upcoming", "open"]),
      ]);

      return successResponse({
        host: {
          ...host,
          is_live: (liveRes.count ?? 0) > 0,
          upcoming_shows_count: upcomingRes.count ?? 0,
        },
      });
    }

    // ── GET /public-hosts — list ──────────────────────────────────────────
    const page  = Math.max(1, parseInt(url.searchParams.get("page")  ?? "1"));
    const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get("limit") ?? "20")));
    const offset = (page - 1) * limit;

    const search   = url.searchParams.get("search");
    const country  = url.searchParams.get("country");
    const language = url.searchParams.get("language");
    const sort     = url.searchParams.get("sort") ?? "rating_desc";

    let query = supabase
      .from("show_hosts")
      .select(HOST_PUBLIC_FIELDS, { count: "exact" })
      .eq("application_status", "approved") // defence in depth (RLS covers status='active')
      .range(offset, offset + limit - 1);

    if (country)  query = query.eq("country", country);
    if (language) query = query.contains("languages", [language]);
    if (search) {
      const safe = search.replace(/[%_]/g, "").trim();
      if (safe) query = query.or(`name.ilike.%${safe}%,short_bio.ilike.%${safe}%`);
    }

    switch (sort) {
      case "shows_desc": query = query.order("shows_hosted", { ascending: false, nullsFirst: false }); break;
      case "newest":     query = query.order("created_at",   { ascending: false }); break;
      case "rating_desc":
      default:           query = query.order("avg_rating",   { ascending: false, nullsFirst: false }); break;
    }

    const { data, error, count } = await query;
    if (error) {
      console.error("[public-hosts] list query error:", error.message);
      return errorResponse("internal_server_error", 500);
    }

    return successResponse({
      hosts: data ?? [],
      pagination: { page, limit, total: count ?? 0, total_pages: Math.ceil((count ?? 0) / limit) },
    });

  } catch (err) {
    console.error("[public-hosts] unhandled error:", err);
    return errorResponse("internal_server_error", 500);
  }
});
