/**
 * Games Edge Function — Quiz4Win
 *
 * GET    /games                              — List games (API #27)
 * GET    /games/:id                          — Game detail (API #28)
 * POST   /games/:id/join                     — Join game (API #29)
 * DELETE /games/:id/join                     — Leave game (API #30)
 * GET    /games/:id/participants             — Participants (API #31)
 * GET    /games/:id/question                 — Current question (API #32)
 * POST   /games/:id/answer                   — Submit answer (API #33)
 * GET    /games/:id/result                   — My result (API #34)
 * POST   /games/:id/claim-prize              — Claim prize (API #35)
 * GET    /games/:id/leaderboard              — Game leaderboard (API #36)
 *
 * Rule compliance: R-01, R-02, R-03, R-05, R-09
 */

import { handleCors } from "../_shared/cors.ts";
import { errorResponse, successResponse, sanitizeError } from "../_shared/errors.ts";
import { validateJWT } from "../_shared/auth.ts";
import { getAnonClient, getAdminClient } from "../_shared/supabase.ts";
import { sendEmail, winTemplate } from "../_shared/email.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleCors();

  const url = new URL(req.url);
  // Path format: /games, /games/:id, /games/:id/action
  const parts = url.pathname.replace(/^\/games\/?/, "").split("/").filter(Boolean);
  const gameId = parts[0] ?? null;
  const action = parts[1] ?? null;

  const { user, error: authErr } = await validateJWT(req);
  if (authErr || !user) return errorResponse("unauthorized", 401);

  const supabase = getAnonClient(req);

  try {
    // GET /games — list available games
    if (!gameId && req.method === "GET") {
      const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1"));
      const limit = Math.min(50, parseInt(url.searchParams.get("limit") ?? "20"));
      const mode = url.searchParams.get("mode");
      const status = url.searchParams.get("status") ?? "open";
      const offset = (page - 1) * limit;

      // Schema: games has max_players, total_participants, scheduled_at,
      // started_at, ended_at. Alias to the public API shape and include the
      // styling fields the customer app needs to render rich game cards.
      let query = supabase
        .from("games")
        .select(
          "id, title, subtitle, description, mode, status, " +
            "entry_fee, prize_pool, category, difficulty, language, " +
            "participant_count:total_participants, max_participants:max_players, " +
            "start_time:scheduled_at, end_time:ended_at, " +
            "icon, thumbnail_url, accent_color, glow_color, gradient_colors, " +
            "sponsor, tags, host_name, host_avatar_url, host_title",
          { count: "exact" },
        )
        .order("scheduled_at", { ascending: true })
        .range(offset, offset + limit - 1);

      if (mode) query = query.eq("mode", mode);
      const statuses = status.split("|");
      if (statuses.length === 1) query = query.eq("status", statuses[0]);
      else query = query.in("status", statuses);

      const { data, error, count } = await query;
      if (error) return errorResponse("Failed to fetch games", 500);
      return successResponse({ games: data ?? [], pagination: { page, limit, total: count ?? 0, total_pages: Math.ceil((count ?? 0) / limit) } });
    }

    // GET /games/:id — game detail
    if (gameId && !action && req.method === "GET") {
      const { data, error } = await supabase
        .from("games")
        .select("*")
        .eq("id", gameId)
        .single();
      if (error || !data) return errorResponse("game_not_found", 404);
      return successResponse({ game: data });
    }

    // POST /games/:id/join — join game (R-09: atomic debit + join)
    if (gameId && action === "join" && req.method === "POST") {
      const { data: game } = await supabase
        .from("games").select("id, status, entry_fee, max_players, total_participants").eq("id", gameId).single();
      if (!game) return errorResponse("game_not_found", 404);
      if (game.status !== "open") return errorResponse("game_not_open", 400);
      if (game.max_players && (game.total_participants ?? 0) >= game.max_players) {
        return errorResponse("game_full", 400);
      }

      // Check not already joined
      const { data: existing } = await supabase.from("game_participants").select("id").eq("game_id", gameId).eq("user_id", user.id).single();
      if (existing) return errorResponse("already_joined", 409);

      // Wallet balance and entry fee are both NUMERIC dollars in schema.
      const { data: profile } = await supabase.from("profiles").select("wallet_balance, kyc_status").eq("id", user.id).single();
      if (Number(profile?.wallet_balance ?? 0) < Number(game.entry_fee ?? 0)) {
        return errorResponse("insufficient_balance", 400);
      }

      // R-09: atomic join via DB function
      const admin = getAdminClient();
      const { error: joinErr } = await admin.rpc("join_game", {
        p_user_id: user.id,
        p_game_id: gameId,
        p_entry_fee_cents: game.entry_fee ?? 0,
      });
      if (joinErr) return errorResponse(sanitizeError(joinErr), 400);
      return successResponse({ message: "Joined game successfully" }, 201);
    }

    // DELETE /games/:id/join — leave game (atomic delete + refund via RPC)
    if (gameId && action === "join" && req.method === "DELETE") {
      const admin = getAdminClient();
      const { error: leaveErr } = await admin.rpc("leave_game", {
        p_user_id: user.id,
        p_game_id: gameId,
      });
      if (leaveErr) return errorResponse(sanitizeError(leaveErr), 400);
      return successResponse({ message: "Left game and entry fee refunded" });
    }

    // GET /games/:id/participants
    if (gameId && action === "participants" && req.method === "GET") {
      const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1"));
      const limit = Math.min(100, parseInt(url.searchParams.get("limit") ?? "50"));
      const offset = (page - 1) * limit;
      const { data, error, count } = await supabase
        .from("game_participants")
        .select("user_id, score, rank, joined_at, profiles(name:full_name, avatar_url)", { count: "exact" })
        .eq("game_id", gameId)
        .order("score", { ascending: false })
        .range(offset, offset + limit - 1);
      if (error) return errorResponse("Failed to fetch participants", 500);
      return successResponse({ participants: data ?? [], pagination: { page, limit, total: count ?? 0 } });
    }

    // GET /games/:id/question — current question for the participant.
    // Schema: game_questions("order"), questions(options), games.time_per_question.
    // The "current" index is derived from how many answers this participant has
    // already submitted (zero-based -> next "order" to ask).
    if (gameId && action === "question" && req.method === "GET") {
      const { data: participant } = await supabase
        .from("game_participants")
        .select("id")
        .eq("game_id", gameId).eq("user_id", user.id).single();
      if (!participant) return errorResponse("not_joined", 403);

      const { count: answeredCount } = await supabase
        .from("game_answers")
        .select("id", { count: "exact", head: true })
        .eq("participant_id", participant.id);

      const nextOrder = answeredCount ?? 0;
      const { data: game } = await supabase
        .from("games").select("time_per_question").eq("id", gameId).single();

      const { data: gq } = await supabase
        .from("game_questions")
        .select("order, questions(id, text, options, category, difficulty)")
        .eq("game_id", gameId)
        .eq("order", nextOrder)
        .maybeSingle();

      if (!gq) return errorResponse("no_active_question", 404);
      return successResponse({
        question: gq,
        time_per_question_sec: game?.time_per_question ?? 15,
      });
    }

    // POST /games/:id/answer — submit answer
    if (gameId && action === "answer" && req.method === "POST") {
      const { question_id, answer, response_time_ms } = await req.json();
      if (!question_id || answer === undefined) return errorResponse("question_id and answer are required", 400);

      const admin = getAdminClient();
      const { data: result, error: ansErr } = await admin.rpc("submit_answer", {
        p_user_id: user.id,
        p_game_id: gameId,
        p_question_id: question_id,
        p_answer: answer,
        p_response_time_ms: response_time_ms ?? 0,
      });
      if (ansErr) return errorResponse(sanitizeError(ansErr), 400);
      return successResponse({ result });
    }

    // GET /games/:id/result — my result. Schema fields: score, rank,
    // prize_earned, correct_answers, wrong_answers, completed_at.
    if (gameId && action === "result" && req.method === "GET") {
      const { data, error } = await supabase
        .from("game_participants")
        .select("score, rank, prize_amount:prize_earned, correct_answers, wrong_answers, completed_at")
        .eq("game_id", gameId).eq("user_id", user.id).single();
      if (error || !data) return errorResponse("result_not_found", 404);
      return successResponse({ result: data });
    }

    // POST /games/:id/claim-prize — manual prize claim fallback.
    // No `prize_credited` column in schema; gate double-claims by looking for an
    // existing prize transaction referencing this game.
    if (gameId && action === "claim-prize" && req.method === "POST") {
      const { data: participant } = await supabase
        .from("game_participants")
        .select("id, prize_earned, rank")
        .eq("game_id", gameId).eq("user_id", user.id).single();
      if (!participant) return errorResponse("not_a_participant", 404);
      const prizeDollars = Number(participant.prize_earned ?? 0);
      if (prizeDollars <= 0) return errorResponse("no_prize_to_claim", 400);

      const admin = getAdminClient();
      const { data: priorTx } = await admin
        .from("transactions")
        .select("id")
        .eq("user_id", user.id)
        .eq("type", "prize")
        .eq("game_id", gameId)
        .limit(1)
        .maybeSingle();
      if (priorTx) return errorResponse("prize_already_credited", 409);

      // Money columns are NUMERIC dollars (see R-02 note in database.types.ts).
      // credit_wallet adds straight to wallet_balance, so we pass dollars too.
      const { error: credErr } = await admin.rpc("credit_wallet", {
        p_user_id: user.id,
        p_amount_cents: prizeDollars,
        p_reference_id: gameId,
        p_type: "prize",
      });
      if (credErr) return errorResponse(sanitizeError(credErr), 400);

      // Fire branded win notification (non-blocking — never fail the claim on email error)
      try {
        const [{ data: profile }, { data: game }] = await Promise.all([
          admin.from("profiles").select("full_name, email").eq("id", user.id).single(),
          admin.from("games").select("title").eq("id", gameId).single(),
        ]);
        if (profile?.email && game?.title) {
          const tpl = winTemplate({
            name: profile.full_name ?? "there",
            gameTitle: game.title,
            rank: participant.rank ?? null,
            prizeAmountCents: Math.round(prizeDollars * 100),
          });
          sendEmail({ to: { email: profile.email, name: profile.full_name ?? undefined }, subject: tpl.subject, html: tpl.html, text: tpl.text })
            .catch((e) => console.error("[games] win email failed:", e));
        }
      } catch (e) {
        console.error("[games] win email lookup failed:", e);
      }

      return successResponse({ message: "Prize credited to wallet", amount: prizeDollars });
    }

    // GET /games/:id/leaderboard
    if (gameId && action === "leaderboard" && req.method === "GET") {
      const limit = Math.min(200, parseInt(url.searchParams.get("limit") ?? "50"));
      const { data, error } = await supabase
        .from("game_participants")
        .select("rank, score, prize_amount:prize_earned, user_id, profiles(name:full_name, avatar_url)")
        .eq("game_id", gameId)
        .order("rank", { ascending: true })
        .limit(limit);
      if (error) return errorResponse("Failed to fetch leaderboard", 500);
      return successResponse({ leaderboard: data ?? [] });
    }

    return errorResponse("Not found", 404);
  } catch (err) {
    console.error("[games] unhandled error:", err);
    return errorResponse("Internal server error", 500);
  }
});
