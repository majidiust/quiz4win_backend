/**
 * Games Edge Function — Quiz4Win
 *
 * GET    /games                              — List games (API #27)
 * GET    /games/history                      — My participation history (API #27a)
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
 * Rule compliance: R-01, R-02, R-03, R-04, R-05, R-09
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
    // Single SELECT projection reused by both /games and /games/:id so the
    // GameSummary and GameDetail shapes stay in lock-step (R-06 cohesion).
    // DB columns max_players / total_participants / scheduled_at are aliased
    // to the public-API keys max_participants / participant_count / start_time.
    const GAME_FIELDS =
      "id, title, subtitle, description, mode, status, " +
      "entry_fee, prize_pool, prize_pool_currency, " +
      "category, difficulty, language, " +
      "questions_count, time_per_question, allowed_wrong_answers, " +
      "participant_count:total_participants, max_participants:max_players, " +
      "start_time:scheduled_at, end_time:ended_at, start_buffer_seconds, " +
      "is_featured, ai_cost_microdollars, " +
      "icon, thumbnail_url, poster_url, accent_color, glow_color, gradient_colors, " +
      "sponsor, tags, host_name, host_avatar_url, host_title, rules";

    // GET /games — list available games
    if (!gameId && req.method === "GET") {
      const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1"));
      const limit = Math.min(50, parseInt(url.searchParams.get("limit") ?? "20"));
      const mode = url.searchParams.get("mode");
      // Default surfaces everything a customer could care about on the home
      // screen: games scheduled in the future (upcoming), open for joining
      // (open) and currently running (live). Caller can override with
      // ?status=open or ?status=upcoming|live etc.
      const status = url.searchParams.get("status") ?? "upcoming|open|live";
      const featured = url.searchParams.get("featured");
      const offset = (page - 1) * limit;

      let query = supabase
        .from("games")
        .select(GAME_FIELDS, { count: "exact" })
        .order("scheduled_at", { ascending: true })
        .range(offset, offset + limit - 1);

      if (mode) query = query.eq("mode", mode);
      if (featured === "true") query = query.eq("is_featured", true);
      const statuses = status.split("|");
      if (statuses.length === 1) query = query.eq("status", statuses[0]);
      else query = query.in("status", statuses);

      const { data, error, count } = await query;
      if (error) {
        console.error(`[games] list query failed: ${error.message}`, error);
        return errorResponse("Failed to fetch games", 500);
      }

      // joined_by_me — single batched lookup of the caller's participation
      // rows for the page of games being returned. Avoids N+1 fetches in the
      // UI which would otherwise need a per-card request.
      const rows = data ?? [];
      let joined = new Set<string>();
      if (rows.length > 0) {
        const ids = rows.map((g: { id: string }) => g.id);
        const { data: parts } = await supabase
          .from("game_participants")
          .select("game_id")
          .eq("user_id", user.id)
          .in("game_id", ids);
        joined = new Set((parts ?? []).map((p: { game_id: string }) => p.game_id));
      }
      const games = rows.map((g: { id: string }) => ({ ...g, joined_by_me: joined.has(g.id) }));

      return successResponse({ games, pagination: { page, limit, total: count ?? 0, total_pages: Math.ceil((count ?? 0) / limit) } });
    }

    // GET /games/history — caller's participation history.
    // Route placement matters: `gameId === "history"` is matched here *before*
    // the `/games/:id` detail branch below, otherwise PostgREST would attempt
    // `games.id = 'history'` and 404. The query reads game_participants joined
    // to games and scopes to user.id explicitly — game_participants_select_all
    // is `USING (true)` for the authenticated role, so RLS alone would not
    // restrict; the `.eq("user_id", user.id)` is the authoritative filter (R-01).
    if (gameId === "history" && !action && req.method === "GET") {
      const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1"));
      const limit = Math.min(50, parseInt(url.searchParams.get("limit") ?? "20"));
      const offset = (page - 1) * limit;
      // Filters
      const statusParam = url.searchParams.get("status"); // pipe-delimited set, e.g. "ended|cancelled"
      const result = url.searchParams.get("result"); // won|lost|all (default all)
      const from = url.searchParams.get("from"); // ISO timestamp filter on joined_at
      const to = url.searchParams.get("to");
      // Order: newest participation first by default; `oldest_first=true` flips it.
      const oldestFirst = url.searchParams.get("oldest_first") === "true";

      let query = supabase
        .from("game_participants")
        .select(
          // Top-level participation columns + nested game projection.
          // Nested `games!inner(...)` makes the row-filter on games NOT NULL
          // (a deleted game would drop the participation row from the result).
          "score, rank, correct_answers, wrong_answers, " +
          "entry_fee_paid, prize_amount:prize_earned, " +
          "eliminated, eliminated_at, elimination_reason, " +
          "participant_role, joined_at, completed_at, " +
          `games!inner(${GAME_FIELDS})`,
          { count: "exact" },
        )
        .eq("user_id", user.id)
        .order("joined_at", { ascending: oldestFirst })
        .range(offset, offset + limit - 1);

      if (statusParam) {
        const statuses = statusParam.split("|").filter(Boolean);
        if (statuses.length === 1) query = query.eq("games.status", statuses[0]);
        else if (statuses.length > 1) query = query.in("games.status", statuses);
      }
      if (result === "won") query = query.gt("prize_earned", 0);
      else if (result === "lost") query = query.eq("prize_earned", 0);
      if (from) query = query.gte("joined_at", from);
      if (to) query = query.lte("joined_at", to);

      const { data, error, count } = await query;
      if (error) {
        console.error(`[games] history query failed: ${error.message}`, error);
        return errorResponse("Failed to fetch history", 500);
      }

      // Flatten so each row looks like a GameSummary with a `participation`
      // sub-object — same shape callers already use for /games/:id/result so
      // the UI can render history cards without a second projection.
      type Row = {
        score: number | null;
        rank: number | null;
        correct_answers: number | null;
        wrong_answers: number | null;
        entry_fee_paid: number | null;
        prize_amount: number | null;
        eliminated: boolean | null;
        eliminated_at: string | null;
        elimination_reason: string | null;
        participant_role: string | null;
        joined_at: string;
        completed_at: string | null;
        games: Record<string, unknown> | null;
      };
      const games = ((data ?? []) as Row[])
        .filter((r) => r.games !== null)
        .map((r) => ({
          ...(r.games as Record<string, unknown>),
          joined_by_me: true,
          participation: {
            score: r.score,
            rank: r.rank,
            correct_answers: r.correct_answers,
            wrong_answers: r.wrong_answers,
            entry_fee_paid: r.entry_fee_paid,
            prize_amount: r.prize_amount,
            eliminated: r.eliminated,
            eliminated_at: r.eliminated_at,
            elimination_reason: r.elimination_reason,
            participant_role: r.participant_role,
            joined_at: r.joined_at,
            completed_at: r.completed_at,
          },
        }));

      return successResponse({
        games,
        pagination: {
          page,
          limit,
          total: count ?? 0,
          total_pages: Math.ceil((count ?? 0) / limit),
        },
      });
    }

    // GET /games/:id — game detail (same shape as GameSummary + joined_by_me)
    if (gameId && !action && req.method === "GET") {
      const { data, error } = await supabase
        .from("games")
        .select(GAME_FIELDS)
        .eq("id", gameId)
        .single();
      if (error || !data) return errorResponse("game_not_found", 404);

      // Run both lookups in parallel: caller's participation + live count.
      // The live count from game_participants overrides the potentially stale
      // total_participants column that GAME_FIELDS aliases as participant_count.
      const [{ data: participant }, { count: liveCount }] = await Promise.all([
        supabase
          .from("game_participants")
          .select("id")
          .eq("game_id", gameId)
          .eq("user_id", user.id)
          .maybeSingle(),
        supabase
          .from("game_participants")
          .select("id", { count: "exact", head: true })
          .eq("game_id", gameId),
      ]);

      // Pregame warmup timing for the client countdown. start_buffer_seconds is
      // the per-game warmup; first_question_starts_at projects it onto the
      // scheduled start (start_time = scheduled_at). The orchestrator publishes
      // the authoritative epoch in Redis once the game goes live; this mirrors
      // the same contract for clients reading the detail before join.
      const d = data as Record<string, unknown>;
      const startBufferSeconds = typeof d.start_buffer_seconds === "number" ? d.start_buffer_seconds : 120;
      const startTimeMs = d.start_time ? new Date(d.start_time as string).getTime() : null;

      return successResponse({
        game: {
          ...data,
          participant_count: liveCount ?? 0,
          joined_by_me: !!participant,
          pregame_duration_ms: startBufferSeconds * 1000,
          first_question_starts_at: startTimeMs !== null ? startTimeMs + startBufferSeconds * 1000 : null,
        },
      });
    }

    // POST /games/:id/join — join game (R-09: atomic debit + join)
    if (gameId && action === "join" && req.method === "POST") {
      const { data: game } = await supabase
        .from("games").select("id, status, entry_fee, max_players, total_participants").eq("id", gameId).single();
      if (!game) return errorResponse("game_not_found", 404);
      // Registration gate: status alone (`upcoming` or `open`). The scheduler
      // owns `open` → `live`; until then the game is joinable. DB RPC mirrors.
      if (game.status !== "upcoming" && game.status !== "open") {
        return errorResponse("game_not_open", 400);
      }
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

    // GET /games/:id/result — my result + aggregate game summary.
    // `result`  — per-user row from game_participants (unchanged contract).
    // `summary` — persisted aggregate distribution from games.result_summary;
    //             null if the game has not yet completed/distributed.
    if (gameId && action === "result" && req.method === "GET") {
      const [{ data, error }, { data: gameRow }] = await Promise.all([
        supabase
          .from("game_participants")
          .select("score, rank, prize_amount:prize_earned, correct_answers, wrong_answers, completed_at")
          .eq("game_id", gameId).eq("user_id", user.id).single(),
        supabase
          .from("games")
          .select("result_summary, status, prizes_distributed_at, ended_at")
          .eq("id", gameId).single(),
      ]);
      if (error || !data) return errorResponse("result_not_found", 404);
      return successResponse({
        result: data,
        summary: gameRow?.result_summary ?? null,
        game_status: gameRow?.status ?? null,
        prizes_distributed_at: gameRow?.prizes_distributed_at ?? null,
        ended_at: gameRow?.ended_at ?? null,
      });
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
