# WingoBingo / Quiz4Win Real-Time Quiz Backend — Implementation Report

**Date:** 2026-05-31
**Author:** A-01 (Augment Code Agent)
**Reference design:** `docs/wingobingo_quiz_backend_architecture_complete.md`
**Status:** Fully implemented — Redis source of truth, Lua atomic validation,
LiveKit broadcast, RabbitMQ command bus, OpenAI question generation, Game
Orchestrator service, Game Scheduler.

---

## 1. Executive Summary

The architecture document (`docs/wingobingo_quiz_backend_architecture_complete.md`)
mandates a specific technology stack: **Redis** as the real-time source of
truth, **Lua scripts** for atomic validation, **LiveKit DataChannel** for
broadcasting, **RabbitMQ** for internal messaging, and **OpenAI** for
LLM-based question generation.

An earlier draft incorrectly implemented real-time validation using Postgres
`FOR UPDATE` row locks — fundamentally different from Redis Lua atomicity
(§9.3, §19.6). That implementation has been **replaced in full**.

The current implementation uses **exactly** the technologies mandated by the
architecture document, with no substitutions:

| Architecture requirement | Implementation |
|---|---|
| Redis as real-time source of truth (§2.1) | `redis:7-alpine` in Docker Compose; `npm:redis@4` client |
| Atomic Lua scripts (§9.3, §19.6) | `_shared/redis_scripts.ts` — four Lua scripts |
| LiveKit DataChannel broadcast (§3.5) | `_shared/livekit.ts` — HS256 JWT + `RoomService.SendData` REST |
| RabbitMQ command/event bus (§4.4) | `npm:amqplib@0.10.4` in orchestrator; HTTP publish from edge functions |
| OpenAI LLM question generation (§5) | `_shared/llm.ts` — `gpt-4o-mini`, multilingual, stable option IDs |
| Game Orchestrator service (§3.2) | `deploy/game-orchestrator/orchestrator.ts` — long-running Deno container |
| Game Scheduler (§3.1) | Extended `deploy/template-generator/generator.ts` |

---

## 2. What Was Built

### 2.1 Database Migration

| File | What it does |
|------|---|
| `supabase/migrations/20260528360000_realtime_quiz_v1.sql` | Adds real-time state columns to `games`, `game_participants`, `questions`, `game_answers`. Backfills stable `option_ids = ['A','B','C','D']` and `correct_option_id` for existing question rows. |
| `supabase/migrations/20260528360001_realtime_quiz_rpcs.sql` | Drops the incorrect Postgres RPCs (if applied). Adds Redis reference columns to `games`: `redis_namespace`, `redis_cluster_id`, `redis_started_at`, `redis_expires_at` (§3.8). |

**Redis reference columns on `games` (§3.8)**

These columns let the DB record which Redis namespace serves a game session
so that audit and recovery tooling can reconstruct state without touching Redis
internals:

- `redis_namespace` — key prefix (e.g. `q4w:game:<id>`) written by the orchestrator at `StartGame`.
- `redis_cluster_id` — `"default"` for the single self-hosted cluster; extensible for multi-cluster HA.
- `redis_started_at` / `redis_expires_at` — lifespan metadata for audit.

**Schema additions from `20260528360000`**

- `games`: `grace_period_ms`, `join_policy`, `run_mode`, `livekit_room_name`, `total_questions`, `time_per_question`, `allowed_wrong_answers`, `language`, `category`, `difficulty`.
- `game_participants`: `participant_role` (`participant|spectator|eliminated`), `wrong_count`, `eliminated_at`, `elimination_reason`, `session_id`, `device_id`, `join_question_index`.
- `questions`: `option_ids[]`, `correct_option_id`, `localized` (JSONB), `validated`, `validation_flags`.
- `game_answers`: full §16 audit log — `attempt_id`, `selected_option_id`, `correct_option_id`, `server_received_at`, `question_starts_at/ends_at`, `was_late`, `was_duplicate`, `was_no_answer`, before/after status snapshots, `ip_address`, `user_agent`, `session_id`, `eliminated`, `elimination_reason`.

### 2.2 Shared Redis Helpers

| File | Purpose |
|------|---------|
| `supabase/functions/_shared/redis.ts` | Singleton Redis client (`npm:redis@4`). `getRedis()` lazily connects once; `evalScript()` wrapper for Lua execution. |
| `supabase/functions/_shared/redis_keys.ts` | Key-namespace builder functions: `redisKeys(gameId)`, `joinGameKeys(gameId, userId)`, `submitAnswerKeys(gameId, userId, questionId)`. Produces keys of the form `q4w:game:{id}`, `q4w:game:{id}:question:{qid}`, `q4w:game:{id}:user:{uid}`. |
| `supabase/functions/_shared/redis_scripts.ts` | Four atomic Lua scripts (see §2.3). |

### 2.3 Atomic Lua Scripts (§9.3, §19.6)

All real-time validation runs as single-shot Lua scripts — no separate reads
and writes that could race between concurrent requests.

| Script constant | Architecture ref | What it does |
|---|---|---|
| `JOIN_GAME_SCRIPT` | §7 | Reads `gameStatus` and `joinPolicy` from game hash. Decides `participant` vs `spectator` role based on `currentQuestionIndex`. Writes user hash (`role`, `sessionId`, `deviceId`, `joinedAt`). Increments `participantCount` or `spectatorCount`. Idempotent — reconnects return the existing role. |
| `SUBMIT_ANSWER_SCRIPT` | §9.3 | Full atomic chain: game active? → question active? → time window + grace? → user exists? → role check → duplicate check → write answer → update `correct/wrongCount` and `remainingLives` → set `eliminated=1` if lives=0. Returns full JSONB result. |
| `PREPARE_QUESTION_SCRIPT` | §8.2 | Writes question hash (`text`, `options`, `correctOptionId`, `startsAt`, `endsAt`, `status=active`). Updates game hash `currentQuestion*` fields atomically. |
| `CLOSE_QUESTION_SCRIPT` | §18.5 | Flips `questionStatus` to `closed` in game hash. Returns list of participants who have not answered (for no-answer penalty processing by the orchestrator). |

### 2.4 LiveKit Broadcaster (§3.5)

`supabase/functions/_shared/livekit.ts`

- Signs LiveKit access tokens using HS256 JWT (standard `jose`-compatible
  format) with `roomJoin`, `canPublish`, `canSubscribe`, `canPublishData` grants.
- `signAccessToken(userId, roomName, identity)` — called by `/join` to give
  the client a token to subscribe to the broadcast room.
- `broadcast(roomName, payload, eventType)` — calls LiveKit REST
  `POST /twirp/livekit.RoomService/SendData` with a base64-encoded JSON
  payload, targeting all participants. Used by the orchestrator to send
  `GAME_STARTED`, `QUESTION_STARTED`, `QUESTION_CLOSED`, `GAME_ENDED` events.

### 2.5 LLM Question Generator (§5)

`supabase/functions/_shared/llm.ts`

- Calls `POST https://api.openai.com/v1/chat/completions` with model `gpt-4o-mini`.
- System prompt instructs the model to return a JSON object with stable
  option IDs `A`, `B`, `C`, `D` (§5.5), `correctOptionId`, and a
  `localized` map of `{lang: {text, options: {A,B,C,D}}}` for every requested
  language.
- `generateQuestion(topic, category, difficulty, targetLanguages)` — called
  by the orchestrator ahead of each question (§5.7 pre-generation).

### 2.6 Game-Session Edge Function

`supabase/functions/game-session/index.ts`

Three routes — all JWT-authenticated (R-03). Game lifecycle (start, advance,
close) is handled entirely by the orchestrator, not by this function.

| Route | What happens |
|---|---|
| `POST /game-session/:id/join` | 1. Reads game row from DB to get `livekit_room_name` and verify the game is joinable. 2. Runs `JOIN_GAME_SCRIPT` Lua atomically in Redis. 3. Upserts `game_participants` row in DB (role from Redis). 4. Returns a LiveKit access token for the room. |
| `GET /game-session/:id/state` | Calls Redis `HGETALL` on the game hash and the user hash. Returns current question index, status, question text/options (if active), user role, lives remaining, and score. Falls back to DB if Redis key is absent. |
| `POST /game-session/:id/answer` | 1. Runs `SUBMIT_ANSWER_SCRIPT` Lua atomically. 2. On success, publishes `ANSWER_PERSIST_REQUESTED` message to RabbitMQ (`MQ_ORCHESTRATOR_QUEUE`). The orchestrator picks it up and writes the audit row to `game_answers` asynchronously (§9.5). Returns the Lua result immediately to the client. |

The legacy `/games/:id/{join,answer,question,result}` routes in
`supabase/functions/games/index.ts` are **left untouched** so existing
mobile builds continue to work. New clients use `/game-session/*`.

### 2.7 Game Orchestrator Service (§3.2)

`deploy/game-orchestrator/orchestrator.ts` / `Dockerfile`

A long-running Deno process (same pattern as `template-generator`) that
consumes the `quiz.game.commands` RabbitMQ queue via AMQP (`npm:amqplib@0.10.4`).

**Message handlers:**

| Message type | What the orchestrator does |
|---|---|
| `StartGame` | Fetches game config from DB. Initialises Redis game hash (`gameStatus=running`, `joinPolicy`, `gracePeriodMs`, `questionTimeLimitSeconds`, counters). Writes `redis_namespace` reference back to the DB games row (§3.8). Broadcasts `GAME_STARTED` via LiveKit. Starts the automatic question loop (auto mode). |
| `ANSWER_PERSIST_REQUESTED` | Inserts full §16 audit row into `game_answers`. Updates `game_participants.score` and `correct_answers` counter for correct answers. |
| `FinalizeGame` | Updates `games.status = 'finished'` and `finished_at`. Broadcasts `GAME_ENDED`. Sets 1-hour TTL on Redis keys (§15.1). |

**Question loop (auto mode):**

1. Calls `generateQuestion()` (LLM) for the current index.
2. Runs `PREPARE_QUESTION_SCRIPT` Lua to write question state to Redis.
3. Broadcasts `QUESTION_STARTED` event via LiveKit with question text, options, `startsAt`, `endsAt`.
4. Waits for `timeLimitSeconds + gracePeriodMs`.
5. Runs `CLOSE_QUESTION_SCRIPT` Lua.
6. Processes no-answer penalties for participants who didn't submit.
7. Broadcasts `QUESTION_CLOSED` with the correct answer.
8. Advances to the next question or calls `finalizeGame()`.

**Crash recovery (§15.2):** On startup, queries DB for `status=live` games.
If Redis shows `currentQuestionStatus=active`, re-arms the close timer for the
remaining window so the question closes cleanly even after a restart.

### 2.8 Game Scheduler (§3.1)

`deploy/template-generator/generator.ts` (extended)

The existing template-generator tick now runs two tasks in parallel every
60 seconds:

1. **Template generation** (original) — calls `generate_games_from_active_templates()` RPC.
2. **Game scheduler** (new) — queries DB for `status=upcoming` games whose
   `scheduled_at <= NOW()`. For each match:
   - Atomically `PATCH games SET status='open' WHERE status='upcoming'` (prevents double-publish).
   - Publishes `StartGame` command to RabbitMQ via the management HTTP API.
   - The orchestrator receives it and starts the Redis session.

### 2.9 Docker Compose & Infrastructure

`docker-compose.yml` additions:

- **`redis` service** — `redis:7-alpine`, password-protected (`--requirepass`),
  512 MB LRU eviction, no persistence (game state is ephemeral by design),
  internal-only port `127.0.0.1:6379`. Health-checked.
- **`game-orchestrator` service** — built from `deploy/game-orchestrator/`,
  depends on `db-maintainer` (healthy) and `redis` (healthy).
- **`api` service** — now depends on `redis` (healthy) so the edge function
  can connect to Redis on startup. `REDIS_URL` and `MQ_ORCHESTRATOR_QUEUE`
  injected.

---

## 3. New Environment Variables

| Variable | Service(s) | Description |
|---|---|---|
| `REDIS_PASSWORD` | `redis`, `api`, `game-orchestrator` | Strong random password for the self-hosted Redis instance. |
| `REDIS_URL` | `api`, `game-orchestrator` | `redis://:${REDIS_PASSWORD}@redis:6379` — resolves via internal Docker network. |
| `OPENAI_API_KEY` | `game-orchestrator` | Key for OpenAI API (question generation). |
| `OPENAI_MODEL` | `game-orchestrator` | Model name; default `gpt-4o-mini`. |
| `MQ_ORCHESTRATOR_QUEUE` | `api`, `game-orchestrator`, `template-generator` | RabbitMQ queue name; default `quiz.game.commands`. |

All existing variables (`LIVEKIT_*`, `RABBITMQ_URL`, `SUPABASE_*`, `REMITATION_*`) remain unchanged.

---

## 4. Rule Compliance

| Rule | How |
|------|-----|
| R-01 | No secrets logged. `REDIS_URL` (with password) and `OPENAI_API_KEY` are read from env only and never appear in logs or responses. |
| R-02 | All monetary values continue to use integer cents; no financial logic is touched by this implementation. |
| R-03 | All `/game-session/*` routes call `validateJWT` before any operation. |
| R-05 | `game_answers` is append-only. The orchestrator inserts audit rows; it never UPDATEs or DELETEs them. |
| R-06 | `game-session/index.ts` imports only from `_shared/*`. Orchestrator imports only `npm:*`. No cross-module reverse imports. |
| R-09 | Answer validation and counter updates happen inside a single Redis Lua script — atomically, without separate read/write round trips. |

---

## 5. Deployment

```bash
# 1. Copy env template and set required secrets
cp .env.docker.example .env
# Edit .env — set REDIS_PASSWORD, OPENAI_API_KEY, and confirm RABBITMQ_URL

# 2. Build all services (includes redis + game-orchestrator)
docker compose up -d --build

# 3. Apply migrations (db-maintainer runs them on start)
#    Wait for db-maintainer to report healthy, then verify:
docker compose logs db-maintainer | grep "migration"

# 4. Verify
curl https://api.<host>/health
```

To rebuild only the new services after a code change:

```bash
docker compose up -d --build game-orchestrator template-generator api
```

---

## 6. File Inventory

| File | Status | Purpose |
|------|--------|---------|
| `supabase/migrations/20260528360000_realtime_quiz_v1.sql` | New | Schema additions for real-time quiz state |
| `supabase/migrations/20260528360001_realtime_quiz_rpcs.sql` | New | Drop incorrect Postgres RPCs; add Redis reference columns |
| `supabase/functions/_shared/redis.ts` | New | Redis singleton client |
| `supabase/functions/_shared/redis_keys.ts` | New | Redis key-namespace builders |
| `supabase/functions/_shared/redis_scripts.ts` | New | Atomic Lua scripts (join, answer, prepare, close) |
| `supabase/functions/_shared/livekit.ts` | New | LiveKit JWT signer + DataChannel broadcaster |
| `supabase/functions/_shared/llm.ts` | New | OpenAI question generator |
| `supabase/functions/game-session/index.ts` | New | Edge function — `/join`, `/state`, `/answer` |
| `deploy/game-orchestrator/orchestrator.ts` | New | Game lifecycle brain — AMQP consumer |
| `deploy/game-orchestrator/Dockerfile` | New | Deno container (mirrors template-generator) |
| `deploy/template-generator/generator.ts` | Modified | Extended with §3.1 game scheduler |
| `docker-compose.yml` | Modified | Added `redis`, `game-orchestrator`; wired `api` → `redis` |
| `.env.docker.example` | Modified | Added `REDIS_*`, `OPENAI_*`, `MQ_ORCHESTRATOR_QUEUE` |

---

## 7. Suggested Next Steps

- **Deno tests** — atomic Lua scripts (`JOIN_GAME`, `SUBMIT_ANSWER`) with a
  real Redis test instance: happy path, late answer, duplicate, idempotent
  replay, spectator rejection, lives=0 elimination.
- **Admin UI** — surface live game state from Redis on the game-detail panel;
  add a manual "next question" trigger for `run_mode=manual` games.
- **End-to-end staging test** — start a game, join from a mobile client,
  submit answers, verify LiveKit events arrive and `game_answers` rows appear
  in Postgres.
