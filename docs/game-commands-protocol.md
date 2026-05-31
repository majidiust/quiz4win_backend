# Quiz4Win — Game Commands Protocol

**Audience:** External AI Presenter service team.
**Last updated:** 2026-05-31
**Reference:** `docs/wingobingo_quiz_backend_architecture_complete.md` (§3.5, §4, §13.4)

This document specifies the complete protocol that the **External AI Presenter
service** uses to drive a live Quiz4Win game from inside a LiveKit room.

The AI Presenter participates in two channels:

1. **Outbound — RabbitMQ (AMQP):** publishes lifecycle *commands* to the
   `game-orchestrator`.
2. **Inbound — LiveKit DataChannel:** joins the game's room as a participant
   and consumes broadcast *events* (including private payloads that contain
   the question text and the correct answer so the presenter can speak it).

---

## 1. Transport

### 1.1 RabbitMQ (commands)

| Field          | Value (production)                                              |
|----------------|------------------------------------------------------------------|
| URL            | `RABBITMQ_URL` (e.g. `amqps://user:pass@host/vhost`)             |
| Exchange       | `""` (default direct exchange — routing key = queue name)        |
| Routing key    | `quiz.game.commands`                                             |
| Queue          | `quiz.game.commands` (durable, prefetch=1)                       |
| Encoding       | `application/json`, UTF-8                                        |
| Delivery mode  | `2` (persistent)                                                 |

A simpler alternative — publish over the RabbitMQ **Management HTTP API**:
```
POST {mgmt-url}/api/exchanges/{vhost-enc}/%2F/publish
```
Body — see existing pattern in `deploy/template-generator/generator.ts`.

### 1.2 LiveKit (events)

| Field          | Value                                                            |
|----------------|------------------------------------------------------------------|
| Server URL     | `LIVEKIT_SERVER_URL` (e.g. `wss://wingobingo-…livekit.cloud`)    |
| Room name      | `quiz-{gameId}` (or value of `games.livekit_room_name`)          |
| Identity       | Recommend `ai-presenter-{gameId}` so the orchestrator can target |
| JWT grants     | `roomJoin=true`, `room=quiz-{gameId}`, `canPublish=true`         |
| Data topic     | One of `GAME_STARTED`, `QUESTION_PREPARED`, `QUESTION_STARTED`, `QUESTION_CLOSED`, `GAME_ENDED` |

JWT generation reference: `_shared/livekit.ts` → `signAccessToken()` (HS256).
The presenter joins with audio enabled so its voice is heard by all players.

---

## 2. High-level flow

```mermaid
sequenceDiagram
  participant Sched as Scheduler
  participant MQ as RabbitMQ
  participant Orch as game-orchestrator
  participant LK as LiveKit Room
  participant AI as AI Presenter
  participant App as Mobile Clients

  Sched->>MQ: StartGame
  MQ->>Orch: StartGame
  Orch->>LK: GAME_STARTED
  LK-->>AI: GAME_STARTED
  LK-->>App: GAME_STARTED
  AI->>MQ: PrepareQuestion
  MQ->>Orch: PrepareQuestion
  Orch->>LK: QUESTION_PREPARED (presenter-only)
  LK-->>AI: text + correctOptionId
  AI->>AI: speaks the question aloud
  AI->>MQ: StartQuestion
  MQ->>Orch: StartQuestion
  Orch->>LK: QUESTION_STARTED (public, no answer)
  LK-->>App: options + timer
  Note over Orch: timer expires
  Orch->>LK: QUESTION_CLOSED (correctOptionId)
  AI->>MQ: PrepareQuestion (next)
  AI->>MQ: FinalizeGame
```

---

## 3. Game run modes

The `games.run_mode` column controls who drives the game:

| Mode        | Driver                              | Use case                       |
|-------------|-------------------------------------|--------------------------------|
| `auto`      | `game-orchestrator` internal timer  | No presenter, fully automated  |
| `presenter` | External AI Presenter via commands  | This document                  |
| `manual`    | Human admin via Admin Panel         | Studio shows                   |


---

## 4. Commands (AI Presenter → Orchestrator)

All command payloads are JSON. Every message **must** include:

| Field           | Type     | Required | Description                                |
|-----------------|----------|----------|--------------------------------------------|
| `type`          | string   | yes      | One of the command names below.            |
| `gameId`        | uuid     | yes      | Target game (matches `games.id`).          |
| `correlationId` | uuid     | yes      | Idempotency / tracing key.                 |
| `publishedAt`   | ISO-8601 | yes      | Sender timestamp (UTC).                    |
| `presenterId`   | string   | rec.     | LiveKit identity of the presenter.         |

### 4.0 Presenter identity convention

The orchestrator needs to know the presenter's LiveKit identity so it can
send **private** events (e.g. `QUESTION_PREPARED`) to that participant only.

| Priority | Source | Format |
|----------|--------|--------|
| 1 (highest) | `presenterId` field in any command payload | any string |
| 2 | `presenterId` in the `StartGame` payload | any string |
| 3 (default) | computed by orchestrator | `ai-presenter-{gameId}` |

The identity is **stored in Redis** (`presenterIdentity` field on the game
state hash) so it survives an orchestrator restart.

**The presenter must obtain a LiveKit JWT** using the same
`LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` as the game server, with:

```json
{
  "sub": "ai-presenter-{gameId}",
  "video": { "roomJoin": true, "room": "quiz-{gameId}", "canPublish": true }
}
```

Call `signAccessToken("ai-presenter-{gameId}", "quiz-{gameId}", { canPublish: true })`
from `_shared/livekit.ts` → `signAccessToken()`, or use the LiveKit SDK directly.

---

### 4.1 `StartGame`  ✅ *implemented*

Triggers the orchestrator to initialise Redis state, mark the DB game
`status='live'`, and broadcast `GAME_STARTED`. In `presenter` mode the
orchestrator registers the presenter identity and **does not** auto-issue
the first question — it waits for `PrepareQuestion`.

```json
{
  "type": "StartGame",
  "gameId": "0b2f…",
  "presenterId": "ai-presenter-0b2f…",
  "correlationId": "…",
  "publishedAt": "2026-05-31T20:00:00Z"
}
```

### 4.2 `PrepareQuestion`  ✅ *implemented*

Requests the next question. The orchestrator:

1. Dequeues a pre-generated question (OpenAI gpt-4o-mini); generates if
   the queue is empty.
2. Persists the question row in `questions` (non-blocking).
3. Atomically stages it in Redis (`STAGE_Q` Lua script, `status=prepared`).
   The question is **not yet active** — `SUBMIT_ANSWER` is rejected during
   this window.
4. Broadcasts a **private** `QUESTION_PREPARED` event to the presenter only
   (`LiveKit destination_identities=[presenterId]`), including the
   `correctOptionId` so the presenter can read and dramatise the question.

```json
{
  "type": "PrepareQuestion",
  "gameId": "0b2f…",
  "questionIndex": 3,
  "presenterId": "ai-presenter-0b2f…",
  "correlationId": "…",
  "publishedAt": "2026-05-31T20:02:00Z"
}
```

`questionIndex` is optional. If omitted, the orchestrator uses its internal
counter (`config.currentQuestionIndex`).

### 4.3 `StartQuestion`  ✅ *implemented*

Promotes the staged question to `active` (`ACTIVATE_Q` Lua script). The
orchestrator writes `startsAt`/`endsAt` into the Redis game state, arms the
auto-close timer, and broadcasts `QUESTION_STARTED` to **all** participants.

```json
{
  "type": "StartQuestion",
  "gameId": "0b2f…",
  "questionIndex": 3,
  "timeLimitSeconds": 10,
  "correlationId": "…",
  "publishedAt": "2026-05-31T20:02:15Z"
}
```

`timeLimitSeconds` is optional; defaults to the value stored in the game row.

### 4.4 `CloseQuestion`  ✅ *implemented*

Forces an early close before the auto-close timer fires. Cancels the timer,
runs `CLOSE_QUESTION` Lua, processes no-answer eliminations, and broadcasts
`QUESTION_CLOSED` with the correct answer.

```json
{
  "type": "CloseQuestion",
  "gameId": "0b2f…",
  "questionIndex": 3,
  "correlationId": "…",
  "publishedAt": "…"
}
```

`questionIndex` is optional. If omitted, the orchestrator reads the current
index from Redis.

### 4.5 `AdvanceQuestion`  ✅ *implemented*

Convenience command that internally executes `PrepareQuestion` followed by
`StartQuestion` (with a 150 ms pause between them). The presenter receives
a private `QUESTION_PREPARED` event immediately before the public
`QUESTION_STARTED` event. Useful for rapid-fire rounds where narration is
not needed.

```json
{
  "type": "AdvanceQuestion",
  "gameId": "0b2f…",
  "timeLimitSeconds": 10,
  "correlationId": "…",
  "publishedAt": "…"
}
```

### 4.6 `FinalizeGame`  ✅ *implemented*

Ends the game: marks DB `status='finished'`, broadcasts `GAME_ENDED`,
expires the Redis namespace.

```json
{
  "type": "FinalizeGame",
  "gameId": "0b2f…",
  "livekitRoomName": "quiz-0b2f…",
  "correlationId": "…",
  "publishedAt": "…"
}
```

---

## 5. Events (Orchestrator → LiveKit DataChannel)

All events are sent via `RoomService.SendData`. Each event has a `topic`
matching its `type` so the SDK can filter. The presenter consumes them via
the LiveKit client SDK (`room.on('dataReceived', …)`).

### 5.1 `GAME_STARTED`

```json
{ "type":"GAME_STARTED", "gameId":"…", "serverTime":1730000000000 }
```

### 5.2 `QUESTION_PREPARED`  *(private — presenter only)*

Sent **only to the presenter identity** specified in `PrepareQuestion`.
Contains the full canonical question, all localised payloads, and the
**correct option id** so the presenter can speak and dramatise it.

```json
{
  "type": "QUESTION_PREPARED",
  "gameId": "…",
  "questionId": "uuid",
  "questionIndex": 3,
  "canonicalText": "What is the capital of France?",
  "options": [
    {"id":"A","text":"Berlin"},
    {"id":"B","text":"Paris"},
    {"id":"C","text":"Madrid"},
    {"id":"D","text":"Rome"}
  ],
  "correctOptionId": "B",
  "explanation": "Paris has been the capital since 987 AD.",
  "estimatedAnswerTimeSec": 8,
  "localizedPayloads": [
    { "language":"en", "text":"What is the capital of France?",
      "options":[{"id":"A","text":"Berlin"}, …] }
  ],
  "serverTime": 1730000000000
}
```

### 5.3 `QUESTION_STARTED`  *(public)*

Broadcast to **all** participants. **Never** contains `correctOptionId`
(§13.4).

```json
{
  "type": "QUESTION_STARTED",
  "gameId": "…",
  "questionId": "uuid",
  "questionIndex": 3,
  "questionText": "What is the capital of France?",
  "options": [{"id":"A","text":"Berlin"}, …],
  "localizedPayloads": [ … ],
  "startsAt": 1730000000000,
  "endsAt":   1730000010000,
  "timeLimitSeconds": 10,
  "serverTime": 1730000000000
}
```

### 5.4 `QUESTION_CLOSED`  *(public)*

```json
{
  "type": "QUESTION_CLOSED",
  "gameId": "…",
  "questionId": "uuid",
  "questionIndex": 3,
  "correctOptionId": "B",
  "noAnswerCount": 2,
  "closedAt": 1730000010400,
  "serverTime": 1730000010400
}
```

### 5.5 `GAME_ENDED`

```json
{ "type":"GAME_ENDED", "gameId":"…", "serverTime":1730000060000 }
```

---

## 6. Error handling & recovery

* **Idempotency** — `correlationId` should be unique per logical operation.
  The orchestrator does not persist `correlationId`s today, but re-sending
  `PrepareQuestion` while a question is already staged returns a
  `question_already_staged` error from the Lua script (noop on Redis).
* **Order** — the orchestrator processes one message at a time per game
  (RabbitMQ `prefetch=1`).
* **Failure** — handler exceptions cause a `nack` (dead-letter) after one
  attempt; the presenter receives no LiveKit event.
* **Orchestrator restart** — `recoverRunningGames()` runs at startup and:
  * Rebuilds `presenterGames` config from the DB + Redis for every live game
    with `run_mode='presenter'`.
  * Re-arms the auto-close timer if a question was active at crash time.
  * Rebuilds `stagedQuestions` from the Redis staged hash (TTL 1 h) if a
    question was staged but not yet started — the presenter can issue
    `StartQuestion` immediately after the orchestrator comes back.
* **Staged question lost** — if the Redis staged hash expires (TTL 1 h)
  before `StartQuestion` arrives, the presenter must re-send
  `PrepareQuestion`.

---

## 7. Implementation status

| Command            | Status           | Notes                                                     |
|--------------------|------------------|-----------------------------------------------------------|
| `StartGame`        | ✅ implemented   | Published by `template-generator`; sets up presenter config when `run_mode='presenter'`. |
| `FinalizeGame`     | ✅ implemented   | Consumed by `game-orchestrator`; cleans up Redis + maps.  |
| `PrepareQuestion`  | ✅ implemented   | STAGE_Q Lua + private QUESTION_PREPARED → presenter.      |
| `StartQuestion`    | ✅ implemented   | ACTIVATE_Q Lua + public QUESTION_STARTED + auto-close timer. |
| `CloseQuestion`    | ✅ implemented   | Early close; cancels timer; re-uses CLOSE_Q Lua.          |
| `AdvanceQuestion`  | ✅ implemented   | Prepare + Start in one command (150 ms gap).              |

**All six commands are fully implemented.** Both `auto` and `presenter`
run modes are production-ready in `deploy/game-orchestrator/orchestrator.ts`.

---

## 8. Quick-start example (Node.js)

```js
import amqp from "amqplib";
import { AccessToken } from "livekit-server-sdk"; // or use livekit.ts helper

// ── 1. Connect to RabbitMQ ──────────────────────────────────────────────────
const conn = await amqp.connect(process.env.RABBITMQ_URL);
const ch   = await conn.createChannel();
await ch.assertQueue("quiz.game.commands", { durable: true });

function send(type, body) {
  ch.sendToQueue("quiz.game.commands",
    Buffer.from(JSON.stringify({
      type, ...body,
      correlationId: crypto.randomUUID(),
      publishedAt: new Date().toISOString(),
    })),
    { persistent: true, contentType: "application/json" });
}

// ── 2. Obtain a LiveKit JWT for the presenter identity ──────────────────────
const gameId        = "<uuid of the game>";
const presenterIdentity = `ai-presenter-${gameId}`;
const roomName      = `quiz-${gameId}`;   // or use games.livekit_room_name

const at = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, {
  identity: presenterIdentity,
});
at.addGrant({ roomJoin: true, room: roomName, canPublish: true, canSubscribe: true });
const presenterToken = await at.toJwt(); // join LiveKit with this token

// ── 3. Trigger game start (usually done by template-generator, shown here for clarity) ──
send("StartGame", { gameId, presenterId: presenterIdentity });

// ── 4. Main presenter loop ──────────────────────────────────────────────────
//   Listen for QUESTION_PREPARED on LiveKit (using room.on("dataReceived", ...))
//   then call StartQuestion when ready.

for (let q = 0; q < 10; q++) {
  // Request next question (private QUESTION_PREPARED event comes back on LiveKit)
  send("PrepareQuestion", { gameId, questionIndex: q, presenterId: presenterIdentity });

  // ← AI speaks the question, received via QUESTION_PREPARED on LiveKit DataChannel
  await waitForLiveKitEvent("QUESTION_PREPARED"); // your LiveKit room listener

  // Reveal question to participants
  send("StartQuestion", { gameId, questionIndex: q, timeLimitSeconds: 10 });

  // Optionally close early:
  // send("CloseQuestion", { gameId, questionIndex: q });

  await waitForLiveKitEvent("QUESTION_CLOSED"); // auto-fires after timeLimitSeconds
}

send("FinalizeGame", { gameId, livekitRoomName: roomName });
```

Alternatively, use `AdvanceQuestion` for rapid-fire rounds (no preview window):

```js
for (let q = 0; q < 10; q++) {
  send("AdvanceQuestion", { gameId, timeLimitSeconds: 8 });
  await waitForLiveKitEvent("QUESTION_CLOSED");
}
send("FinalizeGame", { gameId, livekitRoomName: roomName });
```
