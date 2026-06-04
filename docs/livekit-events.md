# Quiz4Win — LiveKit DataChannel Events (Frontend Reference)

All real-time game events are pushed on the **LiveKit room data channel** by the
Game Orchestrator. There is no Supabase Realtime. The client gets a LiveKit
token from `POST /game-session/:id/join`, connects to the room, and listens for
`Room.on(RoomEvent.DataReceived)`. The payload is UTF-8 JSON.

Every payload includes:
- `type` — the event name (table below)
- `topic` — equal to `type` (also set as LiveKit's `topic` field; usable for filtering)
- `gameId` — UUID of the game
- `serverTime` — server epoch ms, stamped the instant the event is sent (immediately before the LiveKit `SendData` call, after all DB/Redis work). Use it for **clock-offset correction**: on receipt compute `clockOffset = serverTime - Date.now()`, then schedule everything against the event's *absolute* timestamps — `firstQuestionStartsAt` (GAME_STARTED), `startsAt`/`endsAt` (QUESTION_STARTED) — as `localTarget = absoluteTimestamp - clockOffset`. Do **not** derive countdowns from `serverTime + duration`; the absolute fields are authoritative and identical for every participant (a single server-side broadcast), so each client lands on the same wall-clock moment regardless of its own network latency.

Lifecycle ordering for one game:
`GAME_STARTED` → (`QUESTION_PREPARED` for presenter mode only) → `QUESTION_STARTED` → `PLAYER_WRONG_ANSWER` / `PLAYER_ELIMINATED` (zero or more, any time inside a question window or at close) → `QUESTION_CLOSED` → (loop) → `GAME_ENDED` → `GAME_RESULT`.

---

## 1. `GAME_STARTED`
Fires when the game enters the running state. Auto mode emits this immediately and the first question fires `pregameDurationMs` later (default 120 000 ms). Re-broadcast on orchestrator restart with `recovered: true`.

| Field | Description |
|-------|-------------|
| `languages` | All languages this game's questions are generated in (subset of `["en","ar","fa","tr"]`). Use this to build the in-game language switcher before the first `QUESTION_STARTED`. |
| `category` | Game category (e.g. `"science"`, `"sports"`, `"mixed"`). Display in the pre-game lobby. |

```json
{
  "type": "GAME_STARTED", "topic": "GAME_STARTED",
  "gameId": "uuid", "serverTime": 1748721600000,
  "runMode": "auto",
  "pregameDurationMs": 120000,
  "firstQuestionStartsAt": 1748721720000,
  "languages": ["en", "ar", "fa", "tr"],
  "category": "science",
  "recovered": false
}
```
`firstQuestionStartsAt` is `null` in presenter mode. Render a countdown to `firstQuestionStartsAt`.

## 2. `QUESTION_PREPARED` *(presenter mode only — private)*
Sent **only** to the AI presenter identity via per-identity broadcast — regular clients will not receive it. Carries `correctOptionId` (presenter needs it; players must not).
```json
{
  "type": "QUESTION_PREPARED", "topic": "QUESTION_PREPARED",
  "gameId": "uuid", "questionId": "uuid", "questionIndex": 0,
  "canonicalText": "Which planet is closest to the Sun?",
  "options": [{"id":"A","text":"Mercury"}, {"id":"B","text":"Venus"}, {"id":"C","text":"Earth"}, {"id":"D","text":"Mars"}],
  "correctOptionId": "A",
  "explanation": "Mercury is the innermost planet.",
  "estimatedAnswerTimeSec": 15,
  "localizedPayloads": [{"language":"en","questionText":"...","options":[...]}],
  "serverTime": 1748721720000
}
```

## 3. `QUESTION_STARTED`
Question is live. Start a countdown to `endsAt`. Enable answer buttons. **No `correctOptionId`** — that ships in `QUESTION_CLOSED`.

| Field | Type | Description |
|-------|------|-------------|
| `questionText` | `string` | Canonical question text (in `primaryLanguage`). |
| `options` | `Option[]` | Canonical options (in `primaryLanguage`). |
| `primaryLanguage` | `string` | The game's primary display language (first element of `languages`). Use this to select the default `localizedPayloads` entry for display. |
| `languages` | `string[]` | Full set of languages this question was generated in — one `localizedPayloads` entry per code. |
| `localizedPayloads` | `Localized[]` | One entry per language. Each entry has `language`, `questionText`, and `options` (same option IDs across all languages). |
| `startsAt` / `endsAt` | `number` | Absolute epoch-ms timestamps. Schedule your countdown as `endsAt - clockOffset` (see §0). |

```json
{
  "type": "QUESTION_STARTED",
  "topic": "QUESTION_STARTED",
  "gameId": "a1b2c3d4-0000-0000-0000-000000000001",
  "questionId": "q9f8e7d6-0000-0000-0000-000000000001",
  "questionIndex": 0,
  "questionText": "Which planet is closest to the Sun?",
  "options": [
    { "id": "A", "text": "Mercury" },
    { "id": "B", "text": "Venus" },
    { "id": "C", "text": "Earth" },
    { "id": "D", "text": "Mars" }
  ],
  "primaryLanguage": "en",
  "languages": ["en", "ar", "fa", "tr"],
  "localizedPayloads": [
    {
      "language": "en",
      "questionText": "Which planet is closest to the Sun?",
      "options": [
        { "id": "A", "text": "Mercury" },
        { "id": "B", "text": "Venus" },
        { "id": "C", "text": "Earth" },
        { "id": "D", "text": "Mars" }
      ]
    },
    {
      "language": "ar",
      "questionText": "أي كوكب هو الأقرب إلى الشمس؟",
      "options": [
        { "id": "A", "text": "عطارد" },
        { "id": "B", "text": "الزهرة" },
        { "id": "C", "text": "الأرض" },
        { "id": "D", "text": "المريخ" }
      ]
    },
    {
      "language": "fa",
      "questionText": "کدام سیاره به خورشید نزدیک‌تر است؟",
      "options": [
        { "id": "A", "text": "عطارد" },
        { "id": "B", "text": "زهره" },
        { "id": "C", "text": "زمین" },
        { "id": "D", "text": "مریخ" }
      ]
    },
    {
      "language": "tr",
      "questionText": "Güneş'e en yakın gezegen hangisidir?",
      "options": [
        { "id": "A", "text": "Merkür" },
        { "id": "B", "text": "Venüs" },
        { "id": "C", "text": "Dünya" },
        { "id": "D", "text": "Mars" }
      ]
    }
  ],
  "startsAt": 1748721720000,
  "endsAt": 1748721735000,
  "timeLimitSeconds": 15,
  "serverTime": 1748721720050
}
```

**Client rendering guidance:** use `primaryLanguage` to select the default `localizedPayloads` entry on first render; offer a language switcher built from `languages` so the user can toggle to their preferred language without a round-trip.

## 4. `PLAYER_WRONG_ANSWER`
A player lost a chance but is still in the game. Fires both for wrong submissions (immediately after the answer is processed) and for no-answer / late / disconnected players (at question close).
```json
{
  "type": "PLAYER_WRONG_ANSWER", "topic": "PLAYER_WRONG_ANSWER",
  "gameId": "uuid", "userId": "uuid",
  "wrongAnswersCount": 1, "remainingChances": 1,
  "reason": "WRONG_ANSWER",
  "serverTime": 1748721735200
}
```
`reason` ∈ `"WRONG_ANSWER" | "NO_ANSWER" | "TIMEOUT"`. `remainingChances` is `null` if the game has no life limit.

**Late join:** when a player joins after questions have started (under the `first_question_only` policy) and the missed questions do **not** exceed the limit, this event fires once with `reason="NO_ANSWER"` and `wrongAnswersCount` pre-charged to the number of missed questions (see §5 and INV-14).

## 5. `PLAYER_ELIMINATED`
A player has used all chances. Update local state to spectator; the server will reject any further answer submissions from this user with `reason="eliminated_cannot_answer"`. Eliminated players are excluded from final ranking and the prize pool. Also carries a post-elimination game snapshot so the HUD can be updated without a REST round-trip.
```json
{
  "type": "PLAYER_ELIMINATED", "topic": "PLAYER_ELIMINATED",
  "gameId": "uuid", "userId": "uuid",
  "wrongAnswersCount": 2, "allowed_wrong_answers": 2,
  "remainingChances": 0, "status": "SPECTATOR",
  "reason": "WRONG_ANSWER",
  "questionId": "uuid", "questionIndex": 4,
  "eliminatedAt": 1748721735200,
  "eliminatedCount": 16,
  "activeSurvivorCount": 84,
  "prizePool": 500.00,
  "projectedPrizePerSurvivor": 5.95,
  "serverTime": 1748721735200
}
```
`eliminatedCount` — cumulative total eliminated so far. `activeSurvivorCount` — players still in the game after this elimination. `prizePool` / `projectedPrizePerSurvivor` are `null` if the game has no configured prize pool.

**Late-join demotion:** when a player joins so late that their missed questions already meet/exceed `allowed_wrong_answers` (INV-14), they are demoted to spectator on arrival. This event then carries `reason="NO_ANSWER"`, `lateJoin: true`, and `missedQuestions` (the number of questions counted against them). Because the joiner never occupied a survivor slot, the game-snapshot fields (`questionId`, `questionIndex`, `eliminatedAt`, `eliminatedCount`, `activeSurvivorCount`, `prizePool`, `projectedPrizePerSurvivor`) are omitted from the late-join variant.

## 6. `USER_ELIMINATED` *(legacy — kept for back-compat)*
Emitted alongside every `PLAYER_ELIMINATED`. New clients should consume `PLAYER_ELIMINATED` and ignore this one. Slated for removal once the iOS/Android builds shipped before 2026-06-05 are out of the field.
```json
{
  "type": "USER_ELIMINATED", "topic": "USER_ELIMINATED",
  "gameId": "uuid", "userId": "uuid",
  "reason": "wrong_answer",
  "wrongCount": 2, "remainingLives": 0,
  "questionId": "uuid", "questionIndex": 4,
  "eliminatedAt": 1748721735200, "serverTime": 1748721735200
}
```

## 7. `QUESTION_CLOSED`
Answer window has closed. Reveal the correct option. `noAnswerCount` is the number of players who did not submit (Redis not-answered + ghost sweep); `noAnswerEliminatedCount` is the subset of those who were eliminated by this close. Also carries a post-close game snapshot so the HUD (survivor count, prize projection) can be updated from this single event.

`prizePool` and `projectedPrizePerSurvivor` are dollar amounts (NUMERIC, 2 decimal places) matching the game's `prize_pool` column. Both are `null` when the game has no configured prize pool.
```json
{
  "type": "QUESTION_CLOSED", "topic": "QUESTION_CLOSED",
  "gameId": "uuid", "questionId": "uuid", "questionIndex": 0,
  "correctOptionId": "A",
  "noAnswerCount": 3, "noAnswerEliminatedCount": 1,
  "eliminatedCount": 15,
  "activeSurvivorCount": 85,
  "prizePool": 500.00,
  "projectedPrizePerSurvivor": 5.88,
  "closedAt": 1748721735200, "serverTime": 1748721735200
}
```

## 8. `GAME_ENDED`
Last question is closed. The game has finished; ranks/prizes have not yet been distributed at this point — wait for `GAME_RESULT`.
```json
{ "type": "GAME_ENDED", "topic": "GAME_ENDED", "gameId": "uuid", "serverTime": 1748721900000 }
```

## 9. `GAME_RESULT`
Prize distribution complete. Render the podium / "X winners share $Y" screen from this payload — no extra REST round-trip required. `alreadyDistributed: true` means a previous orchestrator instance already paid out (idempotent replay).
```json
{
  "type": "GAME_RESULT", "topic": "GAME_RESULT",
  "gameId": "uuid", "serverTime": 1748721901000,
  "totalWinners": 3, "totalPrize": 250.00,
  "prizePool": 500.00, "currency": "USD",
  "sharePerWinner": 83.33,
  "winnerUserIds": ["uuid", "uuid", "uuid"],
  "winners": [{"user_id":"uuid","rank":1,"prize_amount":125.00}, {"user_id":"uuid","rank":2,"prize_amount":75.00}, {"user_id":"uuid","rank":3,"prize_amount":50.00}],
  "distributedAt": "2026-05-25T20:42:11Z",
  "alreadyDistributed": false
}
```

---

## Reconnection / catch-up
If the client missed events (e.g. backgrounded, network drop), use REST to re-sync:
- `GET /game-session/:id/state` — current question, your `wrongCount` / `remainingLives` / `userStatus`, server time.
- `GET /games/:id/result` or `GET /public-games/:id/result` — final summary (mirrors `GAME_RESULT`) for games where the user missed the event.
- `GET /games/history` — list of past games with the caller's per-game participation row.

Do **not** poll continuously — LiveKit is the push channel. Poll only on reconnect or app foreground.

## TypeScript discriminated union (paste into `types/game-events.ts`)
```ts
type Reason = "WRONG_ANSWER" | "NO_ANSWER" | "TIMEOUT";
type Option = { id: string; text: string };
type Localized = { language: string; questionText: string; options: Option[] };
export type GameEvent =
  | { type: "GAME_STARTED"; gameId: string; runMode: "auto"|"presenter"; pregameDurationMs: number; firstQuestionStartsAt: number|null; languages: string[]; category: string; recovered?: boolean; serverTime: number }
  | { type: "QUESTION_STARTED"; gameId: string; questionId: string; questionIndex: number; questionText: string; options: Option[]; primaryLanguage: string; languages: string[]; localizedPayloads: Localized[]; startsAt: number; endsAt: number; timeLimitSeconds: number; serverTime: number }
  | { type: "PLAYER_WRONG_ANSWER"; gameId: string; userId: string; wrongAnswersCount: number; remainingChances: number|null; reason: Reason; serverTime: number }
  | { type: "PLAYER_ELIMINATED"; gameId: string; userId: string; wrongAnswersCount: number; allowed_wrong_answers: number|null; remainingChances: number|null; status: "SPECTATOR"; reason: Reason; questionId?: string|null; questionIndex?: number|null; eliminatedAt?: number; eliminatedCount?: number; activeSurvivorCount?: number; prizePool?: number|null; projectedPrizePerSurvivor?: number|null; lateJoin?: boolean; missedQuestions?: number; serverTime: number }
  | { type: "QUESTION_CLOSED"; gameId: string; questionId: string; questionIndex: number; correctOptionId: string; noAnswerCount: number; noAnswerEliminatedCount: number; eliminatedCount: number; activeSurvivorCount: number; prizePool: number|null; projectedPrizePerSurvivor: number|null; closedAt: number; serverTime: number }
  | { type: "GAME_ENDED"; gameId: string; serverTime: number }
  | { type: "GAME_RESULT"; gameId: string; totalWinners: number; totalPrize: number; prizePool: number; currency: string; sharePerWinner: number; winnerUserIds: string[]; winners: {user_id:string;rank:number;prize_amount:number}[]; distributedAt: string|null; alreadyDistributed: boolean; serverTime: number };
```
