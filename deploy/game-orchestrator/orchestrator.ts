/**
 * Quiz4Win — Game Orchestrator
 *
 * The main brain of each quiz session (§3.2).
 *
 * Responsibilities:
 *  • Consumes game-lifecycle commands from RabbitMQ (AMQP).
 *  • Initialises Redis game state on StartGame.
 *  • Pre-generates questions via OpenAI (§5.7 — ahead of need).
 *  • Writes questions to Redis atomically before broadcasting (§8.2).
 *  • Broadcasts events to clients via LiveKit DataChannel (§3.5).
 *  • Closes questions after the configured time window (§10.2).
 *  • Persists answers and final results to Postgres (§9.5, §3.8).
 *  • Recovers running games after restart (§15.2).
 *
 * Env vars (never logged — R-01):
 *   REDIS_URL                  — redis://:pass@host:6379
 *   RABBITMQ_URL               — amqps://user:pass@host/vhost
 *   MQ_ORCHESTRATOR_QUEUE      — quiz.game.commands (default)
 *   SUPABASE_URL               — Supabase REST base URL
 *   SUPABASE_SERVICE_ROLE_KEY  — service-role JWT for DB writes
 *   OPENAI_API_KEY             — for question generation
 *   OPENAI_MODEL               — gpt-4o-mini (default)
 *   LIVEKIT_SERVER_URL         — wss://…livekit.cloud
 *   LIVEKIT_API_KEY / LIVEKIT_API_SECRET
 */

// deno-lint-ignore-file no-explicit-any

// deno.land/x/amqp uses Deno.connectTls (native rustls) — no Node-compat
// layer. The broken jsr:@std/io BufReader export is pinned to 0.224.9 via
// the deno.json import map in this directory.
import { connect } from "https://deno.land/x/amqp@v0.24.0/mod.ts";
import { createClient } from "npm:redis@4";

// ─── Config ──────────────────────────────────────────────────────────────────

const REDIS_URL    = Deno.env.get("REDIS_URL") ?? "redis://127.0.0.1:6379";
const RABBITMQ_URL = Deno.env.get("RABBITMQ_URL") ?? "";
const MQ_QUEUE     = Deno.env.get("MQ_ORCHESTRATOR_QUEUE") ?? "quiz.game.commands";
const SUPABASE_URL    = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY     = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const OPENAI_KEY      = Deno.env.get("OPENAI_API_KEY") ?? "";
const OPENAI_MODEL    = Deno.env.get("OPENAI_MODEL") ?? "gpt-4o-mini";
const LK_URL          = Deno.env.get("LIVEKIT_SERVER_URL") ?? "";
const LK_KEY          = Deno.env.get("LIVEKIT_API_KEY") ?? "";
const LK_SECRET       = Deno.env.get("LIVEKIT_API_SECRET") ?? "";
// Debug log forwarding — toggled via DEBUG_LOG_MQ (restart required to apply)
const DEBUG_LOG_MQ    = Deno.env.get("DEBUG_LOG_MQ") === "true";
const DEBUG_LOG_QUEUE = Deno.env.get("DEBUG_LOG_QUEUE") ?? "quiz4win.debug.logs";
// No-duplicate-question invariant: a question may not be re-asked across the
// platform until this cooldown elapses (default 7 days). Enforced via the
// claim_question RPC; the orchestrator re-rolls a fresh question on collision.
const QUESTION_REASK_COOLDOWN_SECONDS =
  Number(Deno.env.get("QUESTION_REASK_COOLDOWN_SECONDS") ?? "604800") || 604800;
// Max re-generation attempts before accepting a question to avoid stalling.
const QUESTION_DEDUP_MAX_RETRIES =
  Number(Deno.env.get("QUESTION_DEDUP_MAX_RETRIES") ?? "5") || 5;
// Pregame warmup window: time between GAME_STARTED and the first
// QUESTION_STARTED broadcast for auto-mode games. Used by clients to render
// the "Get ready! The first question is being generated…" countdown screen.
// The orchestrator also pre-generates the first batch of questions during this
// window so OpenAI latency is hidden behind the visible countdown.
const PREGAME_WARMUP_MS =
  Number(Deno.env.get("PREGAME_WARMUP_MS") ?? "120000") || 120000;
// The complete set of languages the platform supports. Every game's
// target_languages is a subset of this; the primary language is always one of
// them. Kept in sync with the DB CHECK constraints and the Language type.
const SUPPORTED_LANGUAGES = ["en", "ar", "fa", "tr"] as const;

if (!RABBITMQ_URL) { console.error("[orchestrator] FATAL: RABBITMQ_URL required"); Deno.exit(1); }
if (!SUPABASE_URL || !SERVICE_KEY) { console.error("[orchestrator] FATAL: SUPABASE_* required"); Deno.exit(1); }

// ─── Debug log forwarder ──────────────────────────────────────────────────────
// When DEBUG_LOG_MQ=true every console.log/warn/error is also published to
// the RabbitMQ debug queue as structured JSON (fire-and-forget, never throws).
// Toggle: set DEBUG_LOG_MQ=true in .env and restart the container.
if (DEBUG_LOG_MQ && RABBITMQ_URL) {
  ((): void => {
    const raw = RABBITMQ_URL;
    let scheme: string, norm: string;
    if (raw.startsWith("amqps://"))      { scheme = "https"; norm = "https://" + raw.slice(8); }
    else if (raw.startsWith("amqp://")) { scheme = "http";  norm = "http://"  + raw.slice(7); }
    else return;
    let base: string, auth: string, vhostEnc: string;
    try {
      const u = new URL(norm);
      const vhost = u.pathname && u.pathname !== "/" ? decodeURIComponent(u.pathname.slice(1)) : "/";
      base      = `${scheme}://${u.hostname}`;
      auth      = "Basic " + btoa(`${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}`);
      vhostEnc  = encodeURIComponent(vhost);
    } catch { return; }

    const pub = (msg: string, lvl: string): void => {
      void fetch(`${base}/api/exchanges/${vhostEnc}//publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": auth },
        body: JSON.stringify({
          properties: { content_type: "application/json" },
          routing_key: DEBUG_LOG_QUEUE,
          payload: JSON.stringify({ ts: new Date().toISOString(), svc: "orchestrator", lvl, msg }),
          payload_encoding: "string",
        }),
      }).catch(() => {});
    };

    const _log   = console.log.bind(console);
    const _warn  = console.warn.bind(console);
    const _error = console.error.bind(console);
    console.log   = (...a: unknown[]) => { _log(...a);   pub(a.map(String).join(" "), "info");  };
    console.warn  = (...a: unknown[]) => { _warn(...a);  pub(a.map(String).join(" "), "warn");  };
    console.error = (...a: unknown[]) => { _error(...a); pub(a.map(String).join(" "), "error"); };

    _log(`[orchestrator] debug-log forwarding ENABLED → queue=${DEBUG_LOG_QUEUE}`);
  })();
}

// ─── Redis key namespace (mirrors supabase/functions/_shared/redis_keys.ts) ──

const NS = "q4w";
const K = {
  game:      (id: string)              => `${NS}:game:${id}:state`,
  q:         (id: string, i: number)   => `${NS}:game:${id}:q:${i}:state`,
  user:      (id: string, u: string)   => `${NS}:game:${id}:u:${u}:state`,
  parts:     (id: string)              => `${NS}:game:${id}:participants`,
  specs:     (id: string)              => `${NS}:game:${id}:spectators`,
  qAnswered: (id: string, i: number)   => `${NS}:game:${id}:q:${i}:answered`,
  /** Staging area for presenter mode — one prepared (not-yet-active) question per game. */
  staged:    (id: string)              => `${NS}:game:${id}:q:staged`,
};

// ─── Lua scripts (mirrors supabase/functions/_shared/redis_scripts.ts) ───────

const PREPARE_Q_SCRIPT = `
redis.call("HSET",KEYS[2],"questionId",ARGV[1],"questionIndex",ARGV[2],"status","active",
  "correctOptionId",ARGV[3],"startsAt",ARGV[4],"endsAt",ARGV[5],"gracePeriodMs",ARGV[6],
  "localizedPayload",ARGV[7])
redis.call("EXPIRE",KEYS[2],86400)
redis.call("HSET",KEYS[1],"currentQuestionId",ARGV[1],"currentQuestionIndex",ARGV[2],
  "currentQuestionStatus","active","currentQuestionStartsAt",ARGV[4],
  "currentQuestionEndsAt",ARGV[5],"currentQuestionCorrectOptionId",ARGV[3])
return cjson.encode({status="ok",questionId=ARGV[1],questionIndex=tonumber(ARGV[2]),
  startsAt=tonumber(ARGV[4]),endsAt=tonumber(ARGV[5])})
`;

const CLOSE_Q_SCRIPT = `
local curStatus=redis.call("HGET",KEYS[1],"currentQuestionStatus")
if curStatus~="active" then return cjson.encode({status="error",reason="not_active"}) end
redis.call("HSET",KEYS[1],"currentQuestionStatus","closed")
redis.call("HSET",KEYS[2],"status","closed","closedAt",ARGV[1])
local notAnswered=redis.call("SDIFF",KEYS[3],KEYS[4])
local qId=redis.call("HGET",KEYS[1],"currentQuestionId")
local qIdx=redis.call("HGET",KEYS[1],"currentQuestionIndex")
return cjson.encode({status="ok",questionId=qId,questionIndex=tonumber(qIdx) or 0,
  notAnswered=notAnswered,closedAt=tonumber(ARGV[1])})
`;

// ─── STAGE_Q (presenter mode §8.1 — two-phase: prepared → active) ────────────
// KEYS[1] = staged hash  (q4w:game:{id}:q:staged)
// ARGV[1] = questionId          ARGV[5] = canonicalText
// ARGV[2] = questionIndex       ARGV[6] = optionsJson
// ARGV[3] = correctOptionId     ARGV[7] = explanation
// ARGV[4] = localizedJson       ARGV[8] = estimatedAnswerTimeSec
// Prevents double-staging (idempotency guard).
const STAGE_Q_SCRIPT = `
local existing = redis.call("HGET", KEYS[1], "status")
if existing == "prepared" then
  return cjson.encode({status="error",reason="question_already_staged"})
end
redis.call("HSET", KEYS[1],
  "questionId",           ARGV[1],
  "questionIndex",        ARGV[2],
  "status",               "prepared",
  "correctOptionId",      ARGV[3],
  "localizedPayload",     ARGV[4],
  "canonicalText",        ARGV[5],
  "optionsJson",          ARGV[6],
  "explanation",          ARGV[7],
  "estimatedAnswerTimeSec", ARGV[8])
redis.call("EXPIRE", KEYS[1], 3600)
return cjson.encode({status="ok", questionId=ARGV[1], questionIndex=tonumber(ARGV[2])})
`;

// ─── ACTIVATE_Q (presenter mode — promotes staged → active) ──────────────────
// KEYS[1] = gameState hash
// KEYS[2] = staged hash   (q4w:game:{id}:q:staged)
// KEYS[3] = question hash (q4w:game:{id}:q:{idx}:state)
// ARGV[1] = startsAt (epoch ms)
// ARGV[2] = endsAt   (epoch ms)
// ARGV[3] = gracePeriodMs
// Reads staged data, writes to question+game state, then deletes staged hash.
const ACTIVATE_Q_SCRIPT = `
local stagId = redis.call("HGET", KEYS[2], "questionId")
if not stagId then
  return cjson.encode({status="error",reason="no_staged_question"})
end
local stagIdx   = redis.call("HGET", KEYS[2], "questionIndex")
local correctOpt= redis.call("HGET", KEYS[2], "correctOptionId")
local locPay    = redis.call("HGET", KEYS[2], "localizedPayload")
redis.call("HSET", KEYS[3],
  "questionId",       stagId,
  "questionIndex",    stagIdx,
  "status",           "active",
  "correctOptionId",  correctOpt,
  "startsAt",         ARGV[1],
  "endsAt",           ARGV[2],
  "gracePeriodMs",    ARGV[3],
  "localizedPayload", locPay)
redis.call("EXPIRE", KEYS[3], 86400)
redis.call("HSET", KEYS[1],
  "currentQuestionId",            stagId,
  "currentQuestionIndex",         stagIdx,
  "currentQuestionStatus",        "active",
  "currentQuestionStartsAt",      ARGV[1],
  "currentQuestionEndsAt",        ARGV[2],
  "currentQuestionCorrectOptionId", correctOpt)
redis.call("DEL", KEYS[2])
return cjson.encode({status="ok", questionId=stagId,
  questionIndex=tonumber(stagIdx), startsAt=tonumber(ARGV[1]), endsAt=tonumber(ARGV[2])})
`;

// ─── Redis client ─────────────────────────────────────────────────────────────

let redis: any;
async function getRedis() {
  if (redis?.isReady) return redis;
  redis = createClient({ url: REDIS_URL });
  redis.on("error", (e: Error) => console.error("[redis]", e.message));
  await redis.connect();
  return redis;
}

async function evalLua(script: string, keys: string[], args: string[]): Promise<any> {
  const r = await getRedis();
  return r.eval(script, { keys, arguments: args });
}

// ─── Supabase REST helper ─────────────────────────────────────────────────────

async function dbInsert(table: string, row: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/${table}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": SERVICE_KEY,
      "Authorization": `Bearer ${SERVICE_KEY}`,
      "Prefer": "return=minimal",
    },
    body: JSON.stringify(row),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    console.error(`[db] INSERT ${table} failed ${res.status}: ${txt.slice(0, 300)}`);
  }
}

async function dbUpdate(table: string, match: Record<string,string>, patch: Record<string,unknown>): Promise<void> {
  const qs = Object.entries(match).map(([k,v]) => `${k}=eq.${v}`).join("&");
  const res = await fetch(`${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/${table}?${qs}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "apikey": SERVICE_KEY,
      "Authorization": `Bearer ${SERVICE_KEY}`,
      "Prefer": "return=minimal",
    },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    console.error(`[db] PATCH ${table} failed ${res.status}: ${txt.slice(0, 300)}`);
  }
}

async function dbRpc(fn: string, args: Record<string, unknown>): Promise<any[] | null> {
  try {
    const res = await fetch(`${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": SERVICE_KEY,
        "Authorization": `Bearer ${SERVICE_KEY}`,
        "Accept": "application/json",
      },
      body: JSON.stringify(args),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      console.error(`[db] RPC ${fn} failed ${res.status}: ${txt.slice(0, 300)}`);
      return null;
    }
    return await res.json() as any[];
  } catch (e) {
    console.error(`[db] RPC ${fn} error:`, e instanceof Error ? e.message : e);
    return null;
  }
}

async function dbSelect(table: string, qs: string): Promise<any[]> {
  const res = await fetch(`${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/${table}?${qs}`, {
    headers: {
      "apikey": SERVICE_KEY,
      "Authorization": `Bearer ${SERVICE_KEY}`,
      "Accept": "application/json",
    },
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    console.error(`[db] SELECT ${table} failed ${res.status}: ${txt.slice(0, 300)}`);
    return [];
  }
  return res.json() as Promise<any[]>;
}

// ─── LiveKit broadcaster ──────────────────────────────────────────────────────

async function base64url(buf: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buf);
  let b64 = btoa(String.fromCharCode(...bytes));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function signLK(payload: object): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(LK_SECRET), { name:"HMAC", hash:"SHA-256" }, false, ["sign"]);
  const hdr = await base64url(new TextEncoder().encode(JSON.stringify({alg:"HS256",typ:"JWT"})).buffer);
  const pay = await base64url(new TextEncoder().encode(JSON.stringify(payload)).buffer);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${hdr}.${pay}`));
  return `${hdr}.${pay}.${await base64url(sig)}`;
}

async function broadcast(roomName: string, event: object, topic: string): Promise<void> {
  if (!LK_URL || !LK_KEY || !LK_SECRET) return;
  const httpBase = LK_URL.replace(/^wss:\/\//,"https://").replace(/^ws:\/\//,"http://");
  const token = await signLK({
    iss: LK_KEY, sub: "quiz4win-orchestrator",
    iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000)+60,
    video: { roomAdmin:true, room:roomName },
  });
  // serverTime is stamped HERE — at the actual send moment, immediately before
  // SendData — so it honours its documented contract ("server epoch ms when the
  // event was sent") and gives clients an accurate clock-offset reference. Any
  // serverTime set by the caller is intentionally overridden; the game-logic
  // timestamps (startsAt/endsAt/firstQuestionStartsAt/eliminatedAt/closedAt) are
  // separate absolute fields and are left untouched.
  const data = new TextEncoder().encode(JSON.stringify({ topic, ...event, serverTime: Date.now() }));
  // kind:0 = RELIABLE. One-shot game-state events (GAME_STARTED, QUESTION_STARTED,
  // QUESTION_CLOSED, PLAYER_ELIMINATED, …) must not be silently dropped for a
  // participant whose data channel is still settling, so they go reliable.
  const body = { room:roomName, data:btoa(String.fromCharCode(...data)), kind:0, topic };
  try {
    const res = await fetch(`${httpBase}/twirp/livekit.RoomService/SendData`, {
      method:"POST",
      headers:{"Content-Type":"application/json","Authorization":`Bearer ${token}`},
      body: JSON.stringify(body),
    });
    if (!res.ok) console.error("[livekit] broadcast HTTP", res.status);
  } catch(e) {
    console.error("[livekit] broadcast error:", e instanceof Error ? e.message : e);
  }
}

/**
 * Send a LiveKit DataChannel message to **specific identities only** (private).
 * Used for QUESTION_PREPARED so only the AI Presenter learns the correct answer
 * before the question goes live. Best-effort — never throws.
 */
async function broadcastToIdentity(
  roomName: string,
  identities: string[],
  event: object,
  topic: string,
): Promise<void> {
  if (!LK_URL || !LK_KEY || !LK_SECRET) return;
  const httpBase = LK_URL.replace(/^wss:\/\//,"https://").replace(/^ws:\/\//,"http://");
  const token = await signLK({
    iss: LK_KEY, sub: "quiz4win-orchestrator",
    iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000)+60,
    video: { roomAdmin:true, room:roomName },
  });
  // serverTime stamped at the send moment (see broadcast()).
  const data = new TextEncoder().encode(JSON.stringify({ topic, ...event, serverTime: Date.now() }));
  const body = {
    room: roomName,
    data: btoa(String.fromCharCode(...data)),
    kind: 0, // RELIABLE — see broadcast()
    topic,
    destination_identities: identities,
  };
  try {
    const res = await fetch(`${httpBase}/twirp/livekit.RoomService/SendData`, {
      method: "POST",
      headers: {"Content-Type":"application/json","Authorization":`Bearer ${token}`},
      body: JSON.stringify(body),
    });
    if (!res.ok) console.error("[livekit] broadcastToIdentity HTTP", res.status);
  } catch(e) {
    console.error("[livekit] broadcastToIdentity error:", e instanceof Error ? e.message : e);
  }
}

// ─── Elimination helpers ──────────────────────────────────────────────────────

// In-memory cache of livekit_room_name per gameId. Populated by handleStartGame
// and recoverRunningGames; lazily filled by resolveRoomName when missing.
const gameRoomNames = new Map<string, string>();

async function resolveRoomName(gameId: string): Promise<string> {
  const cached = gameRoomNames.get(gameId);
  if (cached) return cached;
  const rows = await dbSelect("games", `id=eq.${gameId}&select=livekit_room_name`);
  const name = (rows[0]?.livekit_room_name as string | null) ?? `quiz-${gameId}`;
  gameRoomNames.set(gameId, name);
  return name;
}

/**
 * Map an internal lowercase reason (`wrong_answer` / `no_answer` / `late` / `timeout`)
 * to the spec-defined uppercase enum surfaced on LiveKit events
 * (`WRONG_ANSWER` / `NO_ANSWER` / `TIMEOUT`). Unknown values default to
 * `WRONG_ANSWER` so clients always see a valid enum.
 */
function reasonToSpec(reason: string): "WRONG_ANSWER" | "NO_ANSWER" | "TIMEOUT" {
  switch (reason) {
    case "no_answer":
    case "late_join_missed": return "NO_ANSWER";
    case "late":
    case "timeout":     return "TIMEOUT";
    case "wrong_answer":
    default:            return "WRONG_ANSWER";
  }
}

/**
 * Broadcast `PLAYER_WRONG_ANSWER` for a player who lost a chance but is still
 * in the game (Allowed-Wrong-Answers spec). Emitted from both the wrong-answer
 * path (`handlePersistAnswer`) and the no-answer path (`closeQuestion`).
 */
function broadcastPlayerWrongAnswer(
  roomName: string,
  gameId: string,
  userId: string,
  wrongAnswersCount: number,
  remainingChances: number | null,
  reason: string,
): void {
  void broadcast(roomName, {
    type: "PLAYER_WRONG_ANSWER",
    gameId, userId,
    wrongAnswersCount,
    remainingChances,
    reason: reasonToSpec(reason),
    serverTime: Date.now(),
  }, "PLAYER_WRONG_ANSWER");
}

/**
 * Sync a user's elimination across Redis, Postgres, and LiveKit. Idempotent:
 * the DB PATCH is a no-op when the row is already eliminated, the SREM is a
 * no-op when the user is no longer in the participants set, and the broadcast
 * is best-effort. Callers must have already updated Redis user state
 * (userStatus / wrongCount / remainingLives / eliminatedAt / eliminationReason).
 */
async function applyElimination(params: {
  gameId: string;
  userId: string;
  roomName: string;
  wrongCount: number;
  remainingLives: number | null;
  eliminationReason: string;
  eliminatedAtMs: number;
  questionId?: string | null;
  questionIndex?: number | null;
  allowedWrongAnswers?: number | null;
}): Promise<void> {
  const { gameId, userId, roomName, wrongCount, remainingLives,
    eliminationReason, eliminatedAtMs, questionId, questionIndex,
    allowedWrongAnswers } = params;

  // 1. Remove from Redis participants set so subsequent SDIFF rounds skip them.
  const r = await getRedis();
  await r.sRem(K.parts(gameId), userId).catch((e: unknown) =>
    console.error(`[orchestrator] sRem participants game=${gameId} user=${userId}:`,
      e instanceof Error ? e.message : e));

  // Read aggregate game stats for the enriched PLAYER_ELIMINATED payload.
  // Fetch AFTER sRem so activeSurvivorCount reflects the just-eliminated user.
  let elimCount = 0, survivorCount = 0, prizePoolVal: number | null = null;
  let projectedPrize: number | null = null;
  try {
    const [elimRaw, prizeRaw, sc] = await Promise.all([
      r.hGet(K.game(gameId), "eliminatedUserCount") as Promise<string | null>,
      r.hGet(K.game(gameId), "prizePool") as Promise<string | null>,
      r.sCard(K.parts(gameId)),
    ]);
    elimCount = parseInt(elimRaw ?? "0", 10);
    survivorCount = sc;
    prizePoolVal = prizeRaw !== null ? Number(prizeRaw) : null;
    // When prizePool is known but there are no survivors (everyone eliminated),
    // projectedPrizePerSurvivor is 0 — not null. null means "no prize pool".
    projectedPrize = prizePoolVal !== null
      ? (survivorCount > 0 ? Math.round((prizePoolVal / survivorCount) * 100) / 100 : 0)
      : null;
  } catch (_e) { /* best-effort — stats missing is non-fatal */ }

  // 2. Persist authoritative elimination state on game_participants so
  //    compute_game_ranks / distribute_prizes never pays an eliminated user.
  await dbUpdate("game_participants",
    { game_id: gameId, user_id: userId },
    {
      participant_role:   "eliminated",
      eliminated:         true,
      eliminated_at:      new Date(eliminatedAtMs).toISOString(),
      elimination_reason: eliminationReason,
      wrong_count:        wrongCount,
      ...(remainingLives !== null ? { lives_remaining: remainingLives } : {}),
    });

  // 3. Broadcast — clients flip the local user to "spectator" UI on receipt.
  // Emit both the legacy `USER_ELIMINATED` (kept for back-compat with the
  // 2026-06-05 client) and the spec-aligned `PLAYER_ELIMINATED` event. The
  // spec payload uses snake_case `allowed_wrong_answers` verbatim and the
  // uppercase status enum (`SPECTATOR`) per Domain_Knowledge.md.
  const reasonSpec = reasonToSpec(eliminationReason);
  void broadcast(roomName, {
    type: "USER_ELIMINATED",
    gameId, userId,
    reason: eliminationReason,
    wrongCount,
    remainingLives,
    questionId: questionId ?? null,
    questionIndex: questionIndex ?? null,
    eliminatedAt: eliminatedAtMs,
    serverTime: Date.now(),
  }, "USER_ELIMINATED");
  void broadcast(roomName, {
    type: "PLAYER_ELIMINATED",
    gameId, userId,
    wrongAnswersCount: wrongCount,
    allowed_wrong_answers: allowedWrongAnswers ?? null,
    remainingChances: remainingLives,
    status: "SPECTATOR",
    reason: reasonSpec,
    questionId: questionId ?? null,
    questionIndex: questionIndex ?? null,
    eliminatedAt: eliminatedAtMs,
    eliminatedCount: elimCount,
    activeSurvivorCount: survivorCount,
    prizePool: prizePoolVal,
    projectedPrizePerSurvivor: projectedPrize,
    serverTime: Date.now(),
  }, "PLAYER_ELIMINATED");
}

// ─── OpenAI question generator ────────────────────────────────────────────────

interface GenQuestion {
  canonicalText: string;
  options: Array<{id:string;text:string}>;
  correctOptionId: string;
  localizedPayloads: Array<{language:string;questionText:string;options:Array<{id:string;text:string}>}>;
  explanation: string;
  estimatedAnswerTimeSec: number;
  safetyFlags: string[];
}

/**
 * Strips the auto-generated "_MMDD_HHMM" schedule slug that
 * generate_game_from_template appends to games.title (e.g.
 * "Science Quiz_0604_1400" → "Science Quiz"), so the LLM receives the real
 * subject instead of the timestamped game instance name.
 */
function cleanTopic(title: string | null | undefined): string {
  return (title ?? "").replace(/_\d{4}_\d{4}$/, "").trim() || "general knowledge";
}

/**
 * Normalizes the free-text game/template description used to guide question
 * generation. Returns "" when absent — the generator then relies solely on the
 * category. The game TITLE is never used as a generation subject (see
 * generateQuestion): questions must be driven by category + description only.
 */
function cleanDescription(description: string | null | undefined): string {
  return (description ?? "").trim();
}

/**
 * Builds the ordered, deduped set of languages every question must be generated
 * in. The primary display language (`games.language`) is always placed FIRST —
 * it becomes the generator's baseLanguage (canonicalText) — followed by the
 * remaining `target_languages`. Anything outside SUPPORTED_LANGUAGES is dropped,
 * and the result is never empty (falls back to ["en"]).
 */
function resolveTargetLanguages(
  primary: string | null | undefined,
  target: string[] | null | undefined,
): string[] {
  const supported = SUPPORTED_LANGUAGES as readonly string[];
  const candidate = Array.isArray(target) && target.length
    ? target
    : [...supported];
  const ordered = [primary ?? "en", ...candidate]
    .filter((l): l is string => typeof l === "string" && supported.includes(l));
  const deduped = [...new Set(ordered)];
  return deduped.length ? deduped : ["en"];
}

/**
 * Shuffles the four answer options (A/B/C/D) into a random order and rewrites
 * `correctOptionId` to point to wherever the correct answer landed.
 * The same permutation is applied to every localized payload so option IDs
 * stay consistent across all languages.
 *
 * LLMs are strongly biased toward placing the correct answer first (A), so this
 * must be applied to every generated question before it is stored or broadcast.
 */
function shuffleQuestionOptions(q: GenQuestion): GenQuestion {
  const LABELS = ["A", "B", "C", "D"] as const;

  // Build a shuffled index array [0..3] using Fisher-Yates.
  const indices = [0, 1, 2, 3];
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }

  const oldCorrectIndex = LABELS.indexOf(q.correctOptionId as typeof LABELS[number]);

  // Rebuild canonical options: position i gets the text from old slot indices[i],
  // but retains the label for position i (A, B, C, D).
  const newOptions = indices.map((oldIdx, newIdx) => ({
    id: LABELS[newIdx],
    text: q.options[oldIdx]?.text ?? "",
  }));

  // The correct answer now lives at whichever new position holds the old index.
  const newCorrectIndex = indices.indexOf(oldCorrectIndex);
  const newCorrectOptionId = LABELS[newCorrectIndex];

  // Apply the exact same permutation to every localized payload.
  const newLocalizedPayloads = (q.localizedPayloads ?? []).map(lp => ({
    ...lp,
    options: indices.map((oldIdx, newIdx) => ({
      id: LABELS[newIdx],
      text: lp.options?.[oldIdx]?.text ?? "",
    })),
  }));

  console.log(`[orchestrator] shuffleQuestionOptions: ` +
    `original correct=${q.correctOptionId} → shuffled correct=${newCorrectOptionId} ` +
    `permutation=[${indices.join(",")}]`);

  return { ...q, options: newOptions, correctOptionId: newCorrectOptionId, localizedPayloads: newLocalizedPayloads };
}

async function generateQuestion(params: {
  category?: string; difficulty?: string; description?: string;
  targetLanguages: string[]; timeLimitSeconds?: number;
  // Canonical texts the model must NOT reproduce (already asked this game, or
  // a re-roll after a cross-platform cooldown collision).
  avoidTexts?: string[];
  // Override the sampling temperature — raised on dedup retries to escape the
  // model's single most-likely (and therefore repeated) question.
  temperature?: number;
}): Promise<GenQuestion> {
  if (!OPENAI_KEY) throw new Error("OPENAI_API_KEY not set");

  // The generated content must faithfully reflect the template-derived game
  // config (category/description/difficulty/language). baseLanguage is the game's
  // single configured language: canonicalText is written in it and it is the
  // only entry expected in localizedPayloads.
  const targetLanguages = params.targetLanguages.length ? params.targetLanguages : ["en"];
  const baseLanguage = targetLanguages[0] ?? "en";
  const category = params.category ?? "general knowledge";
  const difficulty = params.difficulty ?? "medium";
  // Free-text guidance from the game/template description. The game TITLE is
  // deliberately NOT a generation input — subject is driven by category + description.
  const description = cleanDescription(params.description);

  const sys = `You are a multilingual quiz question generator acting as a live game-show host.
You MUST strictly honour the generation parameters in the user message:
- "category": the subject area the question MUST belong to. This is the PRIMARY
  driver of the question's subject.
- "description": OPTIONAL extra guidance describing what the quiz is about and
  what to focus on. When non-empty, the question MUST respect it. When empty,
  rely SOLELY on "category". This is background guidance, NOT a question title —
  never quote it back verbatim in the question.
- "difficulty": produce a question of EXACTLY this difficulty level.
- "baseLanguage": the language of "canonicalText" and its "options".
- "targetLanguages": the COMPLETE set of languages "localizedPayloads" must cover —
  exactly one entry per language, no more and no fewer, each a faithful translation.
Rules:
- Generate ONE question with FOUR options: A, B, C, D.
- FACTUAL ACCURACY IS MANDATORY. The question must have EXACTLY ONE unambiguously
  correct answer that is verifiably true, and the other three options must be
  clearly and verifiably WRONG. NEVER produce a question whose marked answer is
  incorrect, debatable, outdated, or where more than one option could reasonably
  be considered correct. If you are not certain of the correct answer, generate a
  different question you ARE certain about.
- "canonicalText" and its options MUST be written in "baseLanguage".
- "localizedPayloads" MUST contain one entry for EACH code in "targetLanguages",
  using that exact code verbatim in the "language" field.
- Option IDs are IDENTICAL across all languages.
- The question MUST match the requested category and difficulty (and the
  "description" when one is provided). Do NOT use the game's name/title as the subject.
- Avoid political/hate/sexual/religious/illegal/ambiguous content.
- The question MUST be original and clearly DIFFERENT from every entry in the
  "avoid" list — a different fact/topic, not a reworded variant of the same one.
- Output ONLY valid JSON, no markdown.

Schema: {"canonicalText":"","options":[{"id":"A","text":""},...],"correctOptionId":"A",
"localizedPayloads":[{"language":"<one of targetLanguages>","questionText":"","options":[{"id":"A","text":""},...]},...]
,"explanation":"","estimatedAnswerTimeSec":10,"safetyFlags":[]}`;

  // Cap the avoid-list (most-recent first) so the prompt stays bounded.
  const { avoidTexts, temperature } = params;
  const userPayload = {
    category, difficulty, description, baseLanguage, targetLanguages,
    timeLimitSeconds: params.timeLimitSeconds,
    avoid: (avoidTexts ?? []).slice(-40),
    // A fresh seed every call pushes the model off its default answer so two
    // back-to-back generations with identical params still differ.
    diversitySeed: crypto.randomUUID(),
  };

  // Log the exact inputs sent to the model so a mismatch between the template
  // and the generated game can be traced (no secrets — config values only).
  console.log(`[orchestrator] LLM gen request: ` +
    `category="${category}" difficulty="${difficulty}" ` +
    `description="${description.slice(0, 60)}" ` +
    `baseLanguage="${baseLanguage}" targetLanguages=[${targetLanguages.join(",")}]`);

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method:"POST",
    headers:{"Content-Type":"application/json","Authorization":`Bearer ${OPENAI_KEY}`},
    body: JSON.stringify({
      model: OPENAI_MODEL, temperature: temperature ?? 0.8, max_tokens:1500,
      response_format:{type:"json_object"},
      messages:[
        {role:"system",content:sys},
        {role:"user",content:JSON.stringify(userPayload)},
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}`);
  const json = await res.json() as any;
  const raw = JSON.parse(json.choices[0].message.content) as GenQuestion;
  if (!["A","B","C","D"].includes(raw.correctOptionId)) throw new Error("Invalid correctOptionId");

  // Shuffle options so the correct answer is NOT always position A (LLM bias fix).
  const parsed = shuffleQuestionOptions(raw);

  // Validate that every requested target language is present in the output, so a
  // template asking for e.g. 'ar' content is never silently served English only.
  const producedLangs = (parsed.localizedPayloads ?? []).map(p => p.language);
  const missingLangs = targetLanguages.filter(l => !producedLangs.includes(l));
  if (missingLangs.length) {
    console.warn(`[orchestrator] LLM response missing target language(s) ` +
      `[${missingLangs.join(",")}] for category="${category}" — produced=[${producedLangs.join(",")}]`);
  }
  console.log(`[orchestrator] LLM gen result: category="${category}" ` +
    `langs=[${producedLangs.join(",")}] correctOptionId=${parsed.correctOptionId} ` +
    `canonical="${(parsed.canonicalText ?? "").slice(0, 80)}"`);

  return parsed;
}

// ─── Presenter-mode state ─────────────────────────────────────────────────────

/**
 * Config for a game running in `presenter` run_mode.
 * The orchestrator acts only when it receives explicit commands
 * (PrepareQuestion / StartQuestion / CloseQuestion / AdvanceQuestion).
 * Stored in memory; rebuilt from Redis on restart via recoverRunningGames().
 */
interface PresenterGameConfig {
  gameId: string;
  roomName: string;
  timeLimitSeconds: number;
  maxQuestions: number;
  targetLanguages: string[];
  description: string;
  category: string;
  difficulty: string;
  gracePeriodMs: number;
  maxWrongAnswers: number | null;
  /** LiveKit identity the presenter joined the room with (e.g. "ai-presenter-<gameId>"). */
  presenterIdentity: string;
  /** Index of the next question to be prepared (incremented after each StartQuestion). */
  currentQuestionIndex: number;
}

/** Active presenter-mode game configs, keyed by gameId. */
const presenterGames = new Map<string, PresenterGameConfig>();

/**
 * A question that has been prepared (staged) but not yet activated.
 * Kept in memory between PrepareQuestion and StartQuestion so we don't
 * need an extra Redis round-trip to broadcast QUESTION_STARTED.
 * Rebuilt from Redis staged hash on restart (see recoverRunningGames).
 */
interface StagedQuestion {
  q: GenQuestion;
  questionId: string;
  questionIndex: number;
}

/** In-memory staged questions, keyed by gameId. */
const stagedQuestions = new Map<string, StagedQuestion>();

// ─── Game question loop ───────────────────────────────────────────────────────

// Active close-question timers keyed by gameId
const closeTimers = new Map<string, ReturnType<typeof setTimeout>>();
// Pre-generated question queue keyed by gameId
const questionQueue = new Map<string, GenQuestion[]>();
// Canonical question IDs already asked in a given game (within-game dedup).
const askedQuestionIds = new Map<string, Set<string>>();
// Canonical (normalized) question TEXTS already asked in a given game. Fed to
// the generator's avoid-list so it never re-asks the same question (§ no-repeat).
const askedQuestionTexts = new Map<string, Set<string>>();

/** Normalizes question text to match claim_question's content_hash basis. */
function normalizeText(t: string): string {
  return t.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Keeps the per-game question queue filled to 3 entries (§5.7 pre-generation).
 * Module-level so it can be called from both auto-mode loop and presenter mode.
 */
async function prefillQueue(gameId: string, config: {
  description: string; category: string; difficulty: string;
  targetLanguages: string[]; timeLimitSeconds: number;
}): Promise<void> {
  const queue = questionQueue.get(gameId) ?? [];
  const askedTexts = askedQuestionTexts.get(gameId) ?? new Set<string>();
  while (queue.length < 3) {
    // Avoid both already-asked questions and the ones already queued, so the
    // 3 pre-generated questions are mutually distinct too.
    const avoidTexts = [
      ...askedTexts,
      ...queue.map((qq) => normalizeText(qq.canonicalText)),
    ];
    try {
      const q = await generateQuestion({
        description: config.description, category: config.category,
        difficulty: config.difficulty, targetLanguages: config.targetLanguages,
        timeLimitSeconds: config.timeLimitSeconds, avoidTexts,
      });
      queue.push(q);
      console.log(`[orchestrator] game=${gameId} pre-generated question; queue=${queue.length}`);
    } catch(e) {
      console.error("[orchestrator] question pre-gen failed:", e instanceof Error ? e.message : e);
      break;
    }
  }
  questionQueue.set(gameId, queue);
}

/**
 * Resolves a generated question to its canonical DB row via the claim_question
 * RPC. Returns the canonical id and whether it was asked within the platform
 * re-ask cooldown window (was_recent). Returns null only when the DB is
 * unreachable, so callers can fall back to a local UUID and keep the game live.
 */
async function claimQuestion(q: GenQuestion, meta: {
  category: string; difficulty: string; targetLanguages?: string[];
}): Promise<{ id: string; wasRecent: boolean } | null> {
  // Persist the canonical row tagged with the game's configured language (not a
  // hard-coded "en"), so the question bank stays faithful to the template config.
  // p_language only sets the stored row's language column — content_hash (and
  // therefore dedup) is derived from the normalized text alone, so this is safe.
  const rows = await dbRpc("claim_question", {
    p_text: q.canonicalText,
    p_options: q.options.map(o => o.text),
    p_option_ids: q.options.map(o => o.id),
    p_correct_option_id: q.correctOptionId,
    p_correct_index: q.options.findIndex(o => o.id === q.correctOptionId),
    p_localized: q.localizedPayloads,
    p_category: meta.category,
    p_difficulty: meta.difficulty,
    p_language: meta.targetLanguages?.[0] ?? "en",
    p_cooldown_seconds: QUESTION_REASK_COOLDOWN_SECONDS,
  });
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return { id: String(rows[0].question_id), wasRecent: !!rows[0].was_recent };
}

/**
 * Guarantees a non-duplicate question: a question is never repeated within the
 * same game, and never re-asked across the platform inside the cooldown window
 * (§ no-duplicate invariant). Re-generates a fresh question on collision up to
 * QUESTION_DEDUP_MAX_RETRIES times, then accepts the last claim to avoid
 * stalling the game. Falls back to a local UUID if the DB is unreachable.
 */
async function resolveUniqueQuestion(gameId: string, config: {
  description: string; category: string; difficulty: string;
  targetLanguages: string[]; timeLimitSeconds: number;
}, first: GenQuestion): Promise<{ q: GenQuestion; id: string }> {
  const asked = askedQuestionIds.get(gameId) ?? new Set<string>();
  askedQuestionIds.set(gameId, asked);
  const askedTexts = askedQuestionTexts.get(gameId) ?? new Set<string>();
  askedQuestionTexts.set(gameId, askedTexts);
  // The avoid-list grows with every collision so the generator is explicitly
  // told which questions NOT to produce — this is what actually breaks the
  // "same popular trivia every time" loop (§ no-repeat invariant).
  const avoidTexts = new Set<string>(askedTexts);
  let q = first;
  let fallback: { q: GenQuestion; id: string } | null = null;

  for (let attempt = 0; attempt < QUESTION_DEDUP_MAX_RETRIES; attempt++) {
    const claim = await claimQuestion(q, config);
    if (claim) {
      fallback = { q, id: claim.id };
      if (!claim.wasRecent && !asked.has(claim.id)) {
        asked.add(claim.id);
        askedTexts.add(normalizeText(q.canonicalText));
        return { q, id: claim.id };
      }
      console.warn(`[orchestrator] game=${gameId} question collision ` +
        `(recent=${claim.wasRecent}, inGame=${asked.has(claim.id)}) — regenerating`);
    }
    // Feed the colliding text back so the next generation explicitly avoids it.
    avoidTexts.add(normalizeText(q.canonicalText));
    try {
      q = await generateQuestion({
        description: config.description, category: config.category,
        difficulty: config.difficulty, targetLanguages: config.targetLanguages,
        timeLimitSeconds: config.timeLimitSeconds,
        avoidTexts: [...avoidTexts],
        // Raise diversity on each retry to escape the model's default answer.
        temperature: Math.min(1.2, 0.7 + attempt * 0.15),
      });
    } catch (e) {
      console.error("[orchestrator] dedup regenerate failed:", e instanceof Error ? e.message : e);
      break;
    }
  }

  if (fallback) {
    asked.add(fallback.id);
    askedTexts.add(normalizeText(fallback.q.canonicalText));
    console.warn(`[orchestrator] game=${gameId} accepting question after ` +
      `${QUESTION_DEDUP_MAX_RETRIES} dedup attempts (fallback)`);
    return fallback;
  }
  // DB unreachable — preserve the game with a local id (no audit row).
  const id = crypto.randomUUID();
  asked.add(id);
  askedTexts.add(normalizeText(q.canonicalText));
  return { q, id };
}

async function startQuestionLoop(game: {
  id: string; roomName: string; questionIndex: number;
  timeLimitSeconds: number; maxQuestions: number;
  targetLanguages: string[]; description: string; category: string; difficulty: string;
  gracePeriodMs: number; maxWrongAnswers: number | null;
}): Promise<void> {
  const { id: gameId, roomName, timeLimitSeconds, gracePeriodMs } = game;

  // Re-use module-level prefill (§5.7)
  const prefill = () => prefillQueue(gameId, game);

  const advanceQuestion = async (idx: number): Promise<void> => {
    if (idx >= game.maxQuestions) {
      await finalizeGame(gameId, roomName);
      return;
    }

    // Ensure queue has questions
    await prefill();
    const queue = questionQueue.get(gameId) ?? [];
    let q = queue.shift();
    questionQueue.set(gameId, queue);
    if (!q) {
      console.warn(`[orchestrator] game=${gameId} no question available at idx=${idx} — finalizing`);
      await finalizeGame(gameId, roomName);
      return;
    }

    // Resolve to a canonical, non-duplicate question (§ no-duplicate invariant)
    // — re-rolls if asked recently across the platform or already used in this
    // game; the returned id is used for Redis + broadcast + answer matching.
    const resolved = await resolveUniqueQuestion(gameId, game, q);
    q = resolved.q;
    const dbQuestionId = resolved.id;

    // §8.2: Write to Redis FIRST, then broadcast
    const now = Date.now();
    const endsAt = now + timeLimitSeconds * 1000;
    const locPayload = JSON.stringify(q.localizedPayloads);
    const luaR = await evalLua(PREPARE_Q_SCRIPT,
      [K.game(gameId), K.q(gameId, idx)],
      [dbQuestionId, String(idx), q.correctOptionId,
       String(now), String(endsAt), String(gracePeriodMs), locPayload]);
    const prepResult = JSON.parse(luaR as string) as {status:string};
    if (prepResult.status !== "ok") {
      // Don't swallow — a bare return here would strand the game 'live' with no
      // question and no close timer. Throw so the failure surfaces and (for the
      // first question) the StartGame is nack'd / re-driven by the scheduler and
      // recoverRunningGames rather than freezing the player on a 0:00 screen.
      throw new Error(`prepare_question failed game=${gameId} idx=${idx}: ${luaR}`);
    }

    // Broadcast QUESTION_STARTED (without correctOptionId — §13.4)
    await broadcast(roomName, {
      type: "QUESTION_STARTED",
      gameId, questionId: dbQuestionId, questionIndex: idx,
      questionText: q.canonicalText, options: q.options,
      primaryLanguage: game.targetLanguages[0] ?? "en",
      languages: game.targetLanguages,
      localizedPayloads: q.localizedPayloads.map(lp => ({...lp, options: lp.options})),
      startsAt: now, endsAt, timeLimitSeconds, serverTime: now,
    }, "QUESTION_STARTED");

    console.log(`[orchestrator] game=${gameId} question ${idx} started endsAt=${endsAt}`);

    // Schedule close after the answer window + grace
    const closeDelay = timeLimitSeconds * 1000 + gracePeriodMs + 50;
    const timer = setTimeout(() => {
      closeQuestion(game, idx).catch(e =>
        console.error(`[orchestrator] game=${gameId} closeQuestion q=${idx} CRASH:`,
          e instanceof Error ? (e.stack ?? e.message) : String(e))
      );
    }, closeDelay);
    closeTimers.set(gameId, timer);

    // Kick off next pre-generation in the background
    void prefill();
  };

  await advanceQuestion(game.questionIndex);
}

async function closeQuestion(game: {
  id: string; roomName: string; timeLimitSeconds: number;
  maxQuestions: number; targetLanguages: string[];
  description: string; category: string; difficulty: string;
  gracePeriodMs: number; maxWrongAnswers: number | null;
}, idx: number): Promise<void> {
  const { id: gameId, roomName, gracePeriodMs } = game;
  closeTimers.delete(gameId);

  const now = Date.now();
  const luaR = await evalLua(CLOSE_Q_SCRIPT,
    [K.game(gameId), K.q(gameId, idx), K.parts(gameId), K.qAnswered(gameId, idx)],
    [String(now)]);
  const closeResult = JSON.parse(luaR as string) as {
    status:string; questionId?:string; correctOptionId?:string;
    notAnswered?:string[]; closedAt?:number;
  };
  if (closeResult.status !== "ok") {
    console.warn(`[orchestrator] game=${gameId} close_question: ${luaR}`);
    return;
  }

  // Get correctOptionId from Redis game state
  const r = await getRedis();
  const correctOpt = await r.hGet(K.game(gameId), "currentQuestionCorrectOptionId") as string;

  // Handle no-answer eliminations (§10.2). Domain rule: a missed answer is
  // treated identically to a wrong answer — one life is deducted; the user is
  // eliminated when remainingLives hits 0 or wrongCount exceeds maxWrong.
  const maxWrong = game.maxWrongAnswers;
  // SDIFF over an empty set is encoded by cjson as `{}` (object), not `[]`.
  // Guard with Array.isArray so an empty result is a no-op instead of throwing
  // "object is not iterable" (which crashed the loop on every close — see logs).
  const notAnswered = Array.isArray(closeResult.notAnswered) ? closeResult.notAnswered : [];
  let noAnswerEliminated = 0;
  for (const userId of notAnswered) {
    const userKey = K.user(gameId, userId);
    // Skip users already eliminated by a prior round but lingering in the
    // participants set (defence-in-depth — applyElimination prunes the set so
    // this should be a no-op once the system stabilises on the new flow).
    const status = await r.hGet(userKey, "userStatus") as string | null;
    if (status && status !== "participant") {
      await r.sRem(K.parts(gameId), userId).catch(() => {});
      continue;
    }
    const wrongRaw = await r.hGet(userKey, "wrongCount") as string | null;
    const rlRaw    = await r.hGet(userKey, "remainingLives") as string | null;
    const newWrong = (parseInt(wrongRaw ?? "0", 10)) + 1;
    const rl       = rlRaw !== null ? Math.max(parseInt(rlRaw, 10) - 1, 0) : null;
    const elim     = (rl !== null && rl === 0) || (maxWrong !== null && newWrong > maxWrong);
    await r.hSet(userKey, "wrongCount", String(newWrong));
    if (rl !== null) await r.hSet(userKey, "remainingLives", String(rl));
    if (elim) {
      await r.hSet(userKey, "userStatus", "eliminated", "eliminatedAt", String(now),
        "eliminationReason", "no_answer");
      await r.hIncrBy(K.game(gameId), "eliminatedUserCount", 1);
      noAnswerEliminated += 1;
      await applyElimination({
        gameId, userId, roomName,
        wrongCount: newWrong, remainingLives: rl,
        eliminationReason: "no_answer",
        eliminatedAtMs: now,
        questionId: closeResult.questionId ?? null,
        questionIndex: idx,
        allowedWrongAnswers: maxWrong,
      });
    } else {
      // Still in the game — keep wrong_count and lives_remaining mirrored in
      // Postgres so survivor checks against the DB stay accurate, and notify
      // clients of the lost chance per the Allowed-Wrong-Answers spec.
      void dbUpdate("game_participants",
        { game_id: gameId, user_id: userId },
        {
          wrong_count: newWrong,
          ...(rl !== null ? { lives_remaining: rl } : {}),
        });
      broadcastPlayerWrongAnswer(roomName, gameId, userId, newWrong, rl, "no_answer");
    }
    // Async persist no-answer audit row
    void dbInsert("game_answers", {
      id: crypto.randomUUID(), game_id: gameId, question_id: closeResult.questionId,
      round_number: idx, was_no_answer: true, was_late: false, was_duplicate: false,
      is_correct: false, correct_option_id: correctOpt, points_earned: 0,
      server_received_at: new Date(now).toISOString(),
      question_ends_at: new Date(now - gracePeriodMs).toISOString(),
      wrong_count_after: newWrong, remaining_lives_after: rl,
      user_status_after: elim ? "eliminated" : "participant",
      elimination_reason: elim ? "no_answer" : null,
    });
  }

  // §10.3 — Ghost participant sweep: players who paid entry (have a DB row) but
  // never established Redis state by calling POST /game-session/:id/join.
  // These players are absent from the Redis participants and spectators sets, so
  // the SDIFF-based notAnswered list above misses them entirely. The same rule
  // applies: any question without a valid submission = missed/wrong answer.
  let ghostNoAnswer = 0;
  let ghostEliminated = 0;
  try {
    // Collect every userId already tracked in Redis for this game.
    const [redisParts, redisSpecs] = await Promise.all([
      r.sMembers(K.parts(gameId)) as Promise<string[]>,
      r.sMembers(K.specs(gameId)) as Promise<string[]>,
    ]);
    const redisKnown = new Set([...redisParts, ...redisSpecs]);

    // Query all active (non-eliminated) DB participants for this game.
    // participant_role NOT IN ('spectator','eliminated') ensures we skip players
    // already demoted via a previous sweep or join-time demotion.
    const dbRows = await dbSelect(
      "game_participants",
      `select=user_id,wrong_count,lives_remaining` +
      `&game_id=eq.${gameId}&role=eq.player&eliminated=eq.false` +
      `&participant_role=not.in.(spectator,eliminated)`,
    ) as Array<{ user_id: string; wrong_count: number | null; lives_remaining: number | null }>;

    // Ghost users = in DB but not in Redis (never called /game-session/join or
    // Redis state expired and was never re-established).
    const ghostUsers = dbRows.filter(p => !redisKnown.has(p.user_id));
    ghostNoAnswer = ghostUsers.length;

    for (const ghost of ghostUsers) {
      const dbWrong = ghost.wrong_count ?? 0;
      const dbLives = ghost.lives_remaining;
      const newWrong = dbWrong + 1;
      // Compute new lives: decrement tracked value or derive from maxWrong.
      const newLives = maxWrong !== null
        ? (dbLives !== null ? Math.max(dbLives - 1, 0) : Math.max(maxWrong - newWrong, 0))
        : null;
      const elim = (newLives !== null && newLives === 0)
        || (maxWrong !== null && newWrong >= maxWrong);

      if (elim) {
        ghostEliminated++;
        void dbUpdate("game_participants",
          { game_id: gameId, user_id: ghost.user_id },
          {
            participant_role:   "eliminated",
            eliminated:         true,
            eliminated_at:      new Date(now).toISOString(),
            elimination_reason: "no_answer",
            wrong_count:        newWrong,
            ...(newLives !== null ? { lives_remaining: newLives } : {}),
          });
        // Legacy + spec-aligned elimination events (ghost users were never in a
        // Redis survivor slot so game-snapshot fields are omitted per docs §5).
        void broadcast(roomName, {
          type: "USER_ELIMINATED", gameId, userId: ghost.user_id,
          reason: "no_answer", wrongCount: newWrong, remainingLives: newLives,
          questionId: closeResult.questionId ?? null, questionIndex: idx,
          eliminatedAt: now,
        }, "USER_ELIMINATED");
        void broadcast(roomName, {
          type: "PLAYER_ELIMINATED", gameId, userId: ghost.user_id,
          wrongAnswersCount: newWrong, allowed_wrong_answers: maxWrong ?? null,
          remainingChances: newLives, status: "SPECTATOR", reason: "NO_ANSWER",
          questionId: closeResult.questionId ?? null, questionIndex: idx,
          eliminatedAt: now,
        }, "PLAYER_ELIMINATED");
      } else {
        void dbUpdate("game_participants",
          { game_id: gameId, user_id: ghost.user_id },
          {
            wrong_count: newWrong,
            ...(newLives !== null ? { lives_remaining: newLives } : {}),
          });
        broadcastPlayerWrongAnswer(roomName, gameId, ghost.user_id, newWrong, newLives, "no_answer");
      }
      // Audit row — identical shape to the Redis notAnswered path.
      void dbInsert("game_answers", {
        id: crypto.randomUUID(), game_id: gameId, question_id: closeResult.questionId,
        round_number: idx, was_no_answer: true, was_late: false, was_duplicate: false,
        is_correct: false, correct_option_id: correctOpt, points_earned: 0,
        server_received_at: new Date(now).toISOString(),
        question_ends_at:   new Date(now - gracePeriodMs).toISOString(),
        wrong_count_after: newWrong, remaining_lives_after: newLives,
        user_status_after: elim ? "eliminated" : "participant",
        elimination_reason: elim ? "no_answer" : null,
      });
    }

    if (ghostUsers.length > 0) {
      console.log(`[orchestrator] game=${gameId} q=${idx} ghost sweep: ` +
        `${ghostUsers.length} ghost users, ${ghostEliminated} eliminated`);
    }
  } catch (ghostErr) {
    // Ghost sweep is best-effort — a DB error must never crash the close flow.
    console.error(`[orchestrator] game=${gameId} q=${idx} ghost sweep error:`,
      ghostErr instanceof Error ? ghostErr.message : ghostErr);
  }

  // Broadcast QUESTION_CLOSED with the correct answer revealed (§13.4 after close).
  // Enrich with a post-close game-state snapshot so clients can update the HUD
  // (survivor count, prize projection) from a single authoritative event.
  let qcElimCount = 0, qcSurvivorCount = 0, qcPrizePool: number | null = null;
  let qcProjected: number | null = null;
  try {
    const [qcElimRaw, qcPrizeRaw, qcSc] = await Promise.all([
      r.hGet(K.game(gameId), "eliminatedUserCount") as Promise<string | null>,
      r.hGet(K.game(gameId), "prizePool") as Promise<string | null>,
      r.sCard(K.parts(gameId)),
    ]);
    qcElimCount = parseInt(qcElimRaw ?? "0", 10);
    qcSurvivorCount = qcSc;
    qcPrizePool = qcPrizeRaw !== null ? Number(qcPrizeRaw) : null;
    // When prizePool is known but there are no survivors (everyone eliminated),
    // projectedPrizePerSurvivor is 0 — not null. null means "no prize pool".
    qcProjected = qcPrizePool !== null
      ? (qcSurvivorCount > 0 ? Math.round((qcPrizePool / qcSurvivorCount) * 100) / 100 : 0)
      : null;
  } catch (_e) { /* best-effort */ }
  await broadcast(roomName, {
    type: "QUESTION_CLOSED", gameId,
    questionId: closeResult.questionId, questionIndex: idx,
    correctOptionId: correctOpt,
    // noAnswerCount includes both Redis participants who didn't answer AND ghost
    // participants (never-joined players swept from the DB in §10.3).
    noAnswerCount: notAnswered.length + ghostNoAnswer,
    noAnswerEliminatedCount: noAnswerEliminated + ghostEliminated,
    eliminatedCount: qcElimCount,
    activeSurvivorCount: qcSurvivorCount,
    prizePool: qcPrizePool,
    projectedPrizePerSurvivor: qcProjected,
    closedAt: now, serverTime: now,
  }, "QUESTION_CLOSED");

  console.log(`[orchestrator] game=${gameId} question ${idx} closed; ` +
    `notAnswered=${notAnswered.length} ghost=${ghostNoAnswer} eliminated=${noAnswerEliminated + ghostEliminated}`);

  // In auto mode: pause 3 s then advance to the next question automatically.
  // In presenter mode: wait for the next PrepareQuestion / AdvanceQuestion command.
  if (!presenterGames.has(gameId)) {
    setTimeout(() => {
      startQuestionLoop({...game, questionIndex: idx + 1}).catch(e =>
        console.error(`[orchestrator] game=${gameId} startQuestionLoop q=${idx + 1} CRASH:`,
          e instanceof Error ? (e.stack ?? e.message) : String(e))
      );
    }, 3000);
  } else {
    console.log(`[orchestrator] game=${gameId} presenter mode — q=${idx} closed; ` +
      `waiting for PrepareQuestion or AdvanceQuestion`);
  }
}

async function finalizeGame(gameId: string, roomName: string): Promise<void> {
  console.log(`[orchestrator] game=${gameId} finalizing`);
  const now = new Date().toISOString();
  await dbUpdate("games", { id: gameId }, { status: "completed", ended_at: now });
  await broadcast(roomName, { type:"GAME_ENDED", gameId, serverTime:Date.now() }, "GAME_ENDED");

  // Distribute prizes (atomic, idempotent — safe to call again from the
  // template-generator safety-net tick if this step fails). FCM fan-out to
  // winners is handled by the template-generator's prizeNotificationTick.
  // The RPC now returns the canonical aggregate summary (persisted on
  // games.result_summary); we forward it as a GAME_RESULT LiveKit event so
  // every connected client renders the final podium / "X winners share $Y"
  // screen without making an additional API round-trip.
  try {
    const res = await fetch(`${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/rpc/distribute_prizes`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": SERVICE_KEY,
        "Authorization": `Bearer ${SERVICE_KEY}`,
      },
      body: JSON.stringify({ p_game_id: gameId }),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      console.error(`[orchestrator] distribute_prizes HTTP ${res.status} game=${gameId}: ${txt.slice(0, 200)}`);
    } else {
      const out = await res.json().catch(() => null) as Record<string, unknown> | null;
      console.log(`[orchestrator] distribute_prizes game=${gameId} →`, out);
      if (out && (out.distributed === true || out.already_distributed === true)) {
        await broadcast(roomName, {
          type:            "GAME_RESULT",
          gameId,
          serverTime:      Date.now(),
          totalWinners:    Number(out.total_winners ?? 0),
          totalPrize:      Number(out.total_prize ?? 0),
          prizePool:       Number(out.prize_pool ?? 0),
          currency:        String(out.currency ?? "USD"),
          sharePerWinner:  Number(out.share_per_winner ?? 0),
          winnerUserIds:   Array.isArray(out.winner_user_ids) ? out.winner_user_ids : [],
          winners:         Array.isArray(out.winners) ? out.winners : [],
          distributedAt:   out.distributed_at ?? null,
          alreadyDistributed: out.already_distributed === true,
        }, "GAME_RESULT");
      }
    }
  } catch (err) {
    console.error(`[orchestrator] distribute_prizes failed game=${gameId}:`,
      err instanceof Error ? err.message : err);
  }

  // Expire Redis keys after 1 hour (§15.1 — TTLs to avoid stale state)
  const r = await getRedis();
  await r.expire(K.game(gameId), 3600);
  questionQueue.delete(gameId);
  presenterGames.delete(gameId);
  stagedQuestions.delete(gameId);
  askedQuestionIds.delete(gameId);
  askedQuestionTexts.delete(gameId);
}

// ─── RabbitMQ message handlers ────────────────────────────────────────────────

async function handleStartGame(payload: any): Promise<void> {
  const { gameId } = payload;
  console.log(`[orchestrator] StartGame gameId=${gameId}`);

  // Fetch game config from DB
  const rows = await dbSelect("games",
    `id=eq.${gameId}&select=id,title,description,status,run_mode,livekit_room_name,time_per_question,` +
    `allowed_wrong_answers,grace_period_ms,join_policy,questions_count,language,target_languages,category,difficulty,prize_pool,prize_pool_currency`);
  if (!rows.length) { console.error(`[orchestrator] StartGame: game ${gameId} not found`); return; }
  const g = rows[0] as any;

  // Idempotency / recovery guard (at-least-once StartGame). The scheduler
  // re-drives stuck games, so a StartGame may race a slow first attempt or be
  // delivered twice.
  //   • completed/cancelled are terminal → always no-op.
  //   • live is NOT treated as terminal: a game can be 'live' yet never have
  //     broadcast question 0 (failed first attempt, orchestrator recreated
  //     before the loop ran). We only skip when Redis shows a question has
  //     actually started (currentQuestionStatus present); otherwise we fall
  //     through and (re)start the question loop so it recovers instead of
  //     stranding with a frozen 0:00 screen.
  if (g.status === "completed" || g.status === "cancelled") {
    console.log(`[orchestrator] StartGame: game ${gameId} already status=${g.status}, skipping (idempotent)`);
    return;
  }
  if (g.status === "live") {
    const rGuard = await getRedis();
    const qStatus = await rGuard.hGet(K.game(gameId), "currentQuestionStatus") as string | null;
    // Only skip if a question is actively in progress. 'closed' means the
    // question window ended but the advance-to-next timer never fired (e.g.
    // orchestrator was recreated between close and advance). Treating 'closed'
    // as "running" would permanently strand the game — recoverRunningGames
    // handles the closed→advance path on startup.
    if (qStatus === "active") {
      console.log(`[orchestrator] StartGame: game ${gameId} already live with active question, skipping (idempotent)`);
      return;
    }
    if (qStatus === "closed") {
      console.warn(`[orchestrator] StartGame: game ${gameId} is live with question ${await rGuard.hGet(K.game(gameId), "currentQuestionIndex")} closed — recoverRunningGames will advance; skipping re-init`);
      return;
    }
    console.warn(`[orchestrator] StartGame: game ${gameId} is live but no question started — recovering`);
  }

  const roomName: string = g.livekit_room_name ?? `quiz-${gameId}`;
  gameRoomNames.set(gameId, roomName);
  const timeLimitSeconds: number = g.time_per_question ?? 10;
  const gracePeriodMs: number = g.grace_period_ms ?? 400;
  const maxWrongAnswers: number | null = g.allowed_wrong_answers ?? null;
  const namespace = `q4w:game:${gameId}`;

  // Initialise Redis game state (§18.1 — Orchestrator initializes namespace)
  const r = await getRedis();

  const runMode: string = g.run_mode ?? "auto";
  const nowMs = Date.now();
  // Auto-mode games observe a pregame warmup so clients can render a
  // synchronized countdown. Presenter-mode games are command-driven so the
  // "first question" timestamp is undefined here.
  const firstQuestionStartsAtMs = runMode === "auto"
    ? nowMs + PREGAME_WARMUP_MS
    : null;
  const pregameDurationMs = runMode === "auto" ? PREGAME_WARMUP_MS : 0;

  // prize_pool in DB is NUMERIC(12,2) dollars; store as the raw decimal string
  // so reads via hGet return the original value without float conversion error.
  const prizePoolStr = g.prize_pool != null ? String(g.prize_pool) : null;
  // The static GAME_STARTED fields (languages, category, questionsCount,
  // prizePoolCurrency, title, pregameDurationMs, firstQuestionStartsAt) are
  // persisted in the game hash so the game-session snapshot (returned by /join
  // and GET /state) can reconstruct the full start payload for clients that
  // connect AFTER GAME_STARTED was broadcast (and so never saw the one-shot).
  await r.hSet(K.game(gameId), {
    gameId, gameStatus:"running", gameMode: runMode,
    joinPolicy: g.join_policy ?? "first_question_only",
    gracePeriodMs: String(gracePeriodMs),
    questionTimeLimitSeconds: String(timeLimitSeconds),
    ...(maxWrongAnswers !== null ? { maxWrongAnswers: String(maxWrongAnswers) } : {}),
    ...(prizePoolStr !== null ? { prizePool: prizePoolStr } : {}),
    prizePoolCurrency: g.prize_pool_currency ?? "USD",
    languages: JSON.stringify(resolveTargetLanguages(g.language, g.target_languages)),
    category: g.category ?? "mixed",
    questionsCount: String(g.questions_count ?? 10),
    title: cleanTopic(g.title),
    pregameDurationMs: String(pregameDurationMs),
    ...(firstQuestionStartsAtMs !== null
      ? { firstQuestionStartsAt: String(firstQuestionStartsAtMs) } : {}),
    participantCount: "0", spectatorCount: "0",
    eliminatedUserCount: "0", redisNamespace: namespace,
  });
  await r.expire(K.game(gameId), 86400); // 24-hour safety TTL

  // Persist Redis namespace reference + warmup target to DB (§3.8)
  await dbUpdate("games", { id: gameId }, {
    status: "live", started_at: new Date(nowMs).toISOString(),
    redis_namespace: namespace, redis_cluster_id: "default",
    redis_started_at: new Date(nowMs).toISOString(),
    redis_expires_at: new Date(nowMs + 86400000).toISOString(),
    ...(firstQuestionStartsAtMs !== null
      ? { first_question_starts_at: new Date(firstQuestionStartsAtMs).toISOString() }
      : {}),
  });

  // Broadcast GAME_STARTED with warmup metadata so clients can render the
  // "Get ready! The first question is being generated…" countdown screen.
  await broadcast(roomName, {
    type: "GAME_STARTED",
    gameId,
    serverTime: nowMs,
    runMode,
    pregameDurationMs: runMode === "auto" ? PREGAME_WARMUP_MS : 0,
    firstQuestionStartsAt: firstQuestionStartsAtMs, // epoch ms; null for presenter mode
    languages: resolveTargetLanguages(g.language, g.target_languages),
    category: g.category ?? "mixed",
  }, "GAME_STARTED");

  const gameCommon = {
    id: gameId, roomName, timeLimitSeconds,
    maxQuestions: g.questions_count ?? 10,
    targetLanguages: resolveTargetLanguages(g.language, g.target_languages),
    description: cleanDescription(g.description),
    category: g.category ?? "mixed",
    difficulty: g.difficulty ?? "medium",
    gracePeriodMs, maxWrongAnswers,
  };

  if (runMode === "auto") {
    // Fully automated — pre-generate questions during the warmup so the
    // visible countdown absorbs OpenAI latency, then start the question loop.
    void prefillQueue(gameId, gameCommon);
    const remaining = Math.max(0, (firstQuestionStartsAtMs ?? nowMs) - Date.now());
    if (remaining > 0) {
      console.log(`[orchestrator] game=${gameId} pregame warmup ${remaining}ms ` +
        `(firstQuestionStartsAt=${new Date(firstQuestionStartsAtMs!).toISOString()})`);
      await new Promise(resolve => setTimeout(resolve, remaining));
    }
    await startQuestionLoop({ ...gameCommon, questionIndex: 0 });

  } else if (runMode === "presenter") {
    // Command-driven — AI Presenter sends PrepareQuestion / StartQuestion
    // Presenter identity convention: `ai-presenter-<gameId>` (override via payload.presenterId)
    const presenterIdentity: string = payload.presenterId ?? `ai-presenter-${gameId}`;

    const cfg: PresenterGameConfig = {
      ...gameCommon, gameId, presenterIdentity, currentQuestionIndex: 0,
    };
    presenterGames.set(gameId, cfg);

    // Store in Redis so the identity survives an orchestrator restart
    const r2 = await getRedis();
    await r2.hSet(K.game(gameId), "presenterIdentity", presenterIdentity);

    // Kick off background question pre-generation (§5.7)
    void prefillQueue(gameId, cfg);

    console.log(`[orchestrator] game=${gameId} presenter mode ready; ` +
      `presenterIdentity=${presenterIdentity}`);
  } else {
    console.log(`[orchestrator] game=${gameId} run_mode=${runMode} — waiting for external command`);
  }
}

async function handlePersistAnswer(payload: any): Promise<void> {
  // Async DB write for answer audit log (§9.5, §16)
  await dbInsert("game_answers", {
    id: crypto.randomUUID(),
    game_id: payload.gameId,
    question_id: payload.questionId,
    round_number: payload.questionIndex,
    selected_option_id: payload.selectedOptionId,
    correct_option_id: payload.correctOptionId,
    is_correct: payload.isCorrect,
    response_time_ms: payload.responseTimeMs,
    points_earned: payload.pointsEarned ?? 0,
    submitted_at: new Date(payload.serverReceivedAt).toISOString(),
    server_received_at: new Date(payload.serverReceivedAt).toISOString(),
    question_starts_at: payload.startsAt ? new Date(payload.startsAt).toISOString() : null,
    question_ends_at: payload.endsAt ? new Date(payload.endsAt).toISOString() : null,
    attempt_id: payload.attemptId,
    session_id: payload.sessionId || null,
    ip_address: payload.ipAddress || null,
    user_agent: payload.userAgent || null,
    user_status_before: "participant",
    user_status_after: payload.participantRole,
    wrong_count_after: payload.wrongCount,
    remaining_lives_after: payload.remainingLives,
    was_late: false, was_duplicate: false, was_no_answer: false,
    eliminated: payload.eliminated,
    elimination_reason: payload.eliminationReason || null,
  });

  // Update participant score/counters in DB (best-effort)
  if (payload.isCorrect) {
    // Using RPC-less approach: find participant and update score
    const parts = await dbSelect("game_participants",
      `game_id=eq.${payload.gameId}&user_id=eq.${payload.userId}&select=id,score,correct_answers`);
    if (parts.length) {
      const p = parts[0] as any;
      await dbUpdate("game_participants", { id: p.id }, {
        score: (p.score ?? 0) + (payload.pointsEarned ?? 0),
        correct_answers: (p.correct_answers ?? 0) + 1,
      });
    }
  } else {
    // Wrong answer — keep wrong_count and lives_remaining mirrored on the
    // game_participants row so survivor checks and analytics stay accurate.
    void dbUpdate("game_participants",
      { game_id: payload.gameId, user_id: payload.userId },
      {
        wrong_count: payload.wrongCount,
        ...(payload.remainingLives !== null && payload.remainingLives !== undefined
          ? { lives_remaining: payload.remainingLives } : {}),
      });
  }

  // Resolve `maxWrongAnswers` once from Redis for the events below (cheap HGET;
  // returns null for games without a configured limit). Used by both the
  // `PLAYER_WRONG_ANSWER` non-elim broadcast and the `PLAYER_ELIMINATED`
  // payload's `allowed_wrong_answers` field.
  let allowedWrongAnswers: number | null = null;
  if (!payload.isCorrect) {
    try {
      const r = await getRedis();
      const raw = await r.hGet(K.game(payload.gameId), "maxWrongAnswers") as string | null;
      allowedWrongAnswers = raw !== null ? parseInt(raw, 10) : null;
    } catch (_e) { /* best-effort */ }
  }

  // Domain rule: a wrong-answer elimination must mirror to Postgres + remove
  // the user from the active participants set in Redis + notify the room so
  // clients flip the eliminated player to spectator UI immediately. When the
  // wrong answer does NOT eliminate, surface a `PLAYER_WRONG_ANSWER` event so
  // the client can decrement the visible chances counter.
  if (payload.eliminated) {
    const roomName = await resolveRoomName(payload.gameId);
    await applyElimination({
      gameId: payload.gameId,
      userId: payload.userId,
      roomName,
      wrongCount: payload.wrongCount ?? 0,
      remainingLives: payload.remainingLives ?? null,
      eliminationReason: payload.eliminationReason ?? "wrong_answer",
      eliminatedAtMs: payload.serverReceivedAt ?? Date.now(),
      questionId: payload.questionId ?? null,
      questionIndex: payload.questionIndex ?? null,
      allowedWrongAnswers,
    });
  } else if (!payload.isCorrect) {
    const roomName = await resolveRoomName(payload.gameId);
    broadcastPlayerWrongAnswer(
      roomName, payload.gameId, payload.userId,
      payload.wrongCount ?? 0,
      payload.remainingLives ?? null,
      "wrong_answer",
    );
  }
}

/**
 * Late-join reconciliation (late-join missed-answer rule). The game-session
 * edge function has already charged the missed questions and written the
 * authoritative `game_participants` row inside the atomic join; this handler
 * only mirrors that decision to the room over LiveKit. We do NOT re-PATCH the
 * DB here (unlike `applyElimination`) so a late joiner who never played keeps
 * `participant_role="spectator"` rather than being relabelled "eliminated".
 *   • over the limit → USER_ELIMINATED + PLAYER_ELIMINATED (status SPECTATOR)
 *   • under the limit → PLAYER_WRONG_ANSWER carrying the pre-charged count
 */
async function handleLateJoinReconcile(payload: any): Promise<void> {
  const { gameId, userId, wrongCount, remainingLives, eliminated,
    eliminationReason, missedQuestions, questionIndex } = payload;
  const roomName = await resolveRoomName(gameId);

  if (!eliminated) {
    broadcastPlayerWrongAnswer(
      roomName, gameId, userId,
      wrongCount ?? 0, remainingLives ?? null, "late_join_missed",
    );
    return;
  }

  // Resolve allowed_wrong_answers for the spec payload (cheap HGET).
  let allowedWrongAnswers: number | null = null;
  try {
    const r = await getRedis();
    const raw = await r.hGet(K.game(gameId), "maxWrongAnswers") as string | null;
    allowedWrongAnswers = raw !== null ? parseInt(raw, 10) : null;
  } catch (_e) { /* best-effort — missing limit is non-fatal */ }

  const elimAtMs = payload.serverTime ?? Date.now();
  void broadcast(roomName, {
    type: "USER_ELIMINATED",
    gameId, userId,
    reason: eliminationReason ?? "late_join_missed",
    wrongCount: wrongCount ?? 0,
    remainingLives: remainingLives ?? 0,
    questionId: null,
    questionIndex: questionIndex ?? null,
    eliminatedAt: elimAtMs,
    serverTime: Date.now(),
  }, "USER_ELIMINATED");
  void broadcast(roomName, {
    type: "PLAYER_ELIMINATED",
    gameId, userId,
    wrongAnswersCount: wrongCount ?? 0,
    allowed_wrong_answers: allowedWrongAnswers,
    remainingChances: remainingLives ?? 0,
    status: "SPECTATOR",
    reason: reasonToSpec(eliminationReason ?? "late_join_missed"),
    lateJoin: true,
    missedQuestions: missedQuestions ?? 0,
    serverTime: Date.now(),
  }, "PLAYER_ELIMINATED");
}

// ─── Presenter command handlers ───────────────────────────────────────────────

/**
 * PrepareQuestion — generates (or dequeues) the next question, stores it in
 * Redis (staged, NOT yet active), and sends a **private** QUESTION_PREPARED
 * event to the presenter's LiveKit identity so they can read and dramatise
 * the question before revealing it to participants.
 *
 * Presenter identity resolution (highest priority wins):
 *   1. `presenterId` field in the command payload
 *   2. `presenterIdentity` stored in the presenterGames config (set at StartGame)
 *   3. Fallback: `ai-presenter-<gameId>`
 */
async function handlePrepareQuestion(payload: any): Promise<void> {
  const { gameId, questionIndex, presenterId } = payload;
  const config = presenterGames.get(gameId);
  if (!config) {
    console.error(`[orchestrator] PrepareQuestion: no presenter config for game=${gameId}. ` +
      `Ensure the game was started with run_mode='presenter'.`);
    return;
  }

  const idx: number = (questionIndex !== undefined && questionIndex !== null)
    ? Number(questionIndex) : config.currentQuestionIndex;
  const identity: string = presenterId ?? config.presenterIdentity;

  if (idx >= config.maxQuestions) {
    console.log(`[orchestrator] PrepareQuestion: game=${gameId} maxQuestions reached — finalizing`);
    await finalizeGame(gameId, config.roomName);
    return;
  }

  // Ensure at least one question in the queue
  if ((questionQueue.get(gameId) ?? []).length === 0) await prefillQueue(gameId, config);
  const queue = questionQueue.get(gameId) ?? [];
  let q = queue.shift();
  questionQueue.set(gameId, queue);
  if (!q) {
    console.error(`[orchestrator] PrepareQuestion: game=${gameId} question queue empty`);
    return;
  }

  // Resolve to a canonical, non-duplicate question (§ no-duplicate invariant)
  // — re-rolls if asked recently across the platform or already used in this
  // game; the returned id is used for Redis staging + reveal + answer matching.
  const resolved = await resolveUniqueQuestion(gameId, config, q);
  q = resolved.q;
  const questionId = resolved.id;

  // Atomically stage in Redis (idempotency guard prevents double-staging)
  const luaR = await evalLua(STAGE_Q_SCRIPT,
    [K.staged(gameId)],
    [questionId, String(idx), q.correctOptionId,
     JSON.stringify(q.localizedPayloads), q.canonicalText,
     JSON.stringify(q.options), q.explanation ?? "",
     String(q.estimatedAnswerTimeSec ?? config.timeLimitSeconds)]);
  const staged = JSON.parse(luaR as string) as { status: string; reason?: string };
  if (staged.status !== "ok") {
    console.error(`[orchestrator] PrepareQuestion stage failed for game=${gameId}: ${staged.reason}`);
    return;
  }

  // Keep full question in memory for StartQuestion broadcast (no extra Redis round-trip)
  stagedQuestions.set(gameId, { q, questionId, questionIndex: idx });

  // Update in-memory index (AdvanceQuestion reads this)
  config.currentQuestionIndex = idx;
  presenterGames.set(gameId, config);

  // Store presenterIdentity in Redis for post-restart recovery
  const r = await getRedis();
  await r.hSet(K.game(gameId), "presenterIdentity", identity);

  // Private broadcast to presenter (§13.4 — correctOptionId ONLY for presenter)
  await broadcastToIdentity(config.roomName, [identity], {
    type: "QUESTION_PREPARED",
    gameId, questionId, questionIndex: idx,
    canonicalText: q.canonicalText,
    options: q.options,
    correctOptionId: q.correctOptionId,
    explanation: q.explanation ?? "",
    estimatedAnswerTimeSec: q.estimatedAnswerTimeSec ?? config.timeLimitSeconds,
    localizedPayloads: q.localizedPayloads,
    serverTime: Date.now(),
  }, "QUESTION_PREPARED");

  console.log(`[orchestrator] PrepareQuestion game=${gameId} q=${idx} staged; ` +
    `private QUESTION_PREPARED → ${identity}`);

  // Background: keep queue topped up for the question after next
  void prefillQueue(gameId, config);
}

/**
 * StartQuestion — promotes the staged question to `active`.
 * Runs ACTIVATE_Q_SCRIPT atomically, then broadcasts QUESTION_STARTED to ALL
 * participants (without correctOptionId), and arms the auto-close timer.
 */
async function handleStartQuestion(payload: any): Promise<void> {
  const { gameId, questionIndex, timeLimitSeconds: cmdLimit } = payload;
  const config = presenterGames.get(gameId);
  if (!config) {
    console.error(`[orchestrator] StartQuestion: no presenter config for game=${gameId}`);
    return;
  }
  const staged = stagedQuestions.get(gameId);
  if (!staged) {
    console.error(`[orchestrator] StartQuestion: no staged question for game=${gameId}. ` +
      `Send PrepareQuestion first.`);
    return;
  }

  const idx = questionIndex ?? staged.questionIndex;
  const timeLimit = cmdLimit ?? config.timeLimitSeconds;
  const now = Date.now();
  const endsAt = now + timeLimit * 1000;

  // Atomically activate: staged → question state + game state
  const luaR = await evalLua(ACTIVATE_Q_SCRIPT,
    [K.game(gameId), K.staged(gameId), K.q(gameId, idx)],
    [String(now), String(endsAt), String(config.gracePeriodMs)]);
  const result = JSON.parse(luaR as string) as { status: string; reason?: string };
  if (result.status !== "ok") {
    console.error(`[orchestrator] StartQuestion activate failed for game=${gameId}: ${result.reason}`);
    return;
  }

  const { q, questionId } = staged;
  stagedQuestions.delete(gameId);

  // Public broadcast — no correctOptionId (§13.4)
  await broadcast(config.roomName, {
    type: "QUESTION_STARTED",
    gameId, questionId, questionIndex: idx,
    questionText: q.canonicalText,
    options: q.options,
    primaryLanguage: config.targetLanguages[0] ?? "en",
    languages: config.targetLanguages,
    localizedPayloads: q.localizedPayloads,
    startsAt: now, endsAt, timeLimitSeconds: timeLimit,
    serverTime: now,
  }, "QUESTION_STARTED");

  console.log(`[orchestrator] StartQuestion game=${gameId} q=${idx} active; endsAt=${endsAt}`);

  // Arm auto-close timer (presenter can also send CloseQuestion to close early)
  const gameParams = {
    id: gameId, roomName: config.roomName, timeLimitSeconds: timeLimit,
    maxQuestions: config.maxQuestions, targetLanguages: config.targetLanguages,
    description: config.description, category: config.category, difficulty: config.difficulty,
    gracePeriodMs: config.gracePeriodMs, maxWrongAnswers: config.maxWrongAnswers,
  };
  const timer = setTimeout(() => {
    closeQuestion(gameParams, idx).catch(e =>
      console.error(`[orchestrator] game=${gameId} presenter closeQuestion q=${idx} CRASH:`,
        e instanceof Error ? (e.stack ?? e.message) : String(e))
    );
  }, timeLimit * 1000 + config.gracePeriodMs + 50);
  closeTimers.set(gameId, timer);

  // Advance internal index so the next PrepareQuestion/AdvanceQuestion uses idx+1
  config.currentQuestionIndex = idx + 1;
  presenterGames.set(gameId, config);
}

/**
 * CloseQuestion — forces an early close of the currently active question.
 * Cancels the scheduled auto-close timer and runs the same CLOSE_Q_SCRIPT /
 * QUESTION_CLOSED flow as the automatic timer path.
 */
async function handleCloseQuestion(payload: any): Promise<void> {
  const { gameId, questionIndex } = payload;
  const config = presenterGames.get(gameId);
  if (!config) {
    console.error(`[orchestrator] CloseQuestion: no presenter config for game=${gameId}`);
    return;
  }

  // Cancel pending auto-close timer to avoid double-close
  const timer = closeTimers.get(gameId);
  if (timer) { clearTimeout(timer); closeTimers.delete(gameId); }

  // Resolve current question index
  let idx: number = questionIndex;
  if (idx === undefined || idx === null) {
    const r = await getRedis();
    const raw = await r.hGet(K.game(gameId), "currentQuestionIndex") as string | null;
    idx = raw !== null ? parseInt(raw, 10) : Math.max(0, config.currentQuestionIndex - 1);
  }

  const gameParams = {
    id: gameId, roomName: config.roomName,
    timeLimitSeconds: config.timeLimitSeconds,
    maxQuestions: config.maxQuestions, targetLanguages: config.targetLanguages,
    description: config.description, category: config.category, difficulty: config.difficulty,
    gracePeriodMs: config.gracePeriodMs, maxWrongAnswers: config.maxWrongAnswers,
  };

  console.log(`[orchestrator] CloseQuestion (early) game=${gameId} q=${idx}`);
  await closeQuestion(gameParams, idx);
}

/**
 * AdvanceQuestion — convenience command that atomically combines
 * PrepareQuestion + StartQuestion in one step.  Useful for rapid-fire rounds
 * where the presenter does not need a preview window.
 */
async function handleAdvanceQuestion(payload: any): Promise<void> {
  const { gameId, timeLimitSeconds, correlationId, publishedAt } = payload;
  const config = presenterGames.get(gameId);
  if (!config) {
    console.error(`[orchestrator] AdvanceQuestion: no presenter config for game=${gameId}`);
    return;
  }

  const idx = config.currentQuestionIndex;
  if (idx >= config.maxQuestions) {
    console.log(`[orchestrator] AdvanceQuestion: game=${gameId} maxQuestions reached — finalizing`);
    await finalizeGame(gameId, config.roomName);
    return;
  }

  console.log(`[orchestrator] AdvanceQuestion game=${gameId} q=${idx} (prepare+start)`);
  await handlePrepareQuestion({ gameId, questionIndex: idx, correlationId, publishedAt });
  // Brief yield so the DB persist and Redis write settle before activating
  await new Promise(resolve => setTimeout(resolve, 150));
  await handleStartQuestion({ gameId, questionIndex: idx, timeLimitSeconds, correlationId, publishedAt });
}

// ─── AMQP consumer ───────────────────────────────────────────────────────────

async function startConsumer(): Promise<void> {
  const decoder = new TextDecoder();

  while (true) {
    try {
      console.log("[orchestrator] connecting to RabbitMQ…");
      const conn = await connect(RABBITMQ_URL);
      const ch   = await conn.openChannel();

      await ch.qos({ prefetchCount: 1 });
      await ch.declareQueue({ queue: MQ_QUEUE, durable: true });
      console.log(`[orchestrator] consuming queue=${MQ_QUEUE}`);

      await ch.consume({ queue: MQ_QUEUE, noAck: false }, (args, _props, data) => {
        const body = decoder.decode(data);
        (async () => {
          try {
            const payload = JSON.parse(body) as any;
            const type: string = payload.type ?? "";
            console.log(`[orchestrator] received type=${type} gameId=${payload.gameId ?? "-"}`);

            switch (type) {
              case "StartGame":             await handleStartGame(payload); break;
              case "FinalizeGame": {
                const roomName = payload.livekitRoomName ?? `quiz-${payload.gameId}`;
                await finalizeGame(payload.gameId, roomName);
                break;
              }
              case "PrepareQuestion":          await handlePrepareQuestion(payload); break;
              case "StartQuestion":            await handleStartQuestion(payload); break;
              case "CloseQuestion":            await handleCloseQuestion(payload); break;
              case "AdvanceQuestion":          await handleAdvanceQuestion(payload); break;
              case "ANSWER_PERSIST_REQUESTED": await handlePersistAnswer(payload); break;
              case "LATE_JOIN_RECONCILE":      await handleLateJoinReconcile(payload); break;
              default: console.warn(`[orchestrator] unknown message type: ${type}`);
            }

            await ch.ack({ deliveryTag: args.deliveryTag });
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            console.error("[orchestrator] message handler error:", errMsg);
            // requeue=false → dead-letter on repeated failure (same as before)
            await ch.nack({ deliveryTag: args.deliveryTag, requeue: false });
          }
        })();
      });

      // Block until the broker closes the channel/connection.
      await ch.closed();
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error("[orchestrator] RabbitMQ error, reconnecting in 5 s:", errMsg);
      await new Promise<void>(r => setTimeout(r, 5_000));
    }
  }
}

// ─── Recovery: pick up running games on restart (§15.2) ──────────────────────

async function recoverRunningGames(): Promise<void> {
  const games = await dbSelect("games",
    `status=eq.live&select=id,title,description,livekit_room_name,time_per_question,allowed_wrong_answers,` +
    `grace_period_ms,questions_count,language,target_languages,category,difficulty,run_mode,` +
    `started_at,first_question_starts_at,prize_pool,prize_pool_currency`);
  if (!games.length) { console.log("[orchestrator] no running games to recover"); return; }
  console.log(`[orchestrator] recovering ${games.length} running game(s)`);

  for (const g of games as any[]) {
    const r = await getRedis();
    const qIdxRaw  = await r.hGet(K.game(g.id), "currentQuestionIndex") as string | null;
    const qStatus  = await r.hGet(K.game(g.id), "currentQuestionStatus") as string | null;
    const runMode: string = g.run_mode ?? "auto";
    const grace     = g.grace_period_ms ?? 400;
    const roomName: string = g.livekit_room_name ?? `quiz-${g.id}`;
    // Back-fill prizePool in Redis if it was missing (e.g. set before this fix,
    // or Redis key expired and was re-initialized without it).
    if (g.prize_pool != null) {
      const existingPrize = await r.hGet(K.game(g.id), "prizePool") as string | null;
      if (!existingPrize) {
        await r.hSet(K.game(g.id), { prizePool: String(g.prize_pool) });
      }
    }
    // Back-fill the static GAME_STARTED fields (games started before this fix,
    // or after the 24h TTL expiry) so the game-session snapshot stays complete
    // for clients that (re)connect after a recovery.
    const existingLangs = await r.hGet(K.game(g.id), "languages") as string | null;
    if (!existingLangs) {
      const firstQAtMs = g.first_question_starts_at
        ? Date.parse(g.first_question_starts_at as string) : NaN;
      await r.hSet(K.game(g.id), {
        prizePoolCurrency: g.prize_pool_currency ?? "USD",
        languages: JSON.stringify(resolveTargetLanguages(g.language, g.target_languages)),
        category: g.category ?? "mixed",
        questionsCount: String(g.questions_count ?? 10),
        title: cleanTopic(g.title),
        pregameDurationMs: String(runMode === "auto" ? PREGAME_WARMUP_MS : 0),
        ...(Number.isFinite(firstQAtMs)
          ? { firstQuestionStartsAt: String(firstQAtMs) } : {}),
      });
    }
    gameRoomNames.set(g.id, roomName);
    const gameCommon = {
      id: g.id, roomName,
      timeLimitSeconds: g.time_per_question ?? 10,
      maxQuestions: g.questions_count ?? 10,
      targetLanguages: resolveTargetLanguages(g.language, g.target_languages),
      description: cleanDescription(g.description),
      category: g.category ?? "mixed",
      difficulty: g.difficulty ?? "medium",
      gracePeriodMs: grace,
      maxWrongAnswers: g.allowed_wrong_answers ?? null,
    };

    // ── Presenter-mode recovery ─────────────────────────────────────────────
    if (runMode === "presenter") {
      const presenterIdentity =
        (await r.hGet(K.game(g.id), "presenterIdentity") as string | null)
        ?? `ai-presenter-${g.id}`;
      const nextIdx = qIdxRaw !== null ? parseInt(qIdxRaw, 10) + 1 : 0;

      const cfg: PresenterGameConfig = {
        ...gameCommon, gameId: g.id, presenterIdentity,
        currentQuestionIndex: nextIdx,
      };
      presenterGames.set(g.id, cfg);

      // Re-arm close timer if a question was active when we went down
      if (qStatus === "active" && qIdxRaw !== null) {
        const idx = parseInt(qIdxRaw, 10);
        const endsAtRaw = await r.hGet(K.game(g.id), "currentQuestionEndsAt") as string | null;
        const deadline = endsAtRaw ? parseInt(endsAtRaw, 10) + grace + 50 : Date.now() + 1000;
        const remaining = Math.max(0, deadline - Date.now());
        const timer = setTimeout(() => { void closeQuestion(gameCommon, idx); }, remaining);
        closeTimers.set(g.id, timer);
        console.log(`[orchestrator] recovered presenter game=${g.id} q=${idx} ` +
          `timer=${remaining}ms identity=${presenterIdentity}`);
      }

      // If staged question exists in Redis, rebuild stagedQuestions map
      const stagId = await r.hGet(K.staged(g.id), "questionId") as string | null;
      if (stagId) {
        const stagIdx   = await r.hGet(K.staged(g.id), "questionIndex") as string | null;
        const correctOpt= await r.hGet(K.staged(g.id), "correctOptionId") as string | null;
        const canonical = await r.hGet(K.staged(g.id), "canonicalText") as string | null;
        const optsRaw   = await r.hGet(K.staged(g.id), "optionsJson") as string | null;
        const locRaw    = await r.hGet(K.staged(g.id), "localizedPayload") as string | null;
        const expl      = await r.hGet(K.staged(g.id), "explanation") as string | null;
        const estTime   = await r.hGet(K.staged(g.id), "estimatedAnswerTimeSec") as string | null;

        if (canonical && optsRaw && correctOpt) {
          stagedQuestions.set(g.id, {
            questionId: stagId,
            questionIndex: stagIdx ? parseInt(stagIdx, 10) : 0,
            q: {
              canonicalText: canonical,
              options: JSON.parse(optsRaw) as Array<{id:string;text:string}>,
              correctOptionId: correctOpt,
              localizedPayloads: locRaw ? JSON.parse(locRaw) : [],
              explanation: expl ?? "",
              estimatedAnswerTimeSec: estTime ? parseInt(estTime, 10) : 10,
              safetyFlags: [],
            },
          });
          console.log(`[orchestrator] recovered staged question for game=${g.id}`);
        }
      }

      // Resume background question pre-generation
      void prefillQueue(g.id, cfg);
      continue;
    }

    // ── Auto-mode recovery ──────────────────────────────────────────────────
    if (qStatus === "active" && qIdxRaw !== null) {
      // Question is mid-flight — re-arm the close timer.
      const endsAtRaw = await r.hGet(K.game(g.id), "currentQuestionEndsAt") as string | null;
      const deadline = endsAtRaw ? parseInt(endsAtRaw, 10) + grace + 50 : Date.now() + 1000;
      const remaining = Math.max(0, deadline - Date.now());
      const idx = parseInt(qIdxRaw, 10);
      const timer = setTimeout(() => {
        closeQuestion(gameCommon, idx).catch(e =>
          console.error(`[orchestrator] game=${g.id} recovery closeQuestion q=${idx} CRASH:`,
            e instanceof Error ? (e.stack ?? e.message) : String(e))
        );
      }, remaining);
      closeTimers.set(g.id, timer);
      console.log(`[orchestrator] recovered auto game=${g.id} q=${idx} remaining=${remaining}ms`);
    } else if (qStatus === "closed" && qIdxRaw !== null) {
      // Question window ended and was closed (CLOSE_Q_SCRIPT ran) but the
      // advance-to-next timer never fired — the orchestrator was recreated
      // in the gap between closeQuestion finishing and advanceQuestion(idx+1)
      // being called. Resume from the next question immediately.
      const nextIdx = parseInt(qIdxRaw, 10) + 1;
      console.warn(`[orchestrator] recovering auto game=${g.id} — q${qIdxRaw} closed but q${nextIdx} never started; advancing now`);
      startQuestionLoop({ ...gameCommon, questionIndex: nextIdx }).catch(e =>
        console.error(`[orchestrator] game=${g.id} recovery startQuestionLoop q=${nextIdx} CRASH:`,
          e instanceof Error ? (e.stack ?? e.message) : String(e))
      );
    } else if (qIdxRaw === null) {
      // Live but question 0 never started — the orchestrator was recreated
      // during the pregame warmup (or the first question failed). Honor any
      // remaining warmup so clients still see a synchronized countdown, and
      // re-broadcast GAME_STARTED with the original target instant so late
      // joiners / reconnects can align.
      const firstQAt = g.first_question_starts_at
        ? Date.parse(g.first_question_starts_at as string)
        : NaN;
      const remaining = Number.isFinite(firstQAt) ? firstQAt - Date.now() : 0;
      console.warn(`[orchestrator] recovering auto game=${g.id} live with no question yet ` +
        `— remaining warmup=${Math.max(0, remaining)}ms`);

      // Re-broadcast GAME_STARTED so clients that lost the original event can
      // re-synchronize the countdown. Best-effort; failures are logged inside
      // broadcast().
      void broadcast(g.livekit_room_name ?? `quiz-${g.id}`, {
        type: "GAME_STARTED",
        gameId: g.id,
        serverTime: Date.now(),
        runMode: "auto",
        pregameDurationMs: PREGAME_WARMUP_MS,
        firstQuestionStartsAt: Number.isFinite(firstQAt) ? firstQAt : null,
        recovered: true,
        languages: resolveTargetLanguages(g.language, g.target_languages),
        category: g.category ?? "mixed",
      }, "GAME_STARTED");

      // Pre-generate questions while waiting out the remaining warmup.
      void prefillQueue(g.id, gameCommon);

      const startLoop = () => startQuestionLoop({ ...gameCommon, questionIndex: 0 }).catch(e =>
        console.error(`[orchestrator] game=${g.id} recovery startQuestionLoop q=0 CRASH:`,
          e instanceof Error ? (e.stack ?? e.message) : String(e)));
      if (remaining > 0) {
        setTimeout(startLoop, remaining);
      } else {
        startLoop();
      }
    }
  }
}

// ─── Entry point ─────────────────────────────────────────────────────────────

let shuttingDown = false;
const shutdown = (sig: string) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[orchestrator] received ${sig}, shutting down…`);
  Deno.exit(0);
};
Deno.addSignalListener("SIGTERM", () => shutdown("SIGTERM"));
Deno.addSignalListener("SIGINT",  () => shutdown("SIGINT"));

// ─── Global safety net: log unhandled rejections instead of crashing ─────────
// Any `void asyncFn()` that throws would otherwise kill the Deno process.
// This handler logs the error and prevents the exit so the game loop continues.
globalThis.addEventListener("unhandledrejection", (event) => {
  event.preventDefault();
  const reason = event.reason;
  console.error(
    "[orchestrator] UNHANDLED REJECTION (process kept alive):",
    reason instanceof Error ? (reason.stack ?? reason.message) : String(reason),
  );
});

console.log("[orchestrator] starting…");
await recoverRunningGames();
await startConsumer();
await new Promise(() => {}); // keep alive


