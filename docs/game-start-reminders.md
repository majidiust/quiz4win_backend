# Game Start Reminders — Push Notification Mechanism

**Service:** `template-generator`
**Files:**
- `deploy/template-generator/generator.ts` — `reminderTick()` + helper functions
- `deploy/template-generator/fcm.ts` — Firebase Cloud Messaging sender
- `supabase/migrations/20260531180000_games_start_reminders.sql` — schema

---

## Overview

The template-generator service sends FCM push notifications to players **before a game starts** at three fixed time windows:

| Window | Notification body |
|--------|------------------|
| T − 60 min | `<Game Title>` · _Starts in 1 hour — prize {prize_pool}_ |
| T − 10 min | `<Game Title>` · _Starts in 10 minutes — prize {prize_pool}_ |
| T − 1 min  | `<Game Title>` · _Starts in 1 minute — prize {prize_pool}_ |

Each reminder is **sent exactly once per game** — idempotency is enforced at the database level. If the service restarts mid-tick the reminder will not be duplicated.

---

## How It Works — Step by Step

### 1. Tick loop (every 60 seconds)

`fullTick()` runs every `TEMPLATE_GEN_INTERVAL_MS` (default 60 000 ms). It calls three sub-tasks **in parallel**:

```
fullTick()
 ├── tick()           — generate games from templates
 ├── schedulerTick()  — detect and start games whose time has arrived
 └── reminderTick()   — send FCM push reminders (3 windows)
```

`reminderTick()` is a no-op when the Firebase service-account JSON is not mounted (`isFcmConfigured() → false`).

---

### 2. Reminder windows

For each window `[60, 10, 1]` minutes, `processReminderWindow()` runs the following query via PostgREST:

```
GET /rest/v1/games
  ?status=in.(upcoming,open)
  &scheduled_at=gt.<now>
  &scheduled_at=lte.<now + window>
  &reminder_<window>m_sent_at=is.null
  &select=id,title,prize_pool,accent_color,glow_color,gradient_colors,scheduled_at
```

This returns games whose `scheduled_at` falls inside the window **and** whose reminder has not been sent yet.

---

### 3. Atomic claim — preventing duplicate sends

Before sending any FCM message, the service atomically marks the reminder as sent:

```
PATCH /rest/v1/games
  ?id=eq.<game_id>
  &<reminder_column>=is.null        ← guard: only succeeds if still NULL
Body: { "reminder_60m_sent_at": "<now>" }
```

The `IS NULL` filter in the `PATCH` URL means only **one tick** will win the race. Any concurrent tick (e.g. after a crash-restart) will find the column already set and skip that game silently.

---

### 4. Fetch eligible push tokens

`fetchEligibleTokens()` calls the `get_game_reminder_push_tokens()` database RPC which returns tokens for every user whose `notification_preferences.game_reminders = TRUE` (the column defaults to `TRUE`, so opt-out is required — no action means you receive reminders).

The token list is **cached in-memory for 60 seconds** to avoid one DB round-trip per game per window.

---

### 5. FCM fan-out

`sendFcmToTokens(tokens, notification)` sends to all eligible devices using the **FCM v1 HTTP API** with a concurrency of **20 requests at a time**:

- Android: `priority=HIGH`, `sound=default`
- iOS (APNs): `apns-priority=10`, `sound=default`

**Notification payload sent to the device:**

```json
{
  "notification": {
    "title": "Quiz Night Championship",
    "body":  "Starts in 1 hour — prize 5000"
  },
  "data": {
    "type":                "show_reminder",
    "game_id":             "uuid",
    "game_title":          "Quiz Night Championship",
    "prize_pool":          "5000",
    "accent_color":        "#FF6B35",
    "glow_color":          "#FF6B3580",
    "gradient_colors":     "#FF6B35,#FF8C42",
    "minutes_until_start": "60",
    "scheduled_at":        "2026-06-01T20:00:00Z"
  }
}
```

> The `data` block is a flat `Record<string, string>` — all values are strings, including numbers, so the mobile client must parse `prize_pool` and `minutes_until_start` as needed.

---

### 6. Notification record

After FCM fan-out, a row per user is inserted into `public.notifications`:

```json
{
  "user_id":       "uuid",
  "type":          "show_reminder",
  "title":         "Quiz Night Championship",
  "body":          "Starts in 1 hour — prize 5000",
  "sent_via_push": true,
  "data":          { ...same data block as above... }
}
```

Rows are bulk-inserted in chunks of **500** to avoid oversized POST bodies.

---

### 7. Invalid token cleanup

FCM returns `UNREGISTERED`, `NOT_FOUND`, or `INVALID_ARGUMENT` when a device token is stale (app uninstalled, token rotated). The service detects these and deletes them from `public.push_tokens` automatically via:

```
DELETE /rest/v1/push_tokens?token=in.(...)
```

---

## Database Schema Changes

**Migration:** `supabase/migrations/20260531180000_games_start_reminders.sql`

### New columns on `public.games`

| Column | Type | Meaning |
|--------|------|---------|
| `reminder_60m_sent_at` | `TIMESTAMPTZ` | Timestamp when T-60m reminder was sent (`NULL` = not sent yet) |
| `reminder_10m_sent_at` | `TIMESTAMPTZ` | Timestamp when T-10m reminder was sent |
| `reminder_1m_sent_at`  | `TIMESTAMPTZ` | Timestamp when T-1m reminder was sent |

### Partial indexes

Three partial indexes ensure the per-tick query stays fast — only **pending** rows (column IS NULL, status upcoming/open) are indexed:

```sql
CREATE INDEX idx_games_reminder_60m_pending ON public.games (scheduled_at)
    WHERE reminder_60m_sent_at IS NULL AND status IN ('upcoming','open');
```

### RPC: `get_game_reminder_push_tokens()`

```sql
-- Returns tokens for all users with game_reminders = TRUE (default TRUE)
SELECT pt.user_id, pt.token, pt.platform
FROM   public.push_tokens pt
LEFT JOIN public.notification_preferences np ON np.user_id = pt.user_id
WHERE  COALESCE(np.game_reminders, TRUE) = TRUE;
```

Callable only by `service_role` (SECURITY DEFINER, PUBLIC revoked).

---

## FCM Authentication (`fcm.ts`)

```
Firebase service-account JSON
         │
         ▼
  RS256 JWT (signed with private_key via WebCrypto)
         │
         ▼
  POST https://oauth2.googleapis.com/token
         │
         ▼
  OAuth2 access_token (cached for ~1 hour)
         │
         ▼
  POST https://fcm.googleapis.com/v1/projects/{id}/messages:send
```

The access token is **cached in memory** and reused until 60 seconds before expiry. The private key is never printed to logs (R-01).

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `FCM_SERVICE_ACCOUNT_PATH` | No | `/app/configs/quiz4win-68443-firebase-adminsdk-fbsvc-24d33392b8.json` | Path to Firebase service-account JSON inside the container |
| `SUPABASE_URL` | Yes | — | Internal REST API base URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | — | Service-role JWT (never logged) |
| `TEMPLATE_GEN_INTERVAL_MS` | No | `60000` | Tick interval in milliseconds |

---

## Docker Setup

The `./configs/` directory is mounted read-only into the container and shared with the admin panel container — no credential duplication:

```yaml
# docker-compose.yml (template-generator service)
volumes:
  - ./configs:/app/configs:ro
environment:
  FCM_SERVICE_ACCOUNT_PATH: /app/configs/quiz4win-68443-firebase-adminsdk-fbsvc-24d33392b8.json
```

The container is started with `--allow-read` so Deno can read the service-account file:

```
deno run --allow-env --allow-net --allow-read generator.ts
```

---

## Full Flow Diagram

```
Every 60 seconds
│
├─ reminderTick()
│     │
│     ├─ Window: T-60m ──► Query games (scheduled_at in next 60min, reminder_60m_sent_at IS NULL)
│     │                         │
│     │              ┌──────────┘
│     │              │  for each game found:
│     │              ├─ PATCH games SET reminder_60m_sent_at=NOW() WHERE col IS NULL  (atomic claim)
│     │              ├─ fetchEligibleTokens()  (cached 60s)
│     │              ├─ sendFcmToTokens()      (concurrency=20, Android HIGH + APNs priority 10)
│     │              ├─ insertNotificationRows() into public.notifications (chunks of 500)
│     │              └─ deleteInvalidTokens()  (stale FCM tokens removed from push_tokens)
│     │
│     ├─ Window: T-10m ──► same flow with reminder_10m_sent_at
│     └─ Window: T-1m  ──► same flow with reminder_1m_sent_at
│
└─ (game reaches scheduled_at → schedulerTick() fires StartGame → orchestrator starts game)
```

---

## Opting Out of Reminders

Users can disable game reminders by setting `notification_preferences.game_reminders = FALSE`. The RPC `get_game_reminder_push_tokens()` excludes their tokens automatically. The default is `TRUE` (opt-in by default).

---

## Observability

Log lines emitted by the reminder system:

```
[reminder] game=<uuid> window=60m delivered=1243 failed=2
[reminder] rpc tokens HTTP 500            ← token fetch failed (non-fatal)
[reminder] cleanup invalid tokens failed  ← delete failed (non-fatal)
[fcm] send failed status=404 remove=true  ← stale token detected
```
