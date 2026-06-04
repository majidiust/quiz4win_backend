/**
 * Game Session Edge Function — Quiz4Win Real-Time Quiz
 *
 * Architecture: Redis is the source of truth during active games (§2.1).
 * Lua scripts provide atomic validation (§9.3). LiveKit carries broadcast
 * events. RabbitMQ handles async DB persistence (§9.5).
 *
 * Routes:
 *   POST /game-session/:id/join    — Atomic Redis join + DB upsert + LiveKit token
 *   GET  /game-session/:id/state   — Redis HGETALL for current game/user/question state
 *   POST /game-session/:id/answer  — Atomic Redis Lua validation → RabbitMQ persist
 *
 * Game lifecycle (start, advance, close) is managed by the Game Orchestrator
 * service (deploy/game-orchestrator/), NOT by this edge function.
 *
 * Rule compliance: R-01, R-02, R-03, R-05, R-09
 */

import { handleCors } from "../_shared/cors.ts";
import { errorResponse, successResponse, sanitizeError } from "../_shared/errors.ts";
import { validateJWT } from "../_shared/auth.ts";
import { getAdminClient } from "../_shared/supabase.ts";
import { getRedis, evalScript } from "../_shared/redis.ts";
import { redisKeys, joinGameKeys, submitAnswerKeys } from "../_shared/redis_keys.ts";
import { JOIN_GAME_SCRIPT, SUBMIT_ANSWER_SCRIPT } from "../_shared/redis_scripts.ts";
import { signAccessToken } from "../_shared/livekit.ts";
import { publish } from "../_shared/rabbitmq.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handleCors();

  const url = new URL(req.url);
  const parts = url.pathname.replace(/^\/game-session\/?/, "").split("/").filter(Boolean);
  const gameId = parts[0] ?? null;
  const action = parts[1] ?? null;

  const { user, error: authErr } = await validateJWT(req);
  if (authErr || !user) return errorResponse("unauthorized", 401);
  if (!gameId) return errorResponse("game_id_required", 400);

  try {
    // ── POST /game-session/:id/join ─────────────────────────────────────────
    if (action === "join" && req.method === "POST") {
      const body = await safeJson(req);
      const sessionId = typeof body.session_id === "string" ? body.session_id : "";
      const deviceId  = typeof body.device_id  === "string" ? body.device_id  : "";
      const lang      = typeof body.language    === "string" ? body.language   : "en";

      // 1. Fetch game metadata from DB (needed if Redis namespace not yet set)
      const admin = getAdminClient();
      const { data: game, error: gErr } = await admin
        .from("games")
        .select("id, status, livekit_room_name, redis_namespace, title, time_per_question, " +
                "allowed_wrong_answers, grace_period_ms, join_policy, run_mode")
        .eq("id", gameId)
        .single();
      if (gErr || !game) return errorResponse("game_not_found", 404);
      if (!["open", "live"].includes(game.status as string)) {
        return errorResponse("game_not_joinable", 400);
      }

      // 2. Check for ghost-sweep pre-charged state.
      //    If the ghost sweep already charged this player for closed questions
      //    (they paid but never called /game-session/join), pass those DB values
      //    to the Lua script so it only charges the currently-active question (+1)
      //    and avoids double-counting.
      const { data: existingParticipant } = await admin
        .from("game_participants")
        .select("wrong_count, lives_remaining, eliminated")
        .eq("game_id", gameId)
        .eq("user_id", user.id)
        .maybeSingle();
      const preChargedWrong: number = existingParticipant?.wrong_count ?? 0;
      const preChargedLives: number | null = existingParticipant?.lives_remaining ?? null;
      // Track pre-join eliminated status: if already eliminated by ghost sweep,
      // skip LATE_JOIN_RECONCILE (those events are already broadcast).
      const preChargedEliminated: boolean = existingParticipant?.eliminated ?? false;

      // 3. Atomic Redis join (§7 join rules + late-join missed-answer rule).
      //    Read the live currentQuestionIndex first so the Lua script can mark a
      //    surviving late joiner as having "answered" the in-progress question
      //    (already charged as missed) — preventing a double charge / re-attempt.
      const redis = await getRedis();
      const qIdxRaw = await (redis as { hGet: (k: string, f: string) => Promise<string | null> })
        .hGet(redisKeys.gameState(gameId), "currentQuestionIndex");
      const qIdx = qIdxRaw ? parseInt(qIdxRaw, 10) : 0;
      const keys = joinGameKeys(gameId, user.id, qIdx);
      const now = Date.now().toString();
      // ARGV[6]/ARGV[7]: pass pre-charged counts only when ghost sweep ran (wrong_count > 0)
      const preChargedArgv = preChargedWrong > 0
        ? [String(preChargedWrong), preChargedLives !== null ? String(preChargedLives) : ""]
        : ["", ""];
      const luaResult = await evalScript(redis, JOIN_GAME_SCRIPT, keys,
        [user.id, sessionId, deviceId, now, qIdxRaw ?? "", ...preChargedArgv]) as string;
      const joinResult = JSON.parse(luaResult) as {
        status: string; reason?: string; reconnect: boolean;
        userStatus: string; wrongCount: number;
        remainingLives: number | null; correctCount: number;
        eliminated: boolean; eliminationReason: string | null;
        missedQuestions: number;
      };
      if (joinResult.status === "error") {
        return errorResponse(joinResult.reason ?? "join_failed", 400);
      }

      // 3. Upsert game_participants in DB (persistent record — async to game).
      //    Late joiners carry their pre-charged missed answers, reduced lives,
      //    and (when over the limit) the late_join_missed elimination state.
      if (!joinResult.reconnect) {
        await admin.from("game_participants").upsert({
          game_id: gameId,
          user_id: user.id,
          role: joinResult.userStatus === "participant" ? "player" : "viewer",
          participant_role: joinResult.userStatus,
          wrong_count: joinResult.wrongCount,
          lives_remaining: joinResult.remainingLives,
          eliminated: joinResult.eliminated,
          ...(joinResult.eliminated
            ? {
              elimination_reason: joinResult.eliminationReason,
              eliminated_at: new Date().toISOString(),
            }
            : {}),
          session_id: sessionId || null,
          device_id: deviceId || null,
          joined_at: new Date().toISOString(),
        }, { onConflict: "game_id,user_id", ignoreDuplicates: false });

        // 3b. Late-join reconciliation — let the orchestrator (sole LiveKit
        //     broadcaster) tell the room about the pre-charged wrongs or the
        //     on-arrival demotion. Best-effort; never blocks the join response.
        // Only publish when there is a NEW charge (missedQuestions > 0) and the
        // player was NOT already eliminated by a ghost sweep before this join
        // (ghost-sweep events for closed questions are already broadcast).
        if (joinResult.missedQuestions > 0 && !preChargedEliminated) {
          void publish({
            exchange: Deno.env.get("MQ_COMMAND_EXCHANGE") ?? "",
            routingKey: Deno.env.get("MQ_ORCHESTRATOR_QUEUE") ?? "quiz.game.commands",
            payload: {
              type: "LATE_JOIN_RECONCILE",
              gameId,
              userId: user.id,
              wrongCount: joinResult.wrongCount,
              remainingLives: joinResult.remainingLives,
              eliminated: joinResult.eliminated,
              eliminationReason: joinResult.eliminationReason,
              missedQuestions: joinResult.missedQuestions,
              questionIndex: qIdx,
              serverTime: Date.now(),
            },
          });
        }
      } else {
        // On reconnect, just refresh session info
        await admin.from("game_participants")
          .update({ session_id: sessionId || null, device_id: deviceId || null })
          .eq("game_id", gameId).eq("user_id", user.id);
      }

      // 4. Issue LiveKit access token so client can receive broadcasts
      const roomName = (game.livekit_room_name as string | null) ?? `quiz-${gameId}`;
      const livekitToken = await signAccessToken(user.id, roomName, {
        roomJoin: true, canPublish: false, canSubscribe: true, canPublishData: false,
      });

      // 5. Read current question state (safe to expose — no correctOptionId)
      const gameStateRaw = await (redis as { hGetAll: (k: string) => Promise<Record<string,string>> })
        .hGetAll(redisKeys.gameState(gameId));
      const serverNow = Date.now();
      const endsAt = gameStateRaw.currentQuestionEndsAt
        ? parseInt(gameStateRaw.currentQuestionEndsAt, 10) : null;

      return successResponse({
        userStatus: joinResult.userStatus,
        reconnect: joinResult.reconnect,
        wrongCount: joinResult.wrongCount,
        remainingLives: joinResult.remainingLives,
        correctCount: joinResult.correctCount,
        eliminated: joinResult.eliminated,
        eliminationReason: joinResult.eliminationReason,
        missedQuestions: joinResult.missedQuestions,
        gameStatus: gameStateRaw.gameStatus ?? game.status,
        currentQuestionId: gameStateRaw.currentQuestionId ?? null,
        currentQuestionIndex: gameStateRaw.currentQuestionIndex
          ? parseInt(gameStateRaw.currentQuestionIndex, 10) : null,
        questionEndsAt: endsAt,
        remainingTimeMs: endsAt ? Math.max(0, endsAt - serverNow) : null,
        canSubmitAnswer: joinResult.userStatus === "participant",
        serverTime: serverNow,
        livekit: { roomName, token: livekitToken },
        language: lang,
        // Full game state for clients that connect after the one-shot
        // GAME_STARTED — carries the static start fields, live stats, the
        // current question and this user's participant status.
        snapshot: await buildSnapshot(redis as unknown as RedisLike, gameId, user.id, lang),
      });
    }

    // ── GET /game-session/:id/state ──────────────────────────────────────────
    if (action === "state" && req.method === "GET") {
      const redis = await getRedis();
      const gameState = await (redis as { hGetAll: (k: string) => Promise<Record<string,string>> })
        .hGetAll(redisKeys.gameState(gameId));

      if (!gameState?.gameStatus) {
        // Redis not yet initialized — fall back to DB
        const admin = getAdminClient();
        const { data: game } = await admin.from("games")
          .select("id, status, title, scheduled_at").eq("id", gameId).single();
        return successResponse({ source: "db", game, serverTime: Date.now() });
      }

      const userState = await (redis as { hGetAll: (k: string) => Promise<Record<string,string>> })
        .hGetAll(redisKeys.userState(gameId, user.id));

      const lang = new URL(req.url).searchParams.get("lang") ?? "en";

      // Fetch localized question payload (no correctOptionId — §13.4)
      let questionPayload: Record<string, unknown> | null = null;
      if (gameState.currentQuestionStatus === "active" && gameState.currentQuestionIndex) {
        const qIdx = parseInt(gameState.currentQuestionIndex, 10);
        const qState = await (redis as { hGetAll: (k: string) => Promise<Record<string,string>> })
          .hGetAll(redisKeys.questionState(gameId, qIdx));
        if (qState?.questionId) {
          const { localizedPayload: _, correctOptionId: __, ...safeQState } = qState;
          let localized: unknown = null;
          try { localized = qState.localizedPayload ? JSON.parse(qState.localizedPayload) : null; }
          catch { /* ignore */ }
          questionPayload = {
            ...safeQState,
            localized: Array.isArray(localized)
              ? (localized as Array<{language: string}>).find(l => l.language === lang) ?? localized[0]
              : localized,
          };
        }
      }

      const serverNow = Date.now();
      const endsAt = gameState.currentQuestionEndsAt
        ? parseInt(gameState.currentQuestionEndsAt, 10) : null;

      return successResponse({
        source: "redis",
        // Authoritative full snapshot — same contract as POST /join. Prefer this
        // over the flat fields below, which are kept for backward compatibility.
        snapshot: await buildSnapshot(redis as unknown as RedisLike, gameId, user.id, lang),
        gameStatus: gameState.gameStatus,
        gameMode: gameState.gameMode,
        participantCount: gameState.participantCount ? parseInt(gameState.participantCount,10) : 0,
        currentQuestionIndex: gameState.currentQuestionIndex
          ? parseInt(gameState.currentQuestionIndex,10) : null,
        currentQuestionStatus: gameState.currentQuestionStatus ?? null,
        questionEndsAt: endsAt,
        remainingTimeMs: endsAt ? Math.max(0, endsAt - serverNow) : null,
        me: userState?.userStatus ? {
          userStatus: userState.userStatus,
          wrongCount: parseInt(userState.wrongCount ?? "0", 10),
          correctCount: parseInt(userState.correctCount ?? "0", 10),
          remainingLives: userState.remainingLives ? parseInt(userState.remainingLives, 10) : null,
          canSubmitAnswer: userState.userStatus === "participant",
        } : null,
        question: questionPayload,
        serverTime: serverNow,
      });
    }

    // ── POST /game-session/:id/answer ────────────────────────────────────────
    if (action === "answer" && req.method === "POST") {
      const body = await safeJson(req);
      const questionId = body.question_id as string;
      const selectedOptionId = body.selected_option_id as string;
      const attemptId = body.attempt_id as string;
      const responseTimeMs = typeof body.response_time_ms === "number" ? body.response_time_ms : 0;
      const sessionId = typeof body.session_id === "string" ? body.session_id : "";

      if (!questionId || !selectedOptionId || !attemptId) {
        return errorResponse("question_id, selected_option_id and attempt_id are required", 400);
      }

      // 1. Get currentQuestionIndex for the key builders
      const redis = await getRedis();
      const qIdxRaw = await (redis as { hGet: (k:string, f:string) => Promise<string|null> })
        .hGet(redisKeys.gameState(gameId), "currentQuestionIndex");
      const qIdx = qIdxRaw ? parseInt(qIdxRaw, 10) : 0;

      // 2. Atomic Lua validation (§9.3)
      const keys = submitAnswerKeys(gameId, user.id, qIdx, attemptId);
      const serverNow = Date.now();
      const luaResult = await evalScript(redis, SUBMIT_ANSWER_SCRIPT, keys, [
        questionId, selectedOptionId, attemptId,
        serverNow.toString(), responseTimeMs.toString(),
      ]) as string;
      const result = JSON.parse(luaResult) as Record<string, unknown>;

      // 3. Async persistence via RabbitMQ (§9.5) — best-effort
      if (result.status === "accepted") {
        const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
        const ua = req.headers.get("user-agent")?.slice(0, 300) ?? null;
        void publish({
          exchange: Deno.env.get("MQ_COMMAND_EXCHANGE") ?? "",
          routingKey: Deno.env.get("MQ_ORCHESTRATOR_QUEUE") ?? "quiz.game.commands",
          payload: {
            type: "ANSWER_PERSIST_REQUESTED",
            gameId, userId: user.id, questionId, questionIndex: qIdx,
            selectedOptionId, attemptId, sessionId,
            isCorrect: result.isCorrect,
            pointsEarned: result.pointsEarned,
            wrongCount: result.wrongCount,
            remainingLives: result.remainingLives,
            participantRole: result.participantRole,
            eliminated: result.eliminated,
            eliminationReason: result.eliminationReason,
            startsAt: result.startsAt,
            endsAt: result.endsAt,
            serverReceivedAt: serverNow,
            responseTimeMs,
            ipAddress: ip,
            userAgent: ua,
          },
        });
      }

      return successResponse({ result });
    }

    return errorResponse("not_found", 404);
  } catch (err) {
    return errorResponse(sanitizeError(err), 500);
  }
});

async function safeJson(req: Request): Promise<Record<string, unknown>> {
  try { return await req.json() as Record<string, unknown>; } catch { return {}; }
}

type RedisLike = { hGetAll: (k: string) => Promise<Record<string, string>> };

/**
 * Assemble a complete, client-safe game snapshot from Redis. Returned by both
 * POST /join and GET /state so a client that connects AFTER the one-shot
 * GAME_STARTED (or a reconnecting client) can reconstruct the full game state:
 * the static start fields (languages, category, title, prize pool, warmup
 * timing) + live stats + the current question + its own participant status.
 * Never includes correctOptionId (§13.4). Returns null when Redis has no game
 * hash yet (caller falls back to the DB).
 */
async function buildSnapshot(
  redis: RedisLike,
  gameId: string,
  userId: string,
  lang: string,
): Promise<Record<string, unknown> | null> {
  const gs = await redis.hGetAll(redisKeys.gameState(gameId));
  if (!gs?.gameStatus) return null;

  const intOr = (v: string | undefined, d = 0) =>
    v != null && v !== "" ? parseInt(v, 10) : d;
  const participantCount = intOr(gs.participantCount);
  const eliminatedCount  = intOr(gs.eliminatedUserCount);
  const spectatorCount   = intOr(gs.spectatorCount);
  const activeSurvivorCount = Math.max(0, participantCount - eliminatedCount);

  // prizePool is the raw NUMERIC(12,2) dollar string. The projection mirrors
  // the orchestrator's QUESTION_CLOSED rule: null when no pool is configured,
  // 0 when a pool exists but no survivors remain, else pool / survivors.
  const prizePool = gs.prizePool != null && gs.prizePool !== ""
    ? Number(gs.prizePool) : null;
  const projectedPrizePerSurvivor = prizePool === null
    ? null
    : activeSurvivorCount > 0
      ? Math.round((prizePool / activeSurvivorCount) * 100) / 100
      : 0;

  let languages: string[] = [];
  try { languages = gs.languages ? JSON.parse(gs.languages) as string[] : []; }
  catch { languages = []; }

  const serverNow = Date.now();
  const endsAt = gs.currentQuestionEndsAt ? parseInt(gs.currentQuestionEndsAt, 10) : null;

  // Current question — exposed only while active, never carrying correctOptionId.
  let currentQuestion: Record<string, unknown> | null = null;
  if (gs.currentQuestionStatus === "active" && gs.currentQuestionIndex) {
    const qIdx = parseInt(gs.currentQuestionIndex, 10);
    const qState = await redis.hGetAll(redisKeys.questionState(gameId, qIdx));
    if (qState?.questionId) {
      const { localizedPayload: _lp, correctOptionId: _co, ...safeQState } = qState;
      let localizedAll: unknown = null;
      try { localizedAll = qState.localizedPayload ? JSON.parse(qState.localizedPayload) : null; }
      catch { /* ignore */ }
      currentQuestion = {
        ...safeQState,
        questionIndex: qIdx,
        status: gs.currentQuestionStatus,
        endsAt,
        remainingTimeMs: endsAt ? Math.max(0, endsAt - serverNow) : null,
        localized: Array.isArray(localizedAll)
          ? (localizedAll as Array<{ language: string }>).find(l => l.language === lang) ?? localizedAll[0]
          : localizedAll,
      };
    }
  }

  const us = await redis.hGetAll(redisKeys.userState(gameId, userId));
  const me = us?.userStatus ? {
    userStatus: us.userStatus,
    wrongCount: intOr(us.wrongCount),
    correctCount: intOr(us.correctCount),
    remainingLives: us.remainingLives ? parseInt(us.remainingLives, 10) : null,
    eliminated: us.userStatus === "eliminated" || us.eliminationReason != null,
    eliminationReason: us.eliminationReason ?? null,
    canSubmitAnswer: us.userStatus === "participant",
  } : null;

  return {
    game: {
      gameId,
      gameStatus: gs.gameStatus,
      runMode: gs.gameMode ?? "auto",
      category: gs.category ?? null,
      languages,
      questionsCount: gs.questionsCount ? parseInt(gs.questionsCount, 10) : null,
      title: gs.title ?? null,
      prizePool,
      prizePoolCurrency: gs.prizePoolCurrency ?? null,
      projectedPrizePerSurvivor,
      pregameDurationMs: gs.pregameDurationMs ? parseInt(gs.pregameDurationMs, 10) : null,
      firstQuestionStartsAt: gs.firstQuestionStartsAt ? parseInt(gs.firstQuestionStartsAt, 10) : null,
    },
    stats: { participantCount, spectatorCount, eliminatedCount, activeSurvivorCount },
    currentQuestion,
    me,
    serverTime: serverNow,
  };
}
