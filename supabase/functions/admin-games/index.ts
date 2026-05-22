/**
 * Admin Games Edge Function — Quiz4Win
 *
 * GET    /admin/games                          — List all games (API #83)
 * GET    /admin/games/:id                      — Game detail (API #84)
 * POST   /admin/games                          — Create game (API #85)
 * PATCH  /admin/games/:id                      — Update game (API #86)
 * POST   /admin/games/:id/cancel               — Cancel game (API #87)
 * POST   /admin/games/:id/start                — Start game (API #88)
 * POST   /admin/games/:id/end                  — End game (API #89)
 * POST   /admin/games/:id/next-question        — Push next question (API #90)
 * GET    /admin/games/:id/participants         — Participants (API #91)
 * DELETE /admin/games/:id/participants/:uid    — Remove participant (API #92)
 *
 * Rule compliance: R-01, R-02, R-03, R-05
 */

import { handleCors } from "../_shared/cors.ts";
import { errorResponse, successResponse, sanitizeError } from "../_shared/errors.ts";
import { validateJWT, requireAdminRole } from "../_shared/auth.ts";
import { getAdminClient } from "../_shared/supabase.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleCors();

  const url = new URL(req.url);
  const parts = url.pathname.replace(/^\/admin\/games\/?/, "").split("/").filter(Boolean);
  const gameId = parts[0] ?? null;
  const action = parts[1] ?? null;
  const actionId = parts[2] ?? null;

  const { user, error: authErr } = await validateJWT(req);
  if (authErr || !user) return errorResponse("unauthorized", 401);
  const { error: adminErr } = await requireAdminRole(user.id, ["super_admin", "admin", "moderator"]);
  if (adminErr) return errorResponse(adminErr, 403);

  const admin = getAdminClient();

  try {
    // GET /admin/games
    if (!gameId && req.method === "GET") {
      const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1"));
      const limit = Math.min(100, parseInt(url.searchParams.get("limit") ?? "20"));
      const status = url.searchParams.get("status");
      const offset = (page - 1) * limit;

      let query = admin.from("games").select("*", { count: "exact" }).order("created_at", { ascending: false }).range(offset, offset + limit - 1);
      if (status) { const statuses = status.split("|"); if (statuses.length === 1) query = query.eq("status", statuses[0]); else query = query.in("status", statuses); }

      const { data, error, count } = await query;
      if (error) return errorResponse("Failed to list games", 500);
      return successResponse({ games: data ?? [], pagination: { page, limit, total: count ?? 0, total_pages: Math.ceil((count ?? 0) / limit) } });
    }

    // GET /admin/games/:id
    if (gameId && !action && req.method === "GET") {
      const { data, error } = await admin.from("games").select("*").eq("id", gameId).single();
      if (error || !data) return errorResponse("game_not_found", 404);
      return successResponse({ game: data });
    }

    // POST /admin/games — create
    if (!gameId && req.method === "POST") {
      const body = await req.json();
      const required = ["title", "mode", "entry_fee", "prize_pool", "start_time", "max_participants"];
      for (const f of required) { if (body[f] === undefined) return errorResponse(`${f} is required`, 400); }

      const { data, error } = await admin.from("games").insert({ ...body, status: "upcoming", participant_count: 0, created_by: user.id, created_at: new Date().toISOString() }).select("*").single();
      if (error) return errorResponse(sanitizeError(error), 400);
      await admin.from("admin_audit_log").insert({ admin_id: user.id, action: "game_created", target_type: "game", target_id: data.id, created_at: new Date().toISOString() });
      return successResponse({ game: data }, 201);
    }

    // PATCH /admin/games/:id
    if (gameId && !action && req.method === "PATCH") {
      const { data: existing } = await admin.from("games").select("status").eq("id", gameId).single();
      if (!existing) return errorResponse("game_not_found", 404);
      if (!["upcoming", "open"].includes(existing.status)) return errorResponse("Cannot edit a game that has started or ended", 400);

      const body = await req.json();
      const { data, error } = await admin.from("games").update({ ...body, updated_at: new Date().toISOString() }).eq("id", gameId).select("*").single();
      if (error) return errorResponse(sanitizeError(error), 400);
      return successResponse({ game: data });
    }

    // POST /admin/games/:id/cancel
    if (gameId && action === "cancel" && req.method === "POST") {
      const { reason } = await req.json().catch(() => ({ reason: "" }));
      const { data: game } = await admin.from("games").select("status, entry_fee").eq("id", gameId).single();
      if (!game) return errorResponse("game_not_found", 404);
      if (["ended", "cancelled"].includes(game.status)) return errorResponse("Game already ended or cancelled", 400);

      await admin.from("games").update({ status: "cancelled", cancelled_reason: reason ?? null, updated_at: new Date().toISOString() }).eq("id", gameId);

      // Refund all participants if they paid entry fee
      if (game.entry_fee && game.entry_fee > 0) {
        const { data: participants } = await admin.from("game_participants").select("user_id").eq("game_id", gameId);
        for (const p of (participants ?? [])) {
          await admin.rpc("credit_wallet", { p_user_id: p.user_id, p_amount_cents: game.entry_fee, p_reference_id: gameId, p_type: "refund" });
        }
      }

      await admin.from("admin_audit_log").insert({ admin_id: user.id, action: "game_cancelled", target_type: "game", target_id: gameId, details: { reason }, created_at: new Date().toISOString() });
      return successResponse({ message: "Game cancelled and entry fees refunded" });
    }

    // POST /admin/games/:id/start
    if (gameId && action === "start" && req.method === "POST") {
      await admin.from("games").update({ status: "live", started_at: new Date().toISOString() }).eq("id", gameId);
      await admin.from("admin_audit_log").insert({ admin_id: user.id, action: "game_started", target_type: "game", target_id: gameId, created_at: new Date().toISOString() });
      return successResponse({ message: "Game started" });
    }

    // POST /admin/games/:id/end
    if (gameId && action === "end" && req.method === "POST") {
      await admin.from("games").update({ status: "ended", ended_at: new Date().toISOString() }).eq("id", gameId);
      // TODO: trigger prize distribution via DB function
      await admin.from("admin_audit_log").insert({ admin_id: user.id, action: "game_ended", target_type: "game", target_id: gameId, created_at: new Date().toISOString() });
      return successResponse({ message: "Game ended" });
    }

    // POST /admin/games/:id/next-question
    if (gameId && action === "next-question" && req.method === "POST") {
      const { data: result, error } = await admin.rpc("advance_game_question", { p_game_id: gameId });
      if (error) return errorResponse(sanitizeError(error), 400);
      return successResponse({ result });
    }

    // GET /admin/games/:id/participants
    if (gameId && action === "participants" && !actionId && req.method === "GET") {
      const { data, error } = await admin.from("game_participants").select("*, profiles!user_id(name, email, avatar_url)").eq("game_id", gameId).order("score", { ascending: false });
      if (error) return errorResponse("Failed to fetch participants", 500);
      return successResponse({ participants: data ?? [] });
    }

    // DELETE /admin/games/:id/participants/:uid
    if (gameId && action === "participants" && actionId && req.method === "DELETE") {
      const { data: p } = await admin.from("game_participants").select("id").eq("game_id", gameId).eq("user_id", actionId).single();
      if (!p) return errorResponse("Participant not found", 404);
      await admin.from("game_participants").delete().eq("id", p.id);
      await admin.from("admin_audit_log").insert({ admin_id: user.id, action: "participant_removed", target_type: "game_participant", target_id: `${gameId}:${actionId}`, created_at: new Date().toISOString() });
      return successResponse({ message: "Participant removed" });
    }

    return errorResponse("Not found", 404);
  } catch (err) {
    console.error("[admin-games] unhandled error:", err);
    return errorResponse("Internal server error", 500);
  }
});
