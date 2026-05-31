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

      // 2. Atomic Redis join (§7 join rules)
      const redis = await getRedis();
      const keys = joinGameKeys(gameId, user.id);
      const now = Date.now().toString();
      const luaResult = await evalScript(redis, JOIN_GAME_SCRIPT, keys,
        [user.id, sessionId, deviceId, now]) as string;
      const joinResult = JSON.parse(luaResult) as {
        status: string; reason?: string; reconnect: boolean;
        userStatus: string; wrongCount: number;
        remainingLives: number | null; correctCount: number;
      };
      if (joinResult.status === "error") {
        return errorResponse(joinResult.reason ?? "join_failed", 400);
      }

      // 3. Upsert game_participants in DB (persistent record — async to game)
      if (!joinResult.reconnect) {
        await admin.from("game_participants").upsert({
          game_id: gameId,
          user_id: user.id,
          role: joinResult.userStatus === "participant" ? "player" : "viewer",
          participant_role: joinResult.userStatus,
          wrong_count: 0,
          lives_remaining: game.allowed_wrong_answers ?? null,
          session_id: sessionId || null,
          device_id: deviceId || null,
          joined_at: new Date().toISOString(),
        }, { onConflict: "game_id,user_id", ignoreDuplicates: false });
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

      // Fetch localized question payload (no correctOptionId — §13.4)
      let questionPayload: Record<string, unknown> | null = null;
      if (gameState.currentQuestionStatus === "active" && gameState.currentQuestionIndex) {
        const qIdx = parseInt(gameState.currentQuestionIndex, 10);
        const qState = await (redis as { hGetAll: (k: string) => Promise<Record<string,string>> })
          .hGetAll(redisKeys.questionState(gameId, qIdx));
        if (qState?.questionId) {
          const { localizedPayload: _, correctOptionId: __, ...safeQState } = qState;
          const lang = new URL(req.url).searchParams.get("lang") ?? "en";
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
