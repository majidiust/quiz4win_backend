#!/usr/bin/env node
/**
 * Quiz4Win — Test Participant (end-to-end bot)
 *
 * Joins a live game, connects to its LiveKit room (so the room actually exists
 * and the orchestrator's broadcasts stop returning 404), listens for
 * QUESTION_STARTED events on the data channel, and submits a RANDOM answer for
 * every question via POST /game-session/:id/answer.
 *
 * A GET /game-session/:id/state poll runs alongside as a fallback so the bot
 * still answers if a data message is missed (or if run with --no-livekit).
 *
 * ── Setup ────────────────────────────────────────────────────────────────────
 *   cd deploy/test-participant
 *   set -a && source ../../.env && set +a   # SUPABASE_URL, keys, LIVEKIT_SERVER_URL
 *   npm install
 *
 * ── Run ──────────────────────────────────────────────────────────────────────
 *   # When running against the custom API server (not Supabase Edge Functions):
 *   node participant.mjs --game <GAME_ID> --api-url https://api.quiz4win.com
 *   node participant.mjs --game <GAME_ID> --api-url https://api.quiz4win.com --bots 5
 *   node participant.mjs --game <GAME_ID> --api-url https://api.quiz4win.com --no-livekit
 *
 *   # When running against a real Supabase project (functions deployed there):
 *   node participant.mjs --game <GAME_ID>
 *
 * Required env : SUPABASE_URL, SUPABASE_ANON_KEY, LIVEKIT_SERVER_URL
 * Optional env : SUPABASE_SERVICE_ROLE_KEY (auto-creates the test user if sign-in fails)
 * Optional arg : --api-url <URL>  Override the API base URL (bypasses the supabase.co detection)
 */

import process from "node:process";
import { randomUUID } from "node:crypto";

// ─── Config ────────────────────────────────────────────────────────────────────
const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/+$/, "");
const ANON_KEY     = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const LIVEKIT_URL  = process.env.LIVEKIT_SERVER_URL || process.env.LIVEKIT_URL || "";

function parseArgs(argv) {
  const a = { game: "", bots: 1, livekit: true, password: "Test1234!", apiUrl: "" };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i];
    if (v === "--game") a.game = argv[++i] || "";
    else if (v === "--bots") a.bots = Math.max(1, parseInt(argv[++i] || "1", 10) || 1);
    else if (v === "--password") a.password = argv[++i] || a.password;
    else if (v === "--no-livekit") a.livekit = false;
    else if (v === "--api-url") a.apiUrl = (argv[++i] || "").replace(/\/+$/, "");
  }
  return a;
}
const ARGS = parseArgs(process.argv.slice(2));

// Resolve the base URL for the game-session API:
//   1. --api-url CLI flag (most reliable — use this for the custom API server)
//   2. API_URL env var
//   3. If SUPABASE_URL contains "supabase.co", assume real Supabase project and use /functions/v1/ prefix
//   4. Otherwise assume a custom API container and use a top-level path
const _envApiUrl = (process.env.API_URL || "").replace(/\/+$/, "");
const _resolvedApiUrl = (ARGS.apiUrl || _envApiUrl || SUPABASE_URL).replace(/\/+$/, "");
const FN_BASE = ARGS.apiUrl
  ? `${ARGS.apiUrl}/game-session`                                 // explicit --api-url always top-level
  : _resolvedApiUrl.includes("supabase.co")
    ? `${_resolvedApiUrl}/functions/v1/game-session`              // real Supabase project
    : `${_resolvedApiUrl}/game-session`;                          // custom API server

const AUTH_BASE = `${SUPABASE_URL}/auth/v1`;

if (!SUPABASE_URL || !ANON_KEY) {
  console.error("ERROR: SUPABASE_URL and SUPABASE_ANON_KEY are required.");
  console.error("  set -a && source ../../.env && set +a");
  process.exit(1);
}
if (!ARGS.game) {
  console.error("ERROR: --game <GAME_ID> is required.");
  console.error("  node participant.mjs --game <GAME_ID> --api-url https://api.quiz4win.com [--bots N] [--no-livekit]");
  process.exit(1);
}

// ─── Logging ─────────────────────────────────────────────────────────────────
const C = { reset: "\x1b[0m", grey: "\x1b[90m", cyan: "\x1b[36m", green: "\x1b[32m",
            yellow: "\x1b[33m", red: "\x1b[31m", bold: "\x1b[1m" };
function ts() { return new Date().toLocaleTimeString("en-GB", { hour12: false }); }
function log(tag, color, msg) {
  console.log(`${C.grey}${ts()}${C.reset} ${color}${C.bold}[${tag}]${C.reset} ${msg}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── HTTP helpers ──────────────────────────────────────────────────────────────
function authHeaders(token) {
  return { "Content-Type": "application/json", apikey: ANON_KEY, Authorization: `Bearer ${token}` };
}

async function signIn(email, password) {
  const res = await fetch(`${AUTH_BASE}/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: ANON_KEY },
    body: JSON.stringify({ email, password }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) return { error: json.error_description || json.msg || `HTTP ${res.status}` };
  return { accessToken: json.access_token, userId: json.user?.id };
}

async function adminCreateUser(email, password) {
  if (!SERVICE_KEY) return { error: "no SUPABASE_SERVICE_ROLE_KEY to create the test user" };
  const res = await fetch(`${AUTH_BASE}/admin/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  // 422 = user already exists — that's fine, we'll just sign in.
  if (!res.ok && res.status !== 422) {
    const json = await res.json().catch(() => ({}));
    return { error: json.msg || json.error_description || `HTTP ${res.status}` };
  }
  return {};
}

/** Sign in; if that fails and a service-role key is present, create then sign in. */
async function ensureToken(email, password) {
  let s = await signIn(email, password);
  if (s.accessToken) return s;
  const created = await adminCreateUser(email, password);
  if (created.error) return { error: `sign-in failed and create failed: ${created.error}` };
  return await signIn(email, password);
}

async function joinGame(token) {
  const res = await fetch(`${FN_BASE}/${ARGS.game}/join`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ session_id: randomUUID(), device_id: `bot-${randomUUID().slice(0, 8)}`, language: "en" }),
  });
  return { ok: res.ok, status: res.status, data: await res.json().catch(() => ({})) };
}

async function getState(token) {
  const res = await fetch(`${FN_BASE}/${ARGS.game}/state?lang=en`, { headers: authHeaders(token) });
  return { ok: res.ok, status: res.status, data: await res.json().catch(() => ({})) };
}

async function submitAnswer(token, questionId, optionId, responseTimeMs) {
  const res = await fetch(`${FN_BASE}/${ARGS.game}/answer`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({
      question_id: questionId,
      selected_option_id: optionId,
      attempt_id: randomUUID(),
      response_time_ms: responseTimeMs,
      session_id: token.slice(-8),
    }),
  });
  return { ok: res.ok, status: res.status, data: await res.json().catch(() => ({})) };
}

// ─── Answering ─────────────────────────────────────────────────────────────────
/**
 * Pick a random option and submit it. Idempotent per questionId so the LiveKit
 * event and the /state poll never double-answer the same question.
 */
async function answerQuestion(ctx, questionId, options) {
  if (!questionId || ctx.answered.has(questionId)) return;
  ctx.answered.add(questionId);

  const opts = Array.isArray(options) ? options.filter((o) => o && o.id) : [];
  if (opts.length === 0) {
    log(ctx.tag, C.yellow, `q=${questionId.slice(0, 8)} has no options — skipping`);
    return;
  }
  const choice = opts[Math.floor(Math.random() * opts.length)];
  const delay = 400 + Math.floor(Math.random() * 2600); // 0.4–3.0s "thinking"
  await sleep(delay);

  const r = await submitAnswer(ctx.token, questionId, choice.id, delay);
  const st = r.data?.status ?? `HTTP ${r.status}`;
  if (r.ok && st === "accepted") {
    const verdict = r.data.isCorrect ? `${C.green}CORRECT${C.reset}` : `${C.yellow}wrong${C.reset}`;
    log(ctx.tag, C.green, `answered q=${questionId.slice(0, 8)} → ${choice.id} (${delay}ms) ${verdict} pts=${r.data.pointsEarned ?? 0}`);
  } else {
    const reason = r.data?.reason ?? r.data?.error ?? "";
    log(ctx.tag, C.red, `answer q=${questionId.slice(0, 8)} → ${choice.id} REJECTED status=${st} ${reason}`);
  }
}

// ─── LiveKit connection ──────────────────────────────────────────────────────
async function connectLiveKit(ctx, roomName, lkToken) {
  let Room, RoomEvent;
  try {
    ({ Room, RoomEvent } = await import("@livekit/rtc-node"));
  } catch (e) {
    log(ctx.tag, C.yellow, `@livekit/rtc-node not installed (${e.message}). Falling back to /state polling only.`);
    return null;
  }
  if (!LIVEKIT_URL) {
    log(ctx.tag, C.yellow, "LIVEKIT_SERVER_URL not set — falling back to /state polling only.");
    return null;
  }

  const room = new Room();
  const dec = new TextDecoder();
  room.on(RoomEvent.DataReceived, (payload) => {
    let msg;
    try { msg = JSON.parse(dec.decode(payload)); } catch { return; }
    if (msg.type === "QUESTION_STARTED") {
      log(ctx.tag, C.cyan, `▶ QUESTION_STARTED idx=${msg.questionIndex} q=${String(msg.questionId).slice(0, 8)}`);
      void answerQuestion(ctx, msg.questionId, msg.options);
    } else if (msg.type === "QUESTION_CLOSED") {
      log(ctx.tag, C.grey, `■ QUESTION_CLOSED idx=${msg.questionIndex} correct=${msg.correctOptionId}`);
    } else if (msg.type === "GAME_STARTED" || msg.type === "GAME_FINISHED") {
      log(ctx.tag, C.grey, `· ${msg.type}`);
    }
  });
  room.on(RoomEvent.Disconnected, () => log(ctx.tag, C.yellow, "livekit disconnected"));

  await room.connect(LIVEKIT_URL, lkToken, { autoSubscribe: true, dynacast: false });
  log(ctx.tag, C.green, `livekit connected → room=${roomName}`);
  return room;
}

// ─── /state poll fallback ───────────────────────────────────────────────────
async function pollLoop(ctx) {
  while (!ctx.stopped) {
    try {
      const s = await getState(ctx.token);
      const d = s.data || {};
      const q = d.question;
      if (q && q.questionId && d.currentQuestionStatus === "active") {
        const opts = q.localized?.options || q.options || [];
        await answerQuestion(ctx, q.questionId, opts);
      }
      if (d.gameStatus && ["finished", "cancelled", "completed"].includes(d.gameStatus)) {
        log(ctx.tag, C.grey, `game ${d.gameStatus} — bot stopping`);
        ctx.stopped = true;
        break;
      }
    } catch (e) {
      log(ctx.tag, C.red, `state poll error: ${e.message}`);
    }
    await sleep(2000);
  }
}

// ─── One bot lifecycle ─────────────────────────────────────────────────────────
async function runBot(index) {
  const tag = `bot${index}`;
  const email = `test+${ARGS.game.slice(0, 8)}-${index}@quiz4win.test`;
  const ctx = { tag, token: "", answered: new Set(), stopped: false };

  const auth = await ensureToken(email, ARGS.password);
  if (!auth.accessToken) { log(tag, C.red, `auth failed: ${auth.error}`); return; }
  ctx.token = auth.accessToken;
  log(tag, C.green, `signed in as ${email} (uid=${auth.userId})`);

  const join = await joinGame(ctx.token);
  if (!join.ok) { log(tag, C.red, `join failed status=${join.status} ${JSON.stringify(join.data)}`); return; }
  const j = join.data;
  log(tag, C.green, `joined: role=${j.userStatus} canSubmit=${j.canSubmitAnswer} gameStatus=${j.gameStatus}`);
  if (j.userStatus !== "participant") {
    log(tag, C.yellow, `joined as ${j.userStatus} — answers will be rejected (joined too late / join_policy).`);
  }

  // If a question is already in flight at join time, answer it immediately.
  if (j.currentQuestionId) {
    const s = await getState(ctx.token);
    const q = s.data?.question;
    if (q?.questionId && s.data.currentQuestionStatus === "active") {
      await answerQuestion(ctx, q.questionId, q.localized?.options || q.options || []);
    }
  }

  let room = null;
  if (ARGS.livekit) room = await connectLiveKit(ctx, j.livekit?.roomName, j.livekit?.token);
  await pollLoop(ctx);
  if (room) { try { await room.disconnect(); } catch { /* ignore */ } }
}

// ─── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  log("main", C.bold, `game=${ARGS.game} bots=${ARGS.bots} livekit=${ARGS.livekit} api=${FN_BASE}`);
  const bots = [];
  for (let i = 1; i <= ARGS.bots; i++) {
    bots.push(runBot(i));
    await sleep(300); // stagger joins slightly
  }
  await Promise.all(bots);
  log("main", C.bold, "all bots finished");
  process.exit(0);
})();
