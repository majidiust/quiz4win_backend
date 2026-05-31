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

import { connect as amqpConnect } from "npm:amqplib@0.10.4";
import { createClient } from "npm:redis@4";

// ─── Config ──────────────────────────────────────────────────────────────────

const REDIS_URL       = Deno.env.get("REDIS_URL") ?? "redis://127.0.0.1:6379";
const RABBITMQ_URL    = Deno.env.get("RABBITMQ_URL") ?? "";
const MQ_QUEUE        = Deno.env.get("MQ_ORCHESTRATOR_QUEUE") ?? "quiz.game.commands";
const SUPABASE_URL    = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_KEY     = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const OPENAI_KEY      = Deno.env.get("OPENAI_API_KEY") ?? "";
const OPENAI_MODEL    = Deno.env.get("OPENAI_MODEL") ?? "gpt-4o-mini";
const LK_URL          = Deno.env.get("LIVEKIT_SERVER_URL") ?? "";
const LK_KEY          = Deno.env.get("LIVEKIT_API_KEY") ?? "";
const LK_SECRET       = Deno.env.get("LIVEKIT_API_SECRET") ?? "";

if (!RABBITMQ_URL) { console.error("[orchestrator] FATAL: RABBITMQ_URL required"); Deno.exit(1); }
if (!SUPABASE_URL || !SERVICE_KEY) { console.error("[orchestrator] FATAL: SUPABASE_* required"); Deno.exit(1); }

// ─── Redis key namespace (mirrors supabase/functions/_shared/redis_keys.ts) ──

const NS = "q4w";
const K = {
  game:      (id: string)              => `${NS}:game:${id}:state`,
  q:         (id: string, i: number)   => `${NS}:game:${id}:q:${i}:state`,
  user:      (id: string, u: string)   => `${NS}:game:${id}:u:${u}:state`,
  parts:     (id: string)              => `${NS}:game:${id}:participants`,
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

async function dbSelect(table: string, qs: string): Promise<any[]> {
  const res = await fetch(`${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/${table}?${qs}`, {
    headers: {
      "apikey": SERVICE_KEY,
      "Authorization": `Bearer ${SERVICE_KEY}`,
      "Accept": "application/json",
    },
  });
  if (!res.ok) return [];
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
  const data = new TextEncoder().encode(JSON.stringify({ topic, ...event }));
  const body = { room:roomName, data:btoa(String.fromCharCode(...data)), kind:1, topic };
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
  const data = new TextEncoder().encode(JSON.stringify({ topic, ...event }));
  const body = {
    room: roomName,
    data: btoa(String.fromCharCode(...data)),
    kind: 1,
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

async function generateQuestion(params: {
  topic?: string; category?: string; difficulty?: string;
  targetLanguages: string[]; timeLimitSeconds?: number;
}): Promise<GenQuestion> {
  if (!OPENAI_KEY) throw new Error("OPENAI_API_KEY not set");
  const sys = `You are a multilingual quiz question generator.
Rules:
- Generate ONE question with FOUR options: A, B, C, D.
- Option IDs are IDENTICAL across all languages.
- Exactly one correct answer.
- Avoid political/hate/sexual/religious/illegal/ambiguous content.
- Output ONLY valid JSON, no markdown.

Schema: {"canonicalText":"","options":[{"id":"A","text":""},...],"correctOptionId":"A",
"localizedPayloads":[{"language":"en","questionText":"","options":[{"id":"A","text":""},...]},...]
,"explanation":"","estimatedAnswerTimeSec":10,"safetyFlags":[]}`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method:"POST",
    headers:{"Content-Type":"application/json","Authorization":`Bearer ${OPENAI_KEY}`},
    body: JSON.stringify({
      model: OPENAI_MODEL, temperature:0.7, max_tokens:1500,
      response_format:{type:"json_object"},
      messages:[
        {role:"system",content:sys},
        {role:"user",content:JSON.stringify({...params})},
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}`);
  const json = await res.json() as any;
  const parsed = JSON.parse(json.choices[0].message.content) as GenQuestion;
  if (!["A","B","C","D"].includes(parsed.correctOptionId)) throw new Error("Invalid correctOptionId");
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
  topic: string;
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

/**
 * Keeps the per-game question queue filled to 3 entries (§5.7 pre-generation).
 * Module-level so it can be called from both auto-mode loop and presenter mode.
 */
async function prefillQueue(gameId: string, config: {
  topic: string; category: string; difficulty: string;
  targetLanguages: string[]; timeLimitSeconds: number;
}): Promise<void> {
  const queue = questionQueue.get(gameId) ?? [];
  while (queue.length < 3) {
    try {
      const q = await generateQuestion({
        topic: config.topic, category: config.category,
        difficulty: config.difficulty, targetLanguages: config.targetLanguages,
        timeLimitSeconds: config.timeLimitSeconds,
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

async function startQuestionLoop(game: {
  id: string; roomName: string; questionIndex: number;
  timeLimitSeconds: number; maxQuestions: number;
  targetLanguages: string[]; topic: string; category: string; difficulty: string;
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
    const q = queue.shift();
    questionQueue.set(gameId, queue);
    if (!q) {
      console.warn(`[orchestrator] game=${gameId} no question available at idx=${idx} — finalizing`);
      await finalizeGame(gameId, roomName);
      return;
    }

    // Persist question to DB (async — non-blocking)
    const dbQuestionId = crypto.randomUUID();
    void dbInsert("questions", {
      id: dbQuestionId, text: q.canonicalText,
      options: q.options.map(o => o.text),
      option_ids: q.options.map(o => o.id),
      correct_option_id: q.correctOptionId,
      correct_index: q.options.findIndex(o => o.id === q.correctOptionId),
      localized: q.localizedPayloads, validated: true,
      category: game.category, difficulty: game.difficulty, language: "en",
    });

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
      console.error(`[orchestrator] game=${gameId} prepare_question failed:`, luaR);
      return;
    }

    // Broadcast QUESTION_STARTED (without correctOptionId — §13.4)
    await broadcast(roomName, {
      type: "QUESTION_STARTED",
      gameId, questionId: dbQuestionId, questionIndex: idx,
      questionText: q.canonicalText, options: q.options,
      localizedPayloads: q.localizedPayloads.map(lp => ({...lp, options: lp.options})),
      startsAt: now, endsAt, timeLimitSeconds, serverTime: now,
    }, "QUESTION_STARTED");

    console.log(`[orchestrator] game=${gameId} question ${idx} started endsAt=${endsAt}`);

    // Schedule close after the answer window + grace
    const closeDelay = timeLimitSeconds * 1000 + gracePeriodMs + 50;
    const timer = setTimeout(() => { void closeQuestion(game, idx); }, closeDelay);
    closeTimers.set(gameId, timer);

    // Kick off next pre-generation in the background
    void prefill();
  };

  await advanceQuestion(game.questionIndex);
}

async function closeQuestion(game: {
  id: string; roomName: string; timeLimitSeconds: number;
  maxQuestions: number; targetLanguages: string[];
  topic: string; category: string; difficulty: string;
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

  // Handle no-answer eliminations (§10.2)
  const maxWrong = game.maxWrongAnswers;
  for (const userId of (closeResult.notAnswered ?? [])) {
    const userKey = K.user(gameId, userId);
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

  // Broadcast QUESTION_CLOSED with the correct answer revealed (§13.4 after close)
  await broadcast(roomName, {
    type: "QUESTION_CLOSED", gameId,
    questionId: closeResult.questionId, questionIndex: idx,
    correctOptionId: correctOpt,
    noAnswerCount: closeResult.notAnswered?.length ?? 0,
    closedAt: now, serverTime: now,
  }, "QUESTION_CLOSED");

  console.log(`[orchestrator] game=${gameId} question ${idx} closed; notAnswered=${closeResult.notAnswered?.length ?? 0}`);

  // In auto mode: pause 3 s then advance to the next question automatically.
  // In presenter mode: wait for the next PrepareQuestion / AdvanceQuestion command.
  if (!presenterGames.has(gameId)) {
    setTimeout(() => {
      void startQuestionLoop({...game, questionIndex: idx + 1});
    }, 3000);
  } else {
    console.log(`[orchestrator] game=${gameId} presenter mode — q=${idx} closed; ` +
      `waiting for PrepareQuestion or AdvanceQuestion`);
  }
}

async function finalizeGame(gameId: string, roomName: string): Promise<void> {
  console.log(`[orchestrator] game=${gameId} finalizing`);
  const now = new Date().toISOString();
  await dbUpdate("games", { id: gameId }, { status: "finished", finished_at: now });
  await broadcast(roomName, { type:"GAME_ENDED", gameId, serverTime:Date.now() }, "GAME_ENDED");
  // Expire Redis keys after 1 hour (§15.1 — TTLs to avoid stale state)
  const r = await getRedis();
  await r.expire(K.game(gameId), 3600);
  questionQueue.delete(gameId);
  presenterGames.delete(gameId);
  stagedQuestions.delete(gameId);
}

// ─── RabbitMQ message handlers ────────────────────────────────────────────────

async function handleStartGame(payload: any): Promise<void> {
  const { gameId } = payload;
  console.log(`[orchestrator] StartGame gameId=${gameId}`);

  // Fetch game config from DB
  const rows = await dbSelect("games",
    `id=eq.${gameId}&select=id,title,status,run_mode,livekit_room_name,time_per_question,` +
    `allowed_wrong_answers,grace_period_ms,join_policy,total_questions,language,category,difficulty`);
  if (!rows.length) { console.error(`[orchestrator] StartGame: game ${gameId} not found`); return; }
  const g = rows[0] as any;

  const roomName: string = g.livekit_room_name ?? `quiz-${gameId}`;
  const timeLimitSeconds: number = g.time_per_question ?? 10;
  const gracePeriodMs: number = g.grace_period_ms ?? 400;
  const maxWrongAnswers: number | null = g.allowed_wrong_answers ?? null;
  const namespace = `q4w:game:${gameId}`;

  // Initialise Redis game state (§18.1 — Orchestrator initializes namespace)
  const r = await getRedis();
  await r.hSet(K.game(gameId), {
    gameId, gameStatus:"running", gameMode: g.run_mode ?? "auto",
    joinPolicy: g.join_policy ?? "first_question_only",
    gracePeriodMs: String(gracePeriodMs),
    questionTimeLimitSeconds: String(timeLimitSeconds),
    ...(maxWrongAnswers !== null ? { maxWrongAnswers: String(maxWrongAnswers) } : {}),
    participantCount: "0", spectatorCount: "0",
    eliminatedUserCount: "0", redisNamespace: namespace,
  });
  await r.expire(K.game(gameId), 86400); // 24-hour safety TTL

  // Persist Redis namespace reference to DB (§3.8)
  await dbUpdate("games", { id: gameId }, {
    status: "live", started_at: new Date().toISOString(),
    redis_namespace: namespace, redis_cluster_id: "default",
    redis_started_at: new Date().toISOString(),
    redis_expires_at: new Date(Date.now() + 86400000).toISOString(),
  });

  // Broadcast GAME_STARTED
  await broadcast(roomName, { type:"GAME_STARTED", gameId, serverTime:Date.now() }, "GAME_STARTED");

  const runMode: string = g.run_mode ?? "auto";
  const gameCommon = {
    id: gameId, roomName, timeLimitSeconds,
    maxQuestions: g.total_questions ?? 10,
    targetLanguages: [g.language ?? "en"],
    topic: g.title ?? "general knowledge",
    category: g.category ?? "mixed",
    difficulty: g.difficulty ?? "medium",
    gracePeriodMs, maxWrongAnswers,
  };

  if (runMode === "auto") {
    // Fully automated — start question loop immediately
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
  }
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
  const q = queue.shift();
  questionQueue.set(gameId, queue);
  if (!q) {
    console.error(`[orchestrator] PrepareQuestion: game=${gameId} question queue empty`);
    return;
  }

  const questionId = crypto.randomUUID();

  // Persist question row to DB (non-blocking — audit trail)
  void dbInsert("questions", {
    id: questionId, text: q.canonicalText,
    options: q.options.map(o => o.text),
    option_ids: q.options.map(o => o.id),
    correct_option_id: q.correctOptionId,
    correct_index: q.options.findIndex(o => o.id === q.correctOptionId),
    localized: q.localizedPayloads, validated: true,
    category: config.category, difficulty: config.difficulty, language: "en",
  });

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
    localizedPayloads: q.localizedPayloads,
    startsAt: now, endsAt, timeLimitSeconds: timeLimit,
    serverTime: now,
  }, "QUESTION_STARTED");

  console.log(`[orchestrator] StartQuestion game=${gameId} q=${idx} active; endsAt=${endsAt}`);

  // Arm auto-close timer (presenter can also send CloseQuestion to close early)
  const gameParams = {
    id: gameId, roomName: config.roomName, timeLimitSeconds: timeLimit,
    maxQuestions: config.maxQuestions, targetLanguages: config.targetLanguages,
    topic: config.topic, category: config.category, difficulty: config.difficulty,
    gracePeriodMs: config.gracePeriodMs, maxWrongAnswers: config.maxWrongAnswers,
  };
  const timer = setTimeout(() => { void closeQuestion(gameParams, idx); },
    timeLimit * 1000 + config.gracePeriodMs + 50);
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
    topic: config.topic, category: config.category, difficulty: config.difficulty,
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

// ─── AMQP consumer ────────────────────────────────────────────────────────────

async function startConsumer(): Promise<void> {
  console.log("[orchestrator] connecting to RabbitMQ…");
  const conn = await amqpConnect(RABBITMQ_URL);
  const channel = await conn.createChannel();
  await channel.assertQueue(MQ_QUEUE, { durable: true });
  await channel.prefetch(1);

  console.log(`[orchestrator] consuming queue=${MQ_QUEUE}`);

  channel.consume(MQ_QUEUE, async (msg: any) => {
    if (!msg) return;
    try {
      const payload = JSON.parse(msg.content.toString()) as any;
      const type: string = payload.type ?? "";
      console.log(`[orchestrator] received type=${type} gameId=${payload.gameId ?? "-"}`);

      switch (type) {
        // ── Lifecycle ──────────────────────────────────────────────────────────
        case "StartGame":
          await handleStartGame(payload);
          break;
        case "FinalizeGame": {
          const roomName = payload.livekitRoomName ?? `quiz-${payload.gameId}`;
          await finalizeGame(payload.gameId, roomName);
          break;
        }
        // ── Presenter-driven question flow ─────────────────────────────────────
        case "PrepareQuestion":
          await handlePrepareQuestion(payload);
          break;
        case "StartQuestion":
          await handleStartQuestion(payload);
          break;
        case "CloseQuestion":
          await handleCloseQuestion(payload);
          break;
        case "AdvanceQuestion":
          await handleAdvanceQuestion(payload);
          break;
        // ── Internal async events ──────────────────────────────────────────────
        case "ANSWER_PERSIST_REQUESTED":
          await handlePersistAnswer(payload);
          break;
        default:
          console.warn(`[orchestrator] unknown message type: ${type}`);
      }

      channel.ack(msg);
    } catch (err) {
      const msg2 = err instanceof Error ? err.message : String(err);
      console.error("[orchestrator] message handler error:", msg2);
      channel.nack(msg, false, false); // dead-letter on repeated failure
    }
  });
}

// ─── Recovery: pick up running games on restart (§15.2) ──────────────────────

async function recoverRunningGames(): Promise<void> {
  const games = await dbSelect("games",
    `status=eq.live&select=id,title,livekit_room_name,time_per_question,allowed_wrong_answers,` +
    `grace_period_ms,total_questions,language,category,difficulty,run_mode`);
  if (!games.length) { console.log("[orchestrator] no running games to recover"); return; }
  console.log(`[orchestrator] recovering ${games.length} running game(s)`);

  for (const g of games as any[]) {
    const r = await getRedis();
    const qIdxRaw  = await r.hGet(K.game(g.id), "currentQuestionIndex") as string | null;
    const qStatus  = await r.hGet(K.game(g.id), "currentQuestionStatus") as string | null;
    const runMode: string = g.run_mode ?? "auto";
    const grace     = g.grace_period_ms ?? 400;
    const roomName: string = g.livekit_room_name ?? `quiz-${g.id}`;
    const gameCommon = {
      id: g.id, roomName,
      timeLimitSeconds: g.time_per_question ?? 10,
      maxQuestions: g.total_questions ?? 10,
      targetLanguages: [g.language ?? "en"],
      topic: g.title ?? "general knowledge",
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
      const endsAtRaw = await r.hGet(K.game(g.id), "currentQuestionEndsAt") as string | null;
      const deadline = endsAtRaw ? parseInt(endsAtRaw, 10) + grace + 50 : Date.now() + 1000;
      const remaining = Math.max(0, deadline - Date.now());
      const idx = parseInt(qIdxRaw, 10);
      const timer = setTimeout(() => { void closeQuestion(gameCommon, idx); }, remaining);
      closeTimers.set(g.id, timer);
      console.log(`[orchestrator] recovered auto game=${g.id} q=${idx} remaining=${remaining}ms`);
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

console.log("[orchestrator] starting…");
await recoverRunningGames();
await startConsumer();
await new Promise(() => {}); // keep alive


