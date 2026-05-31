# Quiz4Win — Player & Spectator Integration Guide

**Audience:** Mobile / web app engineering team building the client app.  
**Last updated:** 2026-05-31  
**Base URL:** `{SUPABASE_URL}/functions/v1/game-session`

---

## Overview

A customer participates in a live quiz through three mechanisms:

| Channel | Purpose |
|---------|---------|
| **REST API** (`game-session` edge function) | Join game, poll state, submit answers |
| **LiveKit DataChannel** | Real-time events (question start, timer, results) |
| **LiveKit Audio** | Hear the AI Presenter narrating the game |

The flow for every player session is:

```
Authenticate (Supabase JWT)
    ↓
POST /game-session/:id/join    ← get LiveKit token + initial state
    ↓
Connect to LiveKit room        ← subscribe to real-time events
    ↓
Receive QUESTION_STARTED       ← show options + countdown
    ↓
POST /game-session/:id/answer  ← submit selected option
    ↓
Receive QUESTION_CLOSED        ← learn correct answer
    ↓
... repeat for all questions ...
    ↓
Receive GAME_ENDED             ← show final scores
```

---

## 1. Authentication

All requests require a **Supabase JWT** in the `Authorization` header:

```
Authorization: Bearer <supabase-access-token>
```

Obtain the token via Supabase Auth (email/password, OAuth, magic link, etc.).
The token identifies the user and is validated server-side before every operation.

---

## 2. Joining a game

### Request

```
POST /game-session/{gameId}/join
Authorization: Bearer <token>
Content-Type: application/json
```

```json
{
  "session_id": "optional-client-session-uuid",
  "device_id":  "optional-device-identifier",
  "language":   "en"
}
```

| Field        | Type   | Required | Description |
|--------------|--------|----------|-------------|
| `session_id` | string | no       | Client-generated UUID; used for reconnection tracking |
| `device_id`  | string | no       | Device fingerprint; used for audit |
| `language`   | string | no       | Preferred language code (`en`, `tr`, etc.); defaults to `en` |

### Success response  `200`

```json
{
  "userStatus": "participant",
  "reconnect": false,
  "wrongCount": 0,
  "remainingLives": 3,
  "correctCount": 0,
  "gameStatus": "running",
  "currentQuestionId": "uuid-or-null",
  "currentQuestionIndex": 0,
  "questionEndsAt": 1748721630000,
  "remainingTimeMs": 7340,
  "canSubmitAnswer": true,
  "serverTime": 1748721622660,
  "livekit": {
    "roomName": "quiz-a1b2c3d4-…",
    "token":    "<livekit-jwt>"
  },
  "language": "en"
}
```

| Field                  | Description |
|------------------------|-------------|
| `userStatus`           | `participant`, `spectator`, or `eliminated` |
| `reconnect`            | `true` if you were already in the game (session resumed) |
| `wrongCount`           | Number of wrong/missed answers so far |
| `remainingLives`       | Lives left (`null` if the game has no life limit) |
| `correctCount`         | Correct answers so far |
| `gameStatus`           | `open`, `running`, or `finished` |
| `currentQuestionId`    | Active question UUID, or `null` between questions |
| `currentQuestionIndex` | 0-based question number, or `null` |
| `questionEndsAt`       | Epoch ms when the current question closes |
| `remainingTimeMs`      | Milliseconds left to answer (`null` if no active question) |
| `canSubmitAnswer`      | `true` only when `userStatus === "participant"` |
| `livekit.roomName`     | LiveKit room to join |
| `livekit.token`        | Signed JWT — use it to connect to LiveKit |

### Error responses

| Code | Reason | Description |
|------|--------|-------------|
| 401  | `unauthorized` | Missing or invalid Supabase JWT |
| 404  | `game_not_found` | `gameId` does not exist |
| 400  | `game_not_joinable` | Game status is not `open` or `live` |
| 400  | `game_not_found` (Redis) | Game not yet initialised in Redis |
| 400  | `join_closed` | Join policy is `closed` |

---

## 3. User statuses

| Status        | Can answer? | In room? | Description |
|---------------|-------------|----------|-------------|
| `participant` | ✅ yes       | ✅ yes   | Active player |
| `spectator`   | ❌ no        | ✅ yes   | Joined late or after join window |
| `eliminated`  | ❌ no        | ✅ yes   | Ran out of lives or too many wrong answers |

Players who join **after the first question has started** are assigned
`spectator` status unless the game has `join_policy = 'any_time'`.

---

## 4. Connecting to LiveKit

Use the `livekit.token` and `livekit.roomName` from the join response.
Install any [LiveKit client SDK](https://docs.livekit.io/client-sdk/).

```ts
import { Room, RoomEvent } from "livekit-client";

const room = new Room();
await room.connect(LIVEKIT_SERVER_URL, token);

room.on(RoomEvent.DataReceived, (payload, participant, kind, topic) => {
  const event = JSON.parse(new TextDecoder().decode(payload));
  handleEvent(event.type, event);
});
```

**Audio:** The AI Presenter publishes audio to the room. Subscribe to
participant tracks as normal to play the presenter's voice:

```ts
room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
  if (track.kind === "audio") track.attach();
});
```

---

## 5. LiveKit events

All events are JSON objects delivered via the DataChannel. Filter by
`event.type`.

### 5.1 `GAME_STARTED`

The game has officially begun. Show the game UI and wait for the first question.

```json
{ "type": "GAME_STARTED", "gameId": "…", "serverTime": 1748721600000 }
```

---

### 5.2 `QUESTION_STARTED`

A new question is now active. Players can submit answers immediately.
Start your countdown timer using `endsAt - serverTime`.

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
  "localizedPayloads": [
    {
      "language": "en",
      "questionText": "What is the capital of France?",
      "options": [{ "id": "A", "text": "Berlin" }, "…"]
    }
  ],
  "startsAt": 1748721620000,
  "endsAt":   1748721630000,
  "timeLimitSeconds": 10,
  "serverTime": 1748721620000
}
```

> The `correctOptionId` is **never** included in this event.

**Countdown implementation:**

```ts
const remainingMs = event.endsAt - Date.now();
startCountdown(remainingMs);
```

Use `localizedPayloads` to display the question in the player's preferred language.

---

### 5.3 `QUESTION_CLOSED`

The answer window has closed (timer expired or presenter closed early).
The correct answer is now revealed. Disable the answer UI.

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

| Field           | Description |
|-----------------|-------------|
| `correctOptionId` | Highlight this option as correct on-screen |
| `noAnswerCount`   | Number of players who did not answer (for display only) |

---

### 5.4 `GAME_ENDED`

The game is over. Navigate to the results / leaderboard screen.

```json
{ "type": "GAME_ENDED", "gameId": "…", "serverTime": 1748721900000 }
```

---

## 6. Submitting an answer

### Request

```
POST /game-session/{gameId}/answer
Authorization: Bearer <token>
Content-Type: application/json
```

```json
{
  "question_id":       "uuid-of-current-question",
  "selected_option_id": "B",
  "attempt_id":         "client-generated-uuid",
  "response_time_ms":   3200,
  "session_id":         "your-session-uuid"
}
```

| Field                | Type   | Required | Description |
|----------------------|--------|----------|-------------|
| `question_id`        | uuid   | yes      | From `QUESTION_STARTED` event |
| `selected_option_id` | string | yes      | `A`, `B`, `C`, or `D` |
| `attempt_id`         | uuid   | yes      | Unique per submission — used for idempotency |
| `response_time_ms`   | number | no       | Elapsed ms since `QUESTION_STARTED.startsAt`; used for scoring |
| `session_id`         | string | no       | Same as join session ID |

> **Generate `attempt_id` fresh for each submission.** Re-sending the same
> `attempt_id` returns the cached result (idempotency — safe to retry on
> network failure).

### Success response  `200`

```json
{
  "result": {
    "status": "accepted",
    "isCorrect": true,
    "correctOptionId": "B",
    "pointsEarned": 68,
    "wrongCount": 0,
    "remainingLives": 3,
    "participantRole": "participant",
    "eliminated": false,
    "eliminationReason": null,
    "questionId": "uuid",
    "questionIndex": 0,
    "startsAt": 1748721620000,
    "endsAt":   1748721630000,
    "serverTime": 1748721623200
  }
}
```

| Field              | Description |
|--------------------|-------------|
| `status`           | `accepted` or `rejected` (see §6.1) |
| `isCorrect`        | Whether the selected option was correct |
| `correctOptionId`  | Correct option — reveal immediately on `accepted` |
| `pointsEarned`     | Points awarded this round (`0` if wrong) |
| `wrongCount`       | Total wrong answers including this one |
| `remainingLives`   | Lives remaining (`null` if no life limit) |
| `participantRole`  | `participant` or `eliminated` after this answer |
| `eliminated`       | `true` if this answer caused elimination |
| `eliminationReason`| `wrong_answer_lives_zero`, `max_wrong_exceeded`, or `null` |

---

### 6.1 Rejection reasons

When `status = "rejected"` the `reason` field explains why:

| Reason | Cause | What to do |
|--------|-------|------------|
| `not_joined` | User not in game | Call `/join` first |
| `participant_cannot_answer` | User is spectator or eliminated | Show spectator/eliminated UI |
| `eliminated_cannot_answer` | Already eliminated | Show eliminated screen |
| `game_not_running` | Game not live | Show waiting or results screen |
| `question_not_active` | Wrong `question_id` | Sync from `/state` |
| `question_closed` | Question window has closed | Too late — wait for next question |
| `late` | Server received after `endsAt + gracePeriodMs` | Animation: _"too slow"_ |
| `duplicate` | Already answered this question | Show existing answer |

---

## 7. Scoring formula

Points per correct answer:

```
points = max(10, 100 - floor(responseTimeMs / 100))
```

| Response time | Points |
|--------------|--------|
| 0 – 0.9 s    | 100    |
| 1.0 s        | 90     |
| 5.0 s        | 50     |
| 9.0+ s       | 10     |

Wrong or no answer: **0 pts**.

---

## 8. Lives & elimination

Games may be configured with a limited number of lives (`allowed_wrong_answers`
on the game row). Each wrong answer or no-answer costs one life.

When `remainingLives` reaches `0`:
- `eliminated = true` in the answer response
- `participantRole` becomes `"eliminated"`
- The player can no longer answer but remains in the room to watch

Display an elimination screen and switch to spectator view.

---

## 9. Polling game state

Use this endpoint to refresh state after reconnecting or when your LiveKit
connection was interrupted. **Do not poll continuously** — use LiveKit events
as the primary push mechanism.

### Request

```
GET /game-session/{gameId}/state?lang=en
Authorization: Bearer <token>
```

### Response

```json
{
  "source": "redis",
  "gameStatus": "running",
  "gameMode": "presenter",
  "participantCount": 142,
  "currentQuestionIndex": 3,
  "currentQuestionStatus": "active",
  "questionEndsAt": 1748721680000,
  "remainingTimeMs": 4200,
  "me": {
    "userStatus": "participant",
    "wrongCount": 1,
    "correctCount": 2,
    "remainingLives": 2,
    "canSubmitAnswer": true
  },
  "question": {
    "questionId": "uuid",
    "questionIndex": 3,
    "status": "active",
    "startsAt": 1748721676000,
    "endsAt":   1748721686000,
    "gracePeriodMs": "400",
    "localized": {
      "language": "en",
      "questionText": "Which planet is closest to the Sun?",
      "options": [
        { "id": "A", "text": "Venus" },
        { "id": "B", "text": "Mercury" },
        { "id": "C", "text": "Mars" },
        { "id": "D", "text": "Earth" }
      ]
    }
  },
  "serverTime": 1748721681800
}
```

> `correctOptionId` is **never** included in the state response.

If the game has not started yet (Redis not initialised), `source` will be
`"db"` and only basic game metadata is returned.

---

## 10. Reconnection

If the app goes to the background or loses network connectivity:

1. Call `POST /join` again with the same `session_id` and `device_id`.
2. The response will contain `"reconnect": true` and your current state
   (`wrongCount`, `remainingLives`, `userStatus`).
3. Connect to the LiveKit room again using the new token in the response.
4. Call `GET /state` to re-sync the current question.

The server preserves all your progress. There is no penalty for reconnecting.

---

## 11. Timing & grace period

The server applies a **grace period** (default 400 ms, configurable per game)
after `endsAt`. Answers received within `endsAt + 400 ms` are still accepted
as on-time. This compensates for network latency.

```
|───── answer window ─────|── grace (400ms) ──|─ rejected ─►
0                        10s               10.4s
```

The countdown timer in your UI should count to `endsAt`, not `endsAt + grace`,
so players who see the timer hit zero know they must have already tapped.

---

## 12. Localisation

The `localizedPayloads` array in `QUESTION_STARTED` contains the question in
all supported languages. Pick the one matching your user's language setting:

```ts
const locale = userPreferredLanguage ?? "en";
const localized = event.localizedPayloads.find(p => p.language === locale)
               ?? event.localizedPayloads[0];

showQuestion(localized.questionText, localized.options);
```

---

## 13. Quick reference — HTTP endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/game-session/{id}/join` | JWT | Join game, get LiveKit token |
| `GET`  | `/game-session/{id}/state` | JWT | Poll current game + user state |
| `POST` | `/game-session/{id}/answer` | JWT | Submit answer |

---

## 14. Quick reference — LiveKit events

| Topic | Audience | When |
|-------|----------|------|
| `GAME_STARTED` | All | Game goes live |
| `QUESTION_STARTED` | All | Question becomes active; timer starts |
| `QUESTION_CLOSED` | All | Timer expires or presenter closes early |
| `GAME_ENDED` | All | Game finalized |

> `QUESTION_PREPARED` is private to the AI Presenter and is **never** sent to players.
