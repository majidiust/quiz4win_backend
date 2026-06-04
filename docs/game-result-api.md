# Game Result & Prize Distribution — Frontend Integration Guide

**Audience:** mobile / web frontend developers
**Backend ref:** `deploy/game-orchestrator/orchestrator.ts` · `supabase/functions/games/index.ts` · `supabase/functions/public-games/index.ts` · `supabase/migrations/20260605120000_games_result_summary.sql`
**Last updated:** 2026-06-05

This document describes how the backend exposes the **final game result** — i.e.
the aggregate "who won how much" payload that becomes available the moment
prize distribution finishes for a game.

There are **two channels** that deliver the same data, and they always agree:

| Channel | Surface | When |
|---|---|---|
| **A. LiveKit DataChannel** | `GAME_RESULT` event broadcast to the game room | Real-time — within ~1 s of the last question closing |
| **B. REST API** | `GET /public-games/:id/result` (public) and `summary` on `GET /games/:id/result` (auth) | Stable, idempotent — safe to poll / re-fetch any time after distribution |

The REST surface reads a JSONB column **persisted** by the `distribute_prizes()`
RPC, so the payload is computed exactly once and every subsequent request
returns the same bytes — no recalculation, no race conditions.

---

## 1. Lifecycle

```
… last question closes
   │
   ▼
orchestrator.finalizeGame()
   │
   ├─► games.status = 'completed', ended_at = NOW()
   ├─► broadcast { type: "GAME_ENDED", gameId, serverTime }          ← existing
   │
   ├─► CALL distribute_prizes(game_id)
   │     • locks games row, computes ranks
   │     • credits wallets (R-09 atomic), inserts 'prize' transactions (R-05)
   │     • stamps games.prizes_distributed_at + games.total_winners
   │     • writes games.result_summary  (JSONB — the persisted payload)
   │     • RETURNS the same JSONB
   │
   └─► broadcast { type: "GAME_RESULT", gameId, … summary fields … }  ← NEW
```

Order guarantees:

- `GAME_ENDED` is **always** sent first.
- `GAME_RESULT` follows once the DB has settled the prizes. If
  `distribute_prizes` is retried (safety-net tick or operator action), the
  RPC returns the **same** stored summary with `alreadyDistributed: true`
  and the orchestrator re-broadcasts — late-joining clients can always
  catch up by hitting the REST endpoint instead.

---

## 2. LiveKit event — `GAME_RESULT`

Published on the game's LiveKit room via the orchestrator's data channel, same
mechanism as `GAME_STARTED` / `QUESTION_STARTED` / `GAME_ENDED`.

```jsonc
{
  "type": "GAME_RESULT",
  "gameId": "8f3a…-…-…",
  "serverTime": 1748956123456,           // epoch ms, server clock

  "totalWinners": 8,                     // integer
  "totalPrize":   1000,                  // numeric — sum actually paid out
  "prizePool":    1000,                  // numeric — games.prize_pool at distribution
  "currency":     "USD",
  "sharePerWinner": 125,                 // totalPrize / totalWinners (0 when N=0)

  "winnerUserIds": ["uuid-1", "uuid-2", "..."],   // ordered by rank ASC

  "winners": [                                    // one row per winning participant
    { "user_id": "uuid-1", "rank": 1, "prize_amount": 125 },
    { "user_id": "uuid-2", "rank": 1, "prize_amount": 125 }
    // …
  ],

  "distributedAt": "2026-06-05T18:42:11.733Z",    // ISO 8601 UTC
  "alreadyDistributed": false                     // true on idempotent replays
}
```

Notes:

- `winners[]` reflects the actual tier breakdown — if 8 players tie at rank 1
  and each receives `$125`, you'll get 8 rows all with `rank: 1`.
- When `prize_breakdown.tiers` is `NULL` / empty, the policy is
  **winner-takes-all** (rank 1 receives 100% of `prize_pool`).
- `currency` is the ISO 4217 code stored on `games.prize_pool_currency`
  (defaults to `USD`).

### Example message (the spec's reference UX)

> *"Game completed. 8 players won the game. The total prize pool of $1,000 has
> been shared equally among 8 winners. Each winner receives $125."*

Frontend rendering hint:

```ts
const msg =
  totalWinners === 0
    ? "Game completed. No prize was awarded this round."
    : `Game completed. ${totalWinners} player${totalWinners===1?"":"s"} won the game. ` +
      `The total prize pool of ${currency} ${totalPrize.toLocaleString()} has been shared ` +
      `${tiered ? "across" : "equally among"} ${totalWinners} winners. ` +
      (tiered ? "" : `Each winner receives ${currency} ${sharePerWinner}.`);
```

(Where `tiered = winners.some(w => w.prize_amount !== sharePerWinner)`.)

---

## 3. REST API

### 3.1 `GET /public-games/:id/result` (no auth required)

The canonical, **idempotent** endpoint for the aggregate result. Safe to call
from web/marketing surfaces and unauthenticated clients.

**Response 200 — distribution complete**

```jsonc
{
  "data": {
    "game_id":               "8f3a…",
    "status":                "completed",
    "ended_at":              "2026-06-05T18:42:10.118Z",
    "prizes_distributed_at": "2026-06-05T18:42:11.733Z",
    "result": {
      "game_id":          "8f3a…",
      "total_winners":    8,
      "total_prize":      1000,
      "prize_pool":       1000,
      "currency":         "USD",
      "share_per_winner": 125,
      "winner_user_ids":  ["uuid-1", "uuid-2", "..."],
      "winners": [
        { "user_id": "uuid-1", "rank": 1, "prize_amount": 125 }
      ],
      "distributed_at":   "2026-06-05T18:42:11.733Z"
    }
  }
}
```

**Response 409 — not yet distributed**

```jsonc
// { "error": "result_pending" }       — game.status === 'completed' but result_summary still NULL
// { "error": "game_not_completed" }   — game is upcoming / open / live / cancelled
```

**Response 404 — unknown game id** → `{ "error": "game_not_found" }`

Clients that just received `GAME_ENDED` over LiveKit but no `GAME_RESULT`
should poll this endpoint with a short backoff (e.g. 500 ms → 1 s → 2 s, cap
at 5 attempts) to catch up if the data-channel event was missed.

### 3.2 `GET /games/:id/result` (JWT required) — enhanced

The existing per-user endpoint now **also** returns the aggregate summary in
the same response, so authenticated clients don't need a second round-trip:

```jsonc
{
  "data": {
    "result": {                              // unchanged contract
      "score":            420,
      "rank":             1,
      "prize_amount":     125,
      "correct_answers":  18,
      "wrong_answers":    2,
      "completed_at":     "2026-06-05T18:42:10.044Z"
    },
    "summary": { /* same shape as /public-games/:id/result → result, or null */ },
    "game_status":           "completed",
    "prizes_distributed_at": "2026-06-05T18:42:11.733Z",
    "ended_at":              "2026-06-05T18:42:10.118Z"
  }
}
```

`summary` is `null` until `distribute_prizes()` runs; treat it the same way as
a 409 from the public endpoint.

---

## 4. Database changes (for backend reference)

Migration `20260605120000_games_result_summary.sql`:

- `ALTER TABLE public.games ADD COLUMN IF NOT EXISTS result_summary JSONB;`
- `CREATE OR REPLACE FUNCTION public.distribute_prizes(uuid)` — now also
  writes `games.result_summary` and returns the JSONB on both the first run
  and idempotent replays. Pre-migration games are back-filled on first
  read (the function fills the column from `game_participants` if it's NULL
  for an already-distributed game).

No RLS changes — `public.games` already has `games_select_all FOR SELECT TO
anon USING (true)`, so the new column is readable by the anon client used by
the public edge function.

---

## 5. Backwards compatibility

- `GAME_ENDED` is unchanged. Older clients that only listen for
  `GAME_ENDED` continue to work; they simply won't render the prize summary.
- `GET /games/:id/result` adds new fields (`summary`, `game_status`,
  `prizes_distributed_at`, `ended_at`); the legacy `result` object is byte-
  identical to the previous contract.
- `GET /public-games/:id/result` is brand-new — no existing clients depend on it.

---

## 6. Error handling checklist

| Scenario | Channel | Symptom | Client action |
|---|---|---|---|
| Game still live | API | 409 `game_not_completed` | Wait for `GAME_ENDED` over LiveKit |
| Distribution in flight | API | 409 `result_pending` | Poll with backoff (≤5 s total) |
| Missed `GAME_RESULT` event (reconnect, app backgrounded) | LiveKit | No event received | Call REST endpoint once reconnected |
| Orchestrator restart between `GAME_ENDED` and prize RPC | LiveKit | `GAME_ENDED` arrives, `GAME_RESULT` does not | Safety-net retries the RPC and re-broadcasts; otherwise REST gives the final answer |

---

## 7. Deploy notes (backend)

```bash
# 1. Apply DB migration
docker compose up -d --force-recreate db-maintainer

# 2. Rebuild orchestrator with the new broadcast
docker compose up -d --build --force-recreate game-orchestrator

# 3. Deploy edge functions
supabase functions deploy public-games games
```

No environment variables added; no infra changes required.
