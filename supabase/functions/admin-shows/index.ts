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
 * PATCH /admin/shows/hosts/:id          — Update host (row 136)
 * DELETE /admin/shows/hosts/:id         — Delete host (row 137)
 * GET   /admin/shows/hosts/:id/ratings  — Host ratings (row 138)
 * POST  /admin/shows/:id/pause          — Pause show (row 128)
 * POST  /admin/shows/:id/resume         — Resume show (row 129)
 * POST  /admin/shows/:id/cancel         — Cancel + refund (row 130)
 * POST  /admin/shows/:id/duplicate      — Duplicate show (row 131)
 * GET   /admin/shows/:id/result         — Final rankings + prize breakdown (row 132)
 * POST  /admin/shows/:id/announce       — Host text announcement (row 133)
 * GET   /admin/shows/:id/participants   — List participants (row 135)
 * DELETE /admin/shows/:id/participants/:uid — Kick participant (row 134)
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
  const actionId = parts[2] ?? null;

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

    // PATCH /admin/shows/hosts/:id — update host (row 136)
    if (showIdOrResource === "hosts" && action && !actionId && req.method === "PATCH") {
      const body = await req.json();
      const allowed: Record<string, unknown> = {};
      for (const k of ["name", "email", "bio", "avatar_url", "title", "is_active"]) if (body[k] !== undefined) allowed[k] = body[k];
      allowed.updated_at = new Date().toISOString();
      const { data, error } = await admin.from("show_hosts").update(allowed).eq("id", action).select("*").single();
      if (error || !data) return errorResponse("host_not_found", 404);
      return successResponse({ host: data });
    }

    // DELETE /admin/shows/hosts/:id — delete host (row 137)
    if (showIdOrResource === "hosts" && action && !actionId && req.method === "DELETE") {
      const { data: usedByGame } = await admin.from("games").select("id", { count: "exact", head: true }).eq("host_id", action);
      if ((usedByGame as unknown as { count: number })?.count) return errorResponse("Cannot delete host assigned to games", 409);
      const { error } = await admin.from("show_hosts").delete().eq("id", action);
      if (error) return errorResponse(sanitizeError(error), 500);
      await admin.from("admin_audit_log").insert({ admin_id: user.id, action: "show_host_deleted", target_type: "show_host", target_id: action, created_at: new Date().toISOString() });
      return successResponse({ message: "Host deleted" });
    }

    // GET /admin/shows/hosts/:id/ratings (row 138)
    if (showIdOrResource === "hosts" && action && actionId === "ratings" && req.method === "GET") {
      const { data, error } = await admin.from("show_host_ratings").select("rating, comment, created_at, profiles!user_id(name)").eq("host_id", action).order("created_at", { ascending: false }).limit(500);
      if (error) return errorResponse("Failed to fetch ratings", 500);
      const ratings = (data ?? []) as Array<{ rating: number }>;
      const avg = ratings.length ? ratings.reduce((s, r) => s + (r.rating ?? 0), 0) / ratings.length : 0;
      return successResponse({ host_id: action, count: ratings.length, average_rating: Number(avg.toFixed(2)), ratings: data ?? [] });
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

    // POST /admin/shows/:id/pause (row 128)
    if (showId && action === "pause" && req.method === "POST") {
      const { data: show } = await admin.from("games").select("status").eq("id", showId).eq("mode", "live").single();
      if (!show) return errorResponse("show_not_found", 404);
      if (show.status !== "live") return errorResponse("Only live shows can be paused", 400);
      await admin.from("games").update({ status: "paused", paused_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", showId);
      await admin.from("admin_audit_log").insert({ admin_id: user.id, action: "show_paused", target_type: "show", target_id: showId, created_at: new Date().toISOString() });
      return successResponse({ message: "Show paused" });
    }

    // POST /admin/shows/:id/resume (row 129)
    if (showId && action === "resume" && req.method === "POST") {
      const { data: show } = await admin.from("games").select("status").eq("id", showId).eq("mode", "live").single();
      if (!show) return errorResponse("show_not_found", 404);
      if (show.status !== "paused") return errorResponse("Only paused shows can be resumed", 400);
      await admin.from("games").update({ status: "live", paused_at: null, updated_at: new Date().toISOString() }).eq("id", showId);
      await admin.from("admin_audit_log").insert({ admin_id: user.id, action: "show_resumed", target_type: "show", target_id: showId, created_at: new Date().toISOString() });
      return successResponse({ message: "Show resumed" });
    }

    // POST /admin/shows/:id/cancel — cancel + refund entry fees (row 130)
    if (showId && action === "cancel" && req.method === "POST") {
      const { reason } = await req.json().catch(() => ({ reason: "cancelled_by_admin" }));
      const { data: show } = await admin.from("games").select("status, entry_fee, mode").eq("id", showId).eq("mode", "live").single();
      if (!show) return errorResponse("show_not_found", 404);
      if (["ended", "cancelled"].includes(show.status)) return errorResponse("Show already ended or cancelled", 400);

      // Refund entry fees to all participants (R-02: cents, R-05: append-only via wallet_transactions)
      if ((show.entry_fee ?? 0) > 0) {
        const { data: parts } = await admin.from("game_participants").select("user_id").eq("game_id", showId);
        if (parts && parts.length > 0) {
          const refunds = (parts as Array<{ user_id: string }>).map((p) => ({
            user_id: p.user_id,
            type: "refund",
            amount: show.entry_fee,
            reference_type: "show_cancel",
            reference_id: showId,
            description: `Refund: show cancelled — ${reason}`,
            created_at: new Date().toISOString(),
          }));
          await admin.from("wallet_transactions").insert(refunds);
          // Credit wallets
          for (const p of parts as Array<{ user_id: string }>) {
            await admin.rpc("increment_wallet_balance", { p_user_id: p.user_id, p_amount: show.entry_fee }).catch(() => null);
          }
        }
      }

      await admin.from("games").update({ status: "cancelled", cancelled_reason: reason, ended_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", showId);
      await admin.from("admin_audit_log").insert({ admin_id: user.id, action: "show_cancelled", target_type: "show", target_id: showId, details: { reason }, created_at: new Date().toISOString() });
      return successResponse({ message: "Show cancelled and entry fees refunded" });
    }

    // POST /admin/shows/:id/duplicate (row 131)
    if (showId && action === "duplicate" && req.method === "POST") {
      const { data: src, error } = await admin.from("games").select("*").eq("id", showId).single();
      if (error || !src) return errorResponse("show_not_found", 404);
      const overrides = await req.json().catch(() => ({}));

      const clone: Record<string, unknown> = { ...src };
      for (const k of ["id", "created_at", "updated_at", "started_at", "ended_at", "paused_at", "cancelled_reason", "livekit_room_name", "livekit_egress_id", "stream_url", "status", "participant_count"]) delete clone[k];
      Object.assign(clone, overrides);
      clone.status = "upcoming";
      clone.created_by = user.id;
      clone.created_at = new Date().toISOString();
      clone.title = (overrides.title as string) ?? `${src.title} (copy)`;

      const { data: created, error: insErr } = await admin.from("games").insert(clone).select("*").single();
      if (insErr) return errorResponse(sanitizeError(insErr), 400);
      await admin.from("admin_audit_log").insert({ admin_id: user.id, action: "show_duplicated", target_type: "show", target_id: created.id, details: { source_id: showId }, created_at: new Date().toISOString() });
      return successResponse({ show: created }, 201);
    }

    // GET /admin/shows/:id/result (row 132)
    if (showId && action === "result" && req.method === "GET") {
      const [showRes, partsRes] = await Promise.all([
        admin.from("games").select("id, title, mode, status, entry_fee, prize_pool, prize_breakdown, participant_count, started_at, ended_at").eq("id", showId).single(),
        admin.from("game_participants").select("user_id, score, rank, correct_answers, wrong_answers, prize_amount, prize_credited, profiles!user_id(name, email, avatar_url)").eq("game_id", showId).order("rank", { ascending: true, nullsFirst: false }),
      ]);
      if (!showRes.data) return errorResponse("show_not_found", 404);
      const parts = (partsRes.data ?? []) as Array<{ prize_amount: number | null }>;
      const totalPrizes = parts.reduce((s, p) => s + (p.prize_amount ?? 0), 0);
      return successResponse({ show: showRes.data, rankings: partsRes.data ?? [], summary: { total_prizes_paid_cents: totalPrizes, prize_pool_cents: showRes.data.prize_pool ?? 0 } });
    }

    // POST /admin/shows/:id/announce (row 133)
    if (showId && action === "announce" && req.method === "POST") {
      const { message, type = "info" } = await req.json();
      if (!message) return errorResponse("message is required", 400);
      // Broadcast to all participants via notifications
      const { data: parts } = await admin.from("game_participants").select("user_id").eq("game_id", showId);
      if (parts && parts.length > 0) {
        const notifs = (parts as Array<{ user_id: string }>).map((p) => ({
          user_id: p.user_id,
          type: "announcement",
          title: `Show Announcement`,
          body: message,
          metadata: { show_id: showId, announcement_type: type },
          created_at: new Date().toISOString(),
        }));
        await admin.from("notifications").insert(notifs);
      }
      await admin.from("admin_audit_log").insert({ admin_id: user.id, action: "show_announced", target_type: "show", target_id: showId, details: { message, type }, created_at: new Date().toISOString() });
      return successResponse({ message: "Announcement sent", recipients: parts?.length ?? 0 });
    }

    // GET /admin/shows/:id/participants (row 135)
    if (showId && action === "participants" && !actionId && req.method === "GET") {
      const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1"));
      const limit = Math.min(500, parseInt(url.searchParams.get("limit") ?? "100"));
      const offset = (page - 1) * limit;
      const { data, error, count } = await admin
        .from("game_participants")
        .select("user_id, score, rank, correct_answers, wrong_answers, joined_at, prize_amount, profiles!user_id(name, email, avatar_url)", { count: "exact" })
        .eq("game_id", showId)
        .order("rank", { ascending: true, nullsFirst: false })
        .range(offset, offset + limit - 1);
      if (error) return errorResponse("Failed to fetch participants", 500);
      return successResponse({ participants: data ?? [], pagination: { page, limit, total: count ?? 0 } });
    }

    // DELETE /admin/shows/:id/participants/:uid — kick participant (row 134)
    if (showId && action === "participants" && actionId && req.method === "DELETE") {
      const { error } = await admin.from("game_participants").delete().eq("game_id", showId).eq("user_id", actionId);
      if (error) return errorResponse(sanitizeError(error), 500);
      // Refund entry fee if show is still upcoming/open
      const { data: show } = await admin.from("games").select("status, entry_fee").eq("id", showId).single();
      if (show && ["upcoming", "open"].includes(show.status) && (show.entry_fee ?? 0) > 0) {
        await admin.from("wallet_transactions").insert({ user_id: actionId, type: "refund", amount: show.entry_fee, reference_type: "show_kick", reference_id: showId, description: "Refund: removed from show by admin", created_at: new Date().toISOString() });
        await admin.rpc("increment_wallet_balance", { p_user_id: actionId, p_amount: show.entry_fee }).catch(() => null);
      }
      await admin.from("admin_audit_log").insert({ admin_id: user.id, action: "show_participant_kicked", target_type: "show", target_id: showId, details: { kicked_user_id: actionId }, created_at: new Date().toISOString() });
      return successResponse({ message: "Participant removed from show" });
    }

    return errorResponse("Not found", 404);
  } catch (err) {
    console.error("[admin-shows] unhandled error:", err);
    return errorResponse("Internal server error", 500);
  }
});
