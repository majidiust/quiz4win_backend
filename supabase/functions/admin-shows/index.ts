/**
 * Admin Shows Edge Function — Quiz4Win
 *
 * GET   /admin/shows                    — List shows (API #102)
 * POST  /admin/shows                    — Create show (API #103)
 * PATCH /admin/shows/:id                — Update show (API #104)
 * POST  /admin/shows/:id/start          — Start show (API #105)
 * POST  /admin/shows/:id/end            — End show (API #106)
 * POST  /admin/shows/:id/host-token     — Host LiveKit token (API #107)
 * POST  /admin/shows/:id/next-question  — Push question (API #108)
 * POST  /admin/shows/:id/reveal-answer  — Reveal answer (API #109)
 * GET   /admin/shows/:id/egress         — Egress status (API #110)
 * GET   /admin/shows/hosts              — List hosts (API #111)
 * POST  /admin/shows/hosts              — Create host (API #112)
 *
 * Rule compliance: R-01, R-03
 */

import { handleCors } from "../_shared/cors.ts";
import { errorResponse, successResponse, sanitizeError } from "../_shared/errors.ts";
import { validateJWT, requireAdminRole } from "../_shared/auth.ts";
import { getAdminClient } from "../_shared/supabase.ts";

const LIVEKIT_URL = Deno.env.get("LIVEKIT_SERVER_URL") ?? "";
const LIVEKIT_API_KEY = Deno.env.get("LIVEKIT_API_KEY") ?? "";
const LIVEKIT_API_SECRET = Deno.env.get("LIVEKIT_API_SECRET") ?? "";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleCors();

  const url = new URL(req.url);
  const parts = url.pathname.replace(/^\/admin\/shows\/?/, "").split("/").filter(Boolean);
  const showIdOrResource = parts[0] ?? null;
  const action = parts[1] ?? null;

  const { user, error: authErr } = await validateJWT(req);
  if (authErr || !user) return errorResponse("unauthorized", 401);
  const { error: adminErr } = await requireAdminRole(user.id, ["super_admin", "admin", "moderator"]);
  if (adminErr) return errorResponse(adminErr, 403);

  const admin = getAdminClient();

  try {
    // GET /admin/shows/hosts
    if (showIdOrResource === "hosts" && !action && req.method === "GET") {
      const { data, error } = await admin.from("show_hosts").select("*").order("created_at", { ascending: false });
      if (error) return errorResponse("Failed to list hosts", 500);
      return successResponse({ hosts: data ?? [] });
    }

    // POST /admin/shows/hosts
    if (showIdOrResource === "hosts" && !action && req.method === "POST") {
      const { name, email, bio, avatar_url } = await req.json();
      if (!name || !email) return errorResponse("name and email are required", 400);
      const { data, error } = await admin.from("show_hosts").insert({ name, email, bio: bio ?? null, avatar_url: avatar_url ?? null, created_at: new Date().toISOString() }).select("*").single();
      if (error) return errorResponse(sanitizeError(error), 400);
      return successResponse({ host: data }, 201);
    }

    // GET /admin/shows
    if (!showIdOrResource && req.method === "GET") {
      const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1"));
      const limit = Math.min(100, parseInt(url.searchParams.get("limit") ?? "20"));
      const offset = (page - 1) * limit;
      const { data, error, count } = await admin.from("games").select("*", { count: "exact" }).eq("mode", "live").order("start_time", { ascending: false }).range(offset, offset + limit - 1);
      if (error) return errorResponse("Failed to list shows", 500);
      return successResponse({ shows: data ?? [], pagination: { page, limit, total: count ?? 0 } });
    }

    // POST /admin/shows
    if (!showIdOrResource && req.method === "POST") {
      const body = await req.json();
      const { data, error } = await admin.from("games").insert({ ...body, mode: "live", status: "upcoming", participant_count: 0, created_by: user.id, created_at: new Date().toISOString() }).select("*").single();
      if (error) return errorResponse(sanitizeError(error), 400);
      return successResponse({ show: data }, 201);
    }

    const showId = showIdOrResource;

    // PATCH /admin/shows/:id
    if (showId && !action && req.method === "PATCH") {
      const body = await req.json();
      const { data, error } = await admin.from("games").update({ ...body, updated_at: new Date().toISOString() }).eq("id", showId).eq("mode", "live").select("*").single();
      if (error || !data) return errorResponse(data ? sanitizeError(error!) : "show_not_found", data ? 400 : 404);
      return successResponse({ show: data });
    }

    // POST /admin/shows/:id/start
    if (showId && action === "start" && req.method === "POST") {
      await admin.from("games").update({ status: "live", started_at: new Date().toISOString() }).eq("id", showId);
      // TODO: create LiveKit room via LIVEKIT_URL
      await admin.from("admin_audit_log").insert({ admin_id: user.id, action: "show_started", target_type: "show", target_id: showId, created_at: new Date().toISOString() });
      return successResponse({ message: "Show started", livekit_note: "LiveKit room creation requires LIVEKIT_SERVER_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET env secrets" });
    }

    // POST /admin/shows/:id/end
    if (showId && action === "end" && req.method === "POST") {
      await admin.from("games").update({ status: "ended", ended_at: new Date().toISOString() }).eq("id", showId);
      await admin.from("admin_audit_log").insert({ admin_id: user.id, action: "show_ended", target_type: "show", target_id: showId, created_at: new Date().toISOString() });
      return successResponse({ message: "Show ended" });
    }

    // POST /admin/shows/:id/host-token
    if (showId && action === "host-token" && req.method === "POST") {
      if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
        return errorResponse("LiveKit credentials not configured (LIVEKIT_API_KEY, LIVEKIT_API_SECRET)", 503);
      }
      // LiveKit token generation requires the @livekit/server-sdk package
      return successResponse({ message: "LiveKit host token generation — integrate @livekit/server-sdk", room_name: showId, identity: `host-${user.id}` });
    }

    // POST /admin/shows/:id/next-question
    if (showId && action === "next-question" && req.method === "POST") {
      const { data: result, error } = await admin.rpc("advance_game_question", { p_game_id: showId });
      if (error) return errorResponse(sanitizeError(error), 400);
      return successResponse({ result });
    }

    // POST /admin/shows/:id/reveal-answer
    if (showId && action === "reveal-answer" && req.method === "POST") {
      const { question_id } = await req.json();
      if (!question_id) return errorResponse("question_id is required", 400);
      const { data: question } = await admin.from("game_questions").select("question_id, questions(correct_answer, explanation)").eq("game_id", showId).eq("question_id", question_id).single();
      if (!question) return errorResponse("question_not_found", 404);
      // TODO: broadcast correct answer via Supabase Realtime / LiveKit data channel
      return successResponse({ message: "Answer revealed", question });
    }

    // GET /admin/shows/:id/egress
    if (showId && action === "egress" && req.method === "GET") {
      // TODO: call LiveKit egress API
      return successResponse({ message: "LiveKit egress status — integrate LiveKit Server API", show_id: showId, status: "not_configured" });
    }

    return errorResponse("Not found", 404);
  } catch (err) {
    console.error("[admin-shows] unhandled error:", err);
    return errorResponse("Internal server error", 500);
  }
});
