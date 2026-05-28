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
 * GET    /admin/games/:id/export               — Export game results CSV (row 125)
 * POST   /admin/games/:id/pause                — Pause game (row 121)
 * POST   /admin/games/:id/resume               — Resume paused game (row 122)
 * POST   /admin/games/:id/duplicate            — Duplicate game (row 123)
 * GET    /admin/games/:id/result               — Final rankings + prize breakdown (row 124)
 * POST   /admin/games/:id/questions            — Assign question set (row 127)
 * POST   /admin/games/:id/asset                — Upload icon/thumbnail/poster/host_avatar to S3
 *
 * Rule compliance: R-01, R-02, R-03, R-05
 */

import { handleCors } from "../_shared/cors.ts";
import { errorResponse, successResponse, sanitizeError } from "../_shared/errors.ts";
import { validateJWT, requireAdminRole } from "../_shared/auth.ts";
import { getAdminClient } from "../_shared/supabase.ts";
import { csvResponse, toCsv, todayStamp } from "../_shared/csv.ts";
import { uploadObject } from "../_shared/s3.ts";

/** Fields on `games` that store a public asset URL and can be uploaded via /asset. */
const ASSET_FIELDS = ["icon", "thumbnail_url", "poster_url", "host_avatar_url"] as const;
type AssetField = typeof ASSET_FIELDS[number];
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/svg+xml"];
const MAX_ASSET_BYTES = 10 * 1024 * 1024; // 10 MB

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

      const { start_time, max_participants, ...rest } = body;
      const { data, error } = await admin.from("games").insert({
        ...rest,
        scheduled_at: start_time,
        max_players: max_participants,
        status: "upcoming",
        questions_count: 0,
        created_by: user.id,
        created_at: new Date().toISOString()
      }).select("*").single();

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
      const { start_time, max_participants, ...rest } = body;
      const updateData: Record<string, any> = { ...rest, updated_at: new Date().toISOString() };
      if (start_time !== undefined) updateData.scheduled_at = start_time;
      if (max_participants !== undefined) updateData.max_players = max_participants;

      const { data, error } = await admin.from("games").update(updateData).eq("id", gameId).select("*").single();
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

    // POST /admin/games/:id/pause — freeze countdown (row 121)
    if (gameId && action === "pause" && req.method === "POST") {
      const { data: game } = await admin.from("games").select("status").eq("id", gameId).single();
      if (!game) return errorResponse("game_not_found", 404);
      if (game.status !== "live") return errorResponse("Only live games can be paused", 400);
      await admin.from("games").update({ status: "paused", paused_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", gameId);
      await admin.from("admin_audit_log").insert({ admin_id: user.id, action: "game_paused", target_type: "game", target_id: gameId, created_at: new Date().toISOString() });
      return successResponse({ message: "Game paused" });
    }

    // POST /admin/games/:id/resume (row 122)
    if (gameId && action === "resume" && req.method === "POST") {
      const { data: game } = await admin.from("games").select("status").eq("id", gameId).single();
      if (!game) return errorResponse("game_not_found", 404);
      if (game.status !== "paused") return errorResponse("Only paused games can be resumed", 400);
      await admin.from("games").update({ status: "live", paused_at: null, updated_at: new Date().toISOString() }).eq("id", gameId);
      await admin.from("admin_audit_log").insert({ admin_id: user.id, action: "game_resumed", target_type: "game", target_id: gameId, created_at: new Date().toISOString() });
      return successResponse({ message: "Game resumed" });
    }

    // POST /admin/games/:id/duplicate — clone settings for new game (row 123)
    if (gameId && action === "duplicate" && req.method === "POST") {
      const { data: src, error } = await admin.from("games").select("*").eq("id", gameId).single();
      if (error || !src) return errorResponse("game_not_found", 404);
      const overrides = await req.json().catch(() => ({}));

      const clone: Record<string, unknown> = { ...src };
      // Strip auto-managed fields
      for (const k of ["id", "created_at", "updated_at", "started_at", "ended_at", "paused_at", "status", "total_participants", "livekit_room_name", "livekit_egress_id", "stream_url", "cancelled_reason"]) delete clone[k];
      Object.assign(clone, overrides);
      clone.status = "upcoming";
      clone.created_by = user.id;
      clone.created_at = new Date().toISOString();
      clone.title = (overrides.title as string) ?? `${src.title} (copy)`;

      const { data: created, error: insErr } = await admin.from("games").insert(clone).select("*").single();
      if (insErr) return errorResponse(sanitizeError(insErr), 400);

      // Copy game_questions if requested
      if (overrides.copy_questions !== false) {
        const { data: qs } = await admin.from("game_questions").select("question_id, order").eq("game_id", gameId);
        if (qs && qs.length) {
          await admin.from("game_questions").insert(qs.map((q: { question_id: string; order: number }) => ({ game_id: created.id, ...q })));
        }
      }

      await admin.from("admin_audit_log").insert({ admin_id: user.id, action: "game_duplicated", target_type: "game", target_id: created.id, details: { source_id: gameId }, created_at: new Date().toISOString() });
      return successResponse({ game: created }, 201);
    }

    // GET /admin/games/:id/result — final rankings + prize breakdown (row 124)
    if (gameId && action === "result" && req.method === "GET") {
      const [gameRes, partsRes, answersRes] = await Promise.all([
        admin.from("games").select("id, title, mode, status, entry_fee, prize_pool, prize_breakdown, participant_count, started_at, ended_at").eq("id", gameId).single(),
        admin.from("game_participants").select("user_id, score, rank, correct_answers, wrong_answers, prize_amount, prize_credited, profiles!user_id(name, email, avatar_url)").eq("game_id", gameId).order("rank", { ascending: true, nullsFirst: false }),
        admin.from("game_questions").select("question_id, question_index, asked_at, questions(text, category, difficulty)").eq("game_id", gameId).order("question_index", { ascending: true }),
      ]);
      if (!gameRes.data) return errorResponse("game_not_found", 404);
      const participants = (partsRes.data ?? []) as Array<{ prize_amount: number | null }>;
      const totalPrizesPaid = participants.reduce((s, p) => s + (p.prize_amount ?? 0), 0);
      return successResponse({
        game: gameRes.data,
        rankings: partsRes.data ?? [],
        questions: answersRes.data ?? [],
        summary: { total_prizes_paid_cents: totalPrizesPaid, prize_pool_cents: gameRes.data.prize_pool ?? 0 },
      });
    }

    // POST /admin/games/:id/questions — assign question set (row 127)
    if (gameId && action === "questions" && req.method === "POST") {
      const { question_ids, replace = true } = await req.json();
      if (!Array.isArray(question_ids) || question_ids.length === 0) return errorResponse("question_ids array is required", 400);

      const { data: game } = await admin.from("games").select("status").eq("id", gameId).single();
      if (!game) return errorResponse("game_not_found", 404);
      if (!["upcoming", "open"].includes(game.status)) return errorResponse("Cannot assign questions after game started", 400);

      if (replace) await admin.from("game_questions").delete().eq("game_id", gameId);
      const rows = (question_ids as string[]).map((qid, i) => ({ game_id: gameId, question_id: qid, order: i }));
      const { error } = await admin.from("game_questions").insert(rows);
      if (error) return errorResponse(sanitizeError(error), 400);
      await admin.from("games").update({ questions_count: question_ids.length, updated_at: new Date().toISOString() }).eq("id", gameId);
      await admin.from("admin_audit_log").insert({ admin_id: user.id, action: "game_questions_assigned", target_type: "game", target_id: gameId, details: { count: question_ids.length, replace }, created_at: new Date().toISOString() });
      return successResponse({ message: `Assigned ${question_ids.length} questions`, count: question_ids.length });
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

    // GET /admin/games/:id/export — CSV (row 125)
    if (gameId && action === "export" && req.method === "GET") {
      const { data, error } = await admin.from("game_participants").select("user_id, score, rank, prize_amount, prize_credited, joined_at, profiles!user_id(name, email)").eq("game_id", gameId).order("rank", { ascending: true, nullsFirst: false });
      if (error) return errorResponse("Failed to export game results", 500);
      type Row = { user_id: string; score: number | null; rank: number | null; prize_amount: number | null; prize_credited: boolean | null; joined_at: string; profiles: { name: string; email: string } | null };
      const rows = (data ?? []) as unknown as Row[];
      const csv = toCsv(rows, [
        { header: "user_id", value: (r) => r.user_id },
        { header: "name", value: (r) => r.profiles?.name ?? null },
        { header: "email", value: (r) => r.profiles?.email ?? null },
        { header: "rank", value: (r) => r.rank },
        { header: "score", value: (r) => r.score },
        { header: "prize_amount_cents", value: (r) => r.prize_amount },
        { header: "prize_credited", value: (r) => r.prize_credited },
        { header: "joined_at", value: (r) => r.joined_at },
      ]);
      await admin.from("admin_audit_log").insert({ admin_id: user.id, action: "game_results_exported", target_type: "game", target_id: gameId, details: { count: rows.length }, created_at: new Date().toISOString() });
      return csvResponse(csv, `game-${gameId}-results-${todayStamp()}.csv`);
    }

    // DELETE /admin/games/:id/participants/:uid
    if (gameId && action === "participants" && actionId && req.method === "DELETE") {
      const { data: p } = await admin.from("game_participants").select("id").eq("game_id", gameId).eq("user_id", actionId).single();
      if (!p) return errorResponse("Participant not found", 404);
      await admin.from("game_participants").delete().eq("id", p.id);
      await admin.from("admin_audit_log").insert({ admin_id: user.id, action: "participant_removed", target_type: "game_participant", target_id: `${gameId}:${actionId}`, created_at: new Date().toISOString() });
      return successResponse({ message: "Participant removed" });
    }

    // POST /admin/games/:id/asset — upload icon/thumbnail/host_avatar to S3
    // (multipart/form-data: `file` + `field`). Mirrors the /profile/avatar flow.
    if (gameId && action === "asset" && req.method === "POST") {
      console.log(`[admin-games][asset] step=1 game=${gameId} admin=${user.id}`);
      const contentType = req.headers.get("content-type") ?? "";
      if (!contentType.includes("multipart/form-data")) {
        return errorResponse("Content-Type must be multipart/form-data", 400);
      }

      let formData: FormData;
      try { formData = await req.formData(); }
      catch (err) {
        console.log("[admin-games][asset] step=2 FAILED formData parse:", err instanceof Error ? err.message : String(err));
        return errorResponse("invalid_multipart", 400);
      }

      const field = String(formData.get("field") ?? "").trim() as AssetField;
      const file = formData.get("file") as File | null;
      if (!ASSET_FIELDS.includes(field)) {
        return errorResponse(`field must be one of: ${ASSET_FIELDS.join(", ")}`, 400);
      }
      if (!file) return errorResponse("file is required", 400);
      if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
        return errorResponse("Only JPEG, PNG, WebP, and SVG are allowed", 400);
      }
      if (file.size > MAX_ASSET_BYTES) return errorResponse("File too large (max 10 MB)", 400);

      const { data: game } = await admin.from("games").select("id").eq("id", gameId).single();
      if (!game) return errorResponse("game_not_found", 404);

      const ext = file.type === "image/svg+xml" ? "svg" : file.type.split("/")[1];
      const key = `games/${gameId}/${field}-${Date.now()}.${ext}`;
      const buf = await file.arrayBuffer();
      console.log(`[admin-games][asset] step=3 uploading key=${key} bytes=${buf.byteLength} type=${file.type}`);

      let publicUrl: string | null;
      try {
        const result = await uploadObject(key, buf, file.type, "public-read");
        publicUrl = result.publicUrl;
      } catch (err) {
        const e = err as { name?: string; message?: string; Code?: string };
        console.log("[admin-games][asset] step=4 FAILED s3:", { name: e?.name, code: e?.Code, message: e?.message });
        return errorResponse(sanitizeError(err), 500);
      }
      if (!publicUrl) return errorResponse("upload_failed", 500);

      const { error: updErr } = await admin
        .from("games")
        .update({ [field]: publicUrl, updated_at: new Date().toISOString() })
        .eq("id", gameId);
      if (updErr) {
        console.log("[admin-games][asset] step=5 FAILED game update:", updErr);
        return errorResponse(sanitizeError(updErr), 500);
      }

      await admin.from("admin_audit_log").insert({ admin_id: user.id, action: "game_asset_uploaded", target_type: "game", target_id: gameId, details: { field, key }, created_at: new Date().toISOString() });
      console.log(`[admin-games][asset] step=6 done field=${field} url=${publicUrl}`);
      return successResponse({ field, url: publicUrl });
    }

    return errorResponse("Not found", 404);
  } catch (err) {
    console.error("[admin-games] unhandled error:", err);
    return errorResponse("Internal server error", 500);
  }
});
