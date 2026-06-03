# Quiz4Win — Pregame Warmup API (Frontend Integration)

**Version:** 1.0 — 2026-06-05
**Audience:** Mobile / Web client developers
**Owner:** Backend (game-orchestrator)

This document describes the changes to the live-game protocol that introduce a
visible **pregame warmup countdown** between the moment a game flips to `live`
and the moment the **first question (`questionIndex = 0`)** is broadcast.

The countdown screen is the UI surface for the requirement:

> *“There is a 2-minute gap between the game start time and the generation of
> the first question. During this period the app should display an exciting
> pre-question countdown screen with a large animated timer and a message such
> as ‘Get ready! The first question is being generated…’.”*

---

## 1. Server-side behavior (what the orchestrator does now)

For every **auto-mode** game:

1. On `StartGame`, the orchestrator:
   - Sets `games.status = 'live'`.
   - Computes `firstQuestionStartsAt = now + PREGAME_WARMUP_MS` (default
     `120000` ms = 2 minutes; configurable via env var `PREGAME_WARMUP_MS`).
   - Persists `games.first_question_starts_at = firstQuestionStartsAt` (new
     column — see §4).
   - Broadcasts a **`GAME_STARTED`** LiveKit data message that now includes
     the warmup metadata (see §2).
   - Begins **pre-generating** the first batch of questions **in parallel**
     with the countdown (so OpenAI latency is hidden behind the visible timer).
2. After `PREGAME_WARMUP_MS` elapses, the orchestrator broadcasts the first
   **`QUESTION_STARTED`** event exactly as before.

For **presenter-mode** games the warmup is not used (`firstQuestionStartsAt =
null`, `pregameDurationMs = 0`); the AI Presenter drives question timing.

---

## 2. `GAME_STARTED` event — updated payload

LiveKit DataChannel message, topic `GAME_STARTED`, sent to all room
participants.

### Before

```json
{ "type": "GAME_STARTED", "gameId": "…", "serverTime": 1730000000000 }
```

### After

```json
{
  "type": "GAME_STARTED",
  "gameId": "5f3b…",
  "serverTime": 1730000000000,
  "runMode": "auto",
  "pregameDurationMs": 120000,
  "firstQuestionStartsAt": 1730000120000,
  "recovered": false
}
```

### Field reference

| Field | Type | Description |
|---|---|---|
| `type` | `"GAME_STARTED"` | Constant. |
| `gameId` | UUID string | The game id. |
| `serverTime` | epoch ms (number) | Server clock at broadcast — use for client clock-skew correction. |
| `runMode` | `"auto"` \| `"presenter"` | Game mode. Only `"auto"` has a warmup. |
| `pregameDurationMs` | number | Total warmup window. `120000` for auto by default; `0` for presenter. |
| `firstQuestionStartsAt` | epoch ms \| `null` | Absolute UTC instant at which question 0 is expected to start. `null` in presenter mode. |
| `recovered` | boolean (optional) | `true` only when the orchestrator restarted mid-warmup and is re-broadcasting `GAME_STARTED` so reconnecting clients can re-sync. Treat the same as a fresh `GAME_STARTED`. |

### Notes
- All timestamps are **UTC epoch milliseconds (number)**.
- `firstQuestionStartsAt` is authoritative — prefer it over computing
  `serverTime + pregameDurationMs` (they will normally agree, but the former
  survives orchestrator restarts; see §5).
- Apply clock-skew correction once on connect:
  `skewMs = serverTime - Date.now()` at the moment of receipt, and use
  `firstQuestionStartsAt - Date.now() - skewMs` as the remaining countdown.

---

## 3. Recommended client UX

1. On `GAME_STARTED` with `runMode === "auto"` and
   `firstQuestionStartsAt != null`:
   - Push the **Pregame Countdown** screen.
   - Show a large animated timer counting down to `firstQuestionStartsAt`.
   - Show the message **“Get ready! The first question is being generated…”**
     (localizable).
2. When `firstQuestionStartsAt - now <= 0`, keep the screen visible until the
   first `QUESTION_STARTED` event arrives (small UI grace, ~1–2 s).
3. On `QUESTION_STARTED` (questionIndex 0), navigate to the live-question
   screen.
4. **Late join / reconnect during warmup**:
   - Fetch the game row (`GET /rest/v1/games?id=eq.<gameId>&select=…,first_question_starts_at,started_at,status`).
   - If `status === "live"` and `first_question_starts_at` is in the future,
     show the same countdown screen anchored to that timestamp.
   - You may also receive a `GAME_STARTED` with `recovered: true` if the
     orchestrator restarted — re-sync the timer from its payload.
5. **Presenter mode** (`runMode === "presenter"`): do not show the warmup
   screen; go directly to a "waiting for host" screen as before.

---

## 4. Database — new column

```sql
ALTER TABLE public.games
    ADD COLUMN IF NOT EXISTS first_question_starts_at TIMESTAMPTZ;
```

Migration file: `supabase/migrations/20260605000000_games_first_question_starts_at.sql`

- Nullable; populated only for auto-mode games when `StartGame` runs.
- Readable via REST under existing `games` RLS (same visibility as
  `started_at`).
- Clients should rely on the LiveKit event for live games; the column is the
  source of truth for **late joiners / reconnects**.

---

## 5. Recovery semantics

If the orchestrator restarts during the warmup:

- The next `recoverRunningGames` pass finds the live game with no question
  index in Redis yet, computes the remaining warmup from
  `first_question_starts_at`, **re-broadcasts** `GAME_STARTED` with
  `recovered: true` and the original `firstQuestionStartsAt`, and resumes the
  countdown / question loop.
- Clients that were connected throughout will receive a second `GAME_STARTED`
  with `recovered: true`; simply re-anchor the countdown to its
  `firstQuestionStartsAt` — do not reset to zero.

---

## 6. Configuration

| Env var | Default | Meaning |
|---|---|---|
| `PREGAME_WARMUP_MS` | `120000` | Auto-mode warmup duration in milliseconds. Set to `0` to disable (not recommended in production). |

---

## 7. Backwards compatibility

- Old clients ignore the new fields and will still receive `GAME_STARTED`,
  followed by `QUESTION_STARTED` 2 minutes later — they will simply not show
  a countdown.
- New clients must tolerate the **absence** of the new fields (treat them as
  `runMode = "auto"`, `pregameDurationMs = 0`, `firstQuestionStartsAt = null`)
  in case the orchestrator is rolled back.
