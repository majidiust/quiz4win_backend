# Quiz4Win — AI Performer Integration Guide

**Audience:** Engineering team building the AI Presenter service.  
**Last updated:** 2026-05-31  
**Status:** All commands implemented and production-ready.

---

## Overview

The **AI Performer** is an external service that hosts and narrates a live Quiz4Win
game. It has two responsibilities:

1. **Drive the game flow** — send commands to the `game-orchestrator` over RabbitMQ.
2. **Be present in the LiveKit room** — receive events (including the private question
   preview) and broadcast its voice to all players.

The performer is invisible to players at the protocol level; they hear the presenter's
voice via LiveKit audio and see questions appear on-screen via LiveKit data events.

---

## 1. Prerequisites

| Requirement | Details |
|-------------|---------|
| **RabbitMQ access** | `RABBITMQ_URL` credential from the backend team |
| **LiveKit credentials** | `LIVEKIT_API_KEY` + `LIVEKIT_API_SECRET` from the backend team |
| **Supabase service key** | Only needed if you want to query game metadata directly; optional |
| **`games.run_mode`** | Must be set to `'presenter'` on the game row before `StartGame` |

> **Never log credentials.** All secrets must be kept in environment variables.

---

## 2. Two communication channels

```
AI Performer
  │
  ├─── RabbitMQ (AMQP) ──► game-orchestrator   [commands you SEND]
  │
  └─── LiveKit room  ◄────  game-orchestrator   [events you RECEIVE]
         │
         └─── Players also in this room (hear your voice, receive public events)
```

### 2.1 RabbitMQ — sending commands

| Field         | Value |
|---------------|-------|
| Queue         | `quiz.game.commands` (durable) |
| Exchange      | `""` (default direct) |
| Routing key   | `quiz.game.commands` |
| Content-Type  | `application/json` |
| Delivery mode | `2` (persistent) |

Every message must be a JSON object containing at minimum:

| Field           | Type     | Description |
|-----------------|----------|-------------|
| `type`          | string   | Command name (see §4) |
| `gameId`        | uuid     | The game being hosted |
| `correlationId` | uuid     | Unique ID per command send — used for tracing |
| `publishedAt`   | ISO-8601 | UTC timestamp of when you published the command |
| `presenterId`   | string   | Your LiveKit identity (see §3) |

### 2.2 LiveKit — receiving events

Join the LiveKit room **before** sending `StartGame`. The orchestrator will send
events to the room immediately after game initialisation.

| Field       | Value |
|-------------|-------|
| Server URL  | `LIVEKIT_SERVER_URL` |
| Room name   | `quiz-{gameId}` (or `games.livekit_room_name` from DB) |
| Identity    | Your presenter identity (see §3) |
| Grants      | `roomJoin=true`, `canPublish=true`, `canSubscribe=true` |

Listen for data packets:

```js
room.on("dataReceived", (payload, participant, kind, topic) => {
  const event = JSON.parse(new TextDecoder().decode(payload));
  handleEvent(event.type, event);
});
```

---

## 3. Presenter identity

The orchestrator must know your LiveKit identity in order to send you
**private** events (e.g. the question text + correct answer before players
see the question).

| Priority | Where | Value |
|----------|-------|-------|
| 1 | `presenterId` field in any command | any string you choose |
| 2 | `presenterId` in `StartGame` | any string you choose |
| 3 (default) | Computed by orchestrator | `ai-presenter-{gameId}` |

**Recommended:** always pass `presenterId` explicitly in `StartGame` and every
subsequent command. This ensures private events reach you even after an
orchestrator restart.

### Obtaining a LiveKit JWT

The token must be signed with the same `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET`
as the game server.

```js
import { AccessToken } from "livekit-server-sdk";

const gameId   = "<uuid>";
const identity = `ai-presenter-${gameId}`;
const roomName = `quiz-${gameId}`;

const at = new AccessToken(
  process.env.LIVEKIT_API_KEY,
  process.env.LIVEKIT_API_SECRET,
  { identity }
);
at.addGrant({
  roomJoin: true,
  room: roomName,
  canPublish: true,       // needed to broadcast your voice
  canSubscribe: true,
  canPublishData: false,  // orchestrator handles data
});

const token = await at.toJwt();
// Connect to LiveKit using this token
```

---

## 4. Game lifecycle

```
[Pre-game]
  Join LiveKit room
  Connect to RabbitMQ
  ↓
[StartGame command]
  Receive: GAME_STARTED event on LiveKit
  ↓
[Question loop — repeat N times]
  Send: PrepareQuestion
  Receive: QUESTION_PREPARED (private — only you)
  → Read question aloud, build suspense
  Send: StartQuestion
  Receive: QUESTION_STARTED (now players see options + timer)
  → Players answer; timer counts down
  Receive: QUESTION_CLOSED (correct answer revealed to all)
  → Comment on results, announce next question
  ↓
[FinalizeGame command]
  Receive: GAME_ENDED event on LiveKit
```

---

## 5. Commands reference

### 5.1 `StartGame`

Initialises Redis game state, flips `games.status` to `'live'`, broadcasts
`GAME_STARTED` to the room. In `presenter` mode the orchestrator does **not**
auto-start questions — it waits for your `PrepareQuestion`.

```json
{
  "type": "StartGame",
  "gameId": "a1b2c3d4-…",
  "presenterId": "ai-presenter-a1b2c3d4-…",
  "correlationId": "f8e3…",
  "publishedAt": "2026-05-31T20:00:00Z"
}
```

---

### 5.2 `PrepareQuestion`

Requests the next question. The orchestrator:

1. Dequeues a pre-generated question (OpenAI `gpt-4o-mini`).
2. Persists the question in the database.
3. Atomically stages it in Redis (`status=prepared` — players **cannot** answer yet).
4. Sends you a **private** `QUESTION_PREPARED` event on LiveKit with the full
   question text, all options, and the `correctOptionId`.

```json
{
  "type": "PrepareQuestion",
  "gameId": "a1b2c3d4-…",
  "questionIndex": 0,
  "presenterId": "ai-presenter-a1b2c3d4-…",
  "correlationId": "a9f1…",
  "publishedAt": "2026-05-31T20:00:05Z"
}
```

`questionIndex` is optional. If omitted the orchestrator uses its internal counter.

After receiving `QUESTION_PREPARED`, you have time to read and announce the question
**before** players see the options. Proceed when ready.

---

### 5.3 `StartQuestion`

Promotes the staged question to `active`. The orchestrator:

1. Atomically writes `startsAt` / `endsAt` into Redis.
2. Broadcasts `QUESTION_STARTED` to **all** participants (without `correctOptionId`).
3. Arms the auto-close timer (`timeLimitSeconds + gracePeriodMs`).

```json
{
  "type": "StartQuestion",
  "gameId": "a1b2c3d4-…",
  "questionIndex": 0,
  "timeLimitSeconds": 10,
  "correlationId": "b2c3…",
  "publishedAt": "2026-05-31T20:00:20Z"
}
```

`timeLimitSeconds` is optional; defaults to the game row value.

---

### 5.4 `CloseQuestion`

Forces an **early** close of the active question — before the auto-close timer
fires. Cancels the timer and broadcasts `QUESTION_CLOSED` immediately.

Use this when you want to cut the answer window short (e.g. all players have
already answered or you want to maintain pacing).

```json
{
  "type": "CloseQuestion",
  "gameId": "a1b2c3d4-…",
  "questionIndex": 0,
  "correlationId": "c3d4…",
  "publishedAt": "2026-05-31T20:00:28Z"
}
```

`questionIndex` is optional; the orchestrator reads the current index from Redis.

---

### 5.5 `AdvanceQuestion`

Shortcut that internally executes `PrepareQuestion → StartQuestion` with a
150 ms gap. You still receive a private `QUESTION_PREPARED` event (use it for
awareness), immediately followed by the public `QUESTION_STARTED`.

Best for rapid-fire rounds where the presenter does not need a narration window.

```json
{
  "type": "AdvanceQuestion",
  "gameId": "a1b2c3d4-…",
  "timeLimitSeconds": 8,
  "correlationId": "d4e5…",
  "publishedAt": "2026-05-31T20:01:00Z"
}
```

---

### 5.6 `FinalizeGame`

Ends the game: marks DB `status='finished'`, broadcasts `GAME_ENDED`, and expires
all Redis keys.

```json
{
  "type": "FinalizeGame",
  "gameId": "a1b2c3d4-…",
  "livekitRoomName": "quiz-a1b2c3d4-…",
  "correlationId": "e5f6…",
  "publishedAt": "2026-05-31T20:05:00Z"
}
```

`livekitRoomName` is optional; defaults to `quiz-{gameId}`.

---

## 6. Events you receive on LiveKit

### 6.1 `GAME_STARTED`  *(public)*

```json
{ "type": "GAME_STARTED", "gameId": "…", "serverTime": 1748721600000 }
```

Triggered by `StartGame`. Begin your intro, then send `PrepareQuestion`.

---

### 6.2 `QUESTION_PREPARED`  *(private — only you)*

This is the most important event for the presenter. It arrives after you send
`PrepareQuestion` and contains everything you need to narrate the question.

```json
{
  "type": "QUESTION_PREPARED",
  "gameId": "…",
  "questionId": "uuid",
  "questionIndex": 0,
  "canonicalText": "What is the capital of France?",
  "options": [
    { "id": "A", "text": "Berlin" },
    { "id": "B", "text": "Paris" },
    { "id": "C", "text": "Madrid" },
    { "id": "D", "text": "Rome" }
  ],
  "correctOptionId": "B",
  "explanation": "Paris has been the French capital since 987 AD.",
  "estimatedAnswerTimeSec": 8,
  "localizedPayloads": [
    {
      "language": "en",
      "questionText": "What is the capital of France?",
      "options": [{ "id": "A", "text": "Berlin" }, { "id": "B", "text": "Paris" }, "…"]
    }
  ],
  "serverTime": 1748721605000
}
```

> **`correctOptionId` is only in this private event.** It is never sent to
> players. Guard it carefully — do not log or expose it.

---

### 6.3 `QUESTION_STARTED`  *(public)*

Sent to **all** participants when you send `StartQuestion`. Players now see the
options and a countdown timer. The `correctOptionId` is **absent**.

```json
{
  "type": "QUESTION_STARTED",
  "gameId": "…",
  "questionId": "uuid",
  "questionIndex": 0,
  "questionText": "What is the capital of France?",
  "options": [
    { "id": "A", "text": "Berlin" },
    { "id": "B", "text": "Paris" },
    { "id": "C", "text": "Madrid" },
    { "id": "D", "text": "Rome" }
  ],
  "localizedPayloads": [ "…" ],
  "startsAt": 1748721620000,
  "endsAt":   1748721630000,
  "timeLimitSeconds": 10,
  "serverTime": 1748721620000
}
```

---

### 6.4 `QUESTION_CLOSED`  *(public)*

Fired when the timer expires or you send `CloseQuestion`. All players learn the
correct answer. You should announce the result and any eliminations.

```json
{
  "type": "QUESTION_CLOSED",
  "gameId": "…",
  "questionId": "uuid",
  "questionIndex": 0,
  "correctOptionId": "B",
  "noAnswerCount": 3,
  "closedAt": 1748721630400,
  "serverTime": 1748721630400
}
```

`noAnswerCount` — players who did not answer and may have been eliminated.

---

### 6.5 `GAME_ENDED`  *(public)*

```json
{ "type": "GAME_ENDED", "gameId": "…", "serverTime": 1748721900000 }
```

Fired after `FinalizeGame`. Announce winners and close the session.

---

## 7. Scoring awareness

Players earn points per correct answer using this formula:

```
points = max(10, 100 - floor(responseTimeMs / 100))
```

- Fastest correct answer: **100 pts**
- Slowest correct answer (just before close): **10 pts**
- Wrong or no answer: **0 pts**

You can use this to add commentary: _"Only 2 seconds left on the clock — still full marks for speed!"_

---

## 8. Lives & elimination

Games can be configured with a life system. When a player runs out of lives or
exceeds `allowed_wrong_answers`, their status flips to `eliminated` and they
can no longer submit answers. They remain in the room as spectators.

You can reference `noAnswerCount` from `QUESTION_CLOSED` to mention how many
players were eliminated during that round.

---

## 9. Error handling & recovery

| Scenario | What happens | What to do |
|----------|-------------|------------|
| Double `PrepareQuestion` | Lua returns `question_already_staged`; nack in queue | Wait for `QUESTION_PREPARED` — it was already staged |
| `StartQuestion` before `PrepareQuestion` | Handler logs error, nacks; no LiveKit event | Re-send `PrepareQuestion` first |
| Orchestrator restart | Recovers from Redis: timer re-armed, staged question rebuilt | Issue `StartQuestion` if you had already received `QUESTION_PREPARED` |
| Staged question TTL (1 h) expires | Redis key gone | Re-send `PrepareQuestion` |
| `CloseQuestion` after timer already fired | Double-close is a noop (Lua guards `status != active`) | Safe to send — no harm done |
| Network partition to RabbitMQ | Messages buffered by AMQP client; redelivered on reconnect | Use durable queue + persistent messages (already configured) |

---

## 10. Complete integration example (Node.js / TypeScript)

```ts
import amqp from "amqplib";
import { Room, RoomEvent } from "livekit-client";
import { AccessToken } from "livekit-server-sdk";

const RABBITMQ_URL     = process.env.RABBITMQ_URL!;
const LK_API_KEY       = process.env.LIVEKIT_API_KEY!;
const LK_API_SECRET    = process.env.LIVEKIT_API_SECRET!;
const LK_SERVER_URL    = process.env.LIVEKIT_SERVER_URL!;
const GAME_ID          = process.env.GAME_ID!;
const PRESENTER_ID     = `ai-presenter-${GAME_ID}`;
const ROOM_NAME        = `quiz-${GAME_ID}`;
const TOTAL_QUESTIONS  = 10;

// ── Helpers ─────────────────────────────────────────────────────────────────

function send(ch: amqp.Channel, type: string, body: object) {
  const msg = JSON.stringify({
    type, gameId: GAME_ID, presenterId: PRESENTER_ID,
    correlationId: crypto.randomUUID(),
    publishedAt: new Date().toISOString(),
    ...body,
  });
  ch.sendToQueue("quiz.game.commands",
    Buffer.from(msg), { persistent: true, contentType: "application/json" });
}

function waitFor(room: Room, topic: string): Promise<object> {
  return new Promise(resolve => {
    room.on(RoomEvent.DataReceived, (raw) => {
      const evt = JSON.parse(new TextDecoder().decode(raw));
      if (evt.type === topic) resolve(evt);
    });
  });
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function runPresenter() {
  // 1. Get LiveKit JWT
  const at = new AccessToken(LK_API_KEY, LK_API_SECRET, { identity: PRESENTER_ID });
  at.addGrant({ roomJoin: true, room: ROOM_NAME, canPublish: true, canSubscribe: true });
  const token = await at.toJwt();

  // 2. Join LiveKit room
  const room = new Room();
  await room.connect(LK_SERVER_URL, token);
  console.log(`[presenter] joined room ${ROOM_NAME}`);

  // 3. Connect to RabbitMQ
  const conn = await amqp.connect(RABBITMQ_URL);
  const ch   = await conn.createChannel();
  await ch.assertQueue("quiz.game.commands", { durable: true });

  // 4. Start game
  send(ch, "StartGame", {});
  await waitFor(room, "GAME_STARTED");
  console.log("[presenter] GAME_STARTED");

  // 5. Question loop
  for (let q = 0; q < TOTAL_QUESTIONS; q++) {
    // Request question — receive private preview
    send(ch, "PrepareQuestion", { questionIndex: q });
    const prepared = await waitFor(room, "QUESTION_PREPARED") as any;
    console.log(`[presenter] Q${q}: ${prepared.canonicalText}`);
    console.log(`[presenter] Correct: ${prepared.correctOptionId} — ${prepared.explanation}`);

    // Narrate the question aloud via LiveKit audio (your TTS / voice pipeline here)
    await speak(prepared);   // ← your implementation

    // Reveal options to players
    send(ch, "StartQuestion", { questionIndex: q, timeLimitSeconds: 10 });
    await waitFor(room, "QUESTION_CLOSED");
    console.log(`[presenter] Q${q} closed`);

    // Brief pause before next question
    await new Promise(r => setTimeout(r, 3000));
  }

  // 6. End game
  send(ch, "FinalizeGame", { livekitRoomName: ROOM_NAME });
  await waitFor(room, "GAME_ENDED");
  console.log("[presenter] GAME_ENDED — session complete");

  await room.disconnect();
  await conn.close();
}

runPresenter().catch(console.error);
```

---

## 11. Checklist before going live

- [ ] Game row has `run_mode = 'presenter'` in the database
- [ ] `RABBITMQ_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_SERVER_URL` are set
- [ ] Presenter joins the LiveKit room **before** sending `StartGame`
- [ ] `presenterId` is passed in every command so private events are routed correctly
- [ ] `correlationId` is a fresh UUID for every command send
- [ ] Voice pipeline is connected to the LiveKit room with `canPublish=true`
- [ ] Error handling is in place for AMQP reconnection and LiveKit reconnection
- [ ] `correctOptionId` from `QUESTION_PREPARED` is **never logged or exposed**
