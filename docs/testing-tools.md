# Quiz4Win — Developer Testing Tools

Two local scripts help you test the platform end-to-end without a real mobile
client and watch server-side logs in real time.

---

## 1. Test-Participant Bot

**File:** `deploy/test-participant/participant.mjs`  
**Runtime:** Node ≥ 18 (ESM)

Simulates one or more real players joining a game, connecting to the LiveKit
room, listening for `QUESTION_STARTED` events on the data channel, and
submitting a **random** answer for every question via the game-session API.
A `/state` HTTP poll runs in parallel as a fallback so the bot still answers
even if a data-channel message is missed.

### Prerequisites

```bash
cd deploy/test-participant
npm install          # installs @livekit/rtc-node
```

### Environment variables

| Variable | Required | Description |
|---|---|---|
| `SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_URL` | ✅ | Supabase project URL |
| `SUPABASE_ANON_KEY` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | Anon/public key |
| `LIVEKIT_SERVER_URL` | ✅ | LiveKit server WS URL (e.g. `wss://lk.quiz4win.com`) |
| `SUPABASE_SERVICE_ROLE_KEY` | optional | If set, auto-creates the test user account on first run |
| `API_URL` | optional | Fallback API base URL (CLI flag takes priority) |

Load them all from the project `.env` in one shot:

```bash
set -a && source ../../.env && set +a
```

### CLI flags

| Flag | Default | Description |
|---|---|---|
| `--game <GAME_ID>` | — | **Required.** UUID of the target game |
| `--bots <N>` | `1` | Number of parallel bot accounts to spin up |
| `--api-url <URL>` | auto-detected | Override the API base URL (use this against `https://api.quiz4win.com`) |
| `--no-livekit` | — | Disable LiveKit connection; rely on `/state` polling only |
| `--password <pw>` | `Test1234!` | Password for the throwaway test accounts |

### Quick-start (production API)

```bash
cd deploy/test-participant
set -a && source ../../.env && set +a
npm install

# Single bot
node participant.mjs --game <GAME_ID> --api-url https://api.quiz4win.com

# Five bots in parallel
node participant.mjs --game <GAME_ID> --api-url https://api.quiz4win.com --bots 5

# Poll-only mode (no native LiveKit dep needed)
node participant.mjs --game <GAME_ID> --api-url https://api.quiz4win.com --no-livekit
```

### Important: join timing

The bot must join **while the game status is `open`** to get the `participant`
role (answers accepted, score counted). Joining after the orchestrator has
flipped the game to `live` assigns the `spectator` role and answer submissions
will be rejected.

**Workflow for a clean test:**

1. Find or create a game in `open` state (query Supabase → `games` table,
   `status = 'open'`).
2. Start the bot — it will join immediately.
3. Trigger `StartGame` (send the RabbitMQ command or wait for the scheduler).

### What the bot logs

```
[main]  game=<id>  bots=2  livekit=true  api=https://api.quiz4win.com/game-session
[bot1]  signed in as test+<id>-1@quiz4win.test (uid=…)
[bot1]  joined: role=participant  canSubmit=true  gameStatus=open
[bot1]  livekit connected → room=quiz-<id>
[bot1]  ▶ QUESTION_STARTED idx=0 q=<question_id>
[bot1]  ✓ answered questionId=<id> optionId=<id> → HTTP 200
[bot1]  ■ QUESTION_CLOSED idx=0 correct=<option_id>
…
[main]  all bots finished
```

---

## 2. Live Log Consumer

The game-orchestrator (and other services) publish structured JSON log lines to
a RabbitMQ queue (`quiz4win.debug.logs`) when `DEBUG_LOG_MQ=true`. Two consumer
scripts let you stream those logs to your terminal.

### Enable log forwarding

In `.env` (or `docker-compose.yml` override):

```
DEBUG_LOG_MQ=true
DEBUG_LOG_QUEUE=quiz4win.debug.logs   # optional, this is the default
```

Then restart the orchestrator:

```bash
docker compose up -d --force-recreate game-orchestrator
```

---

### Option A — Deno consumer (real-time AMQP)

**File:** `deploy/debug-consumer/consumer.ts`  
**Runtime:** Deno (any recent version)

Connects directly via AMQP for zero-latency streaming. Recommended when you
have Deno installed.

```bash
# Load env then run
set -a && source .env && set +a
deno run --allow-net --allow-env deploy/debug-consumer/consumer.ts

# Or inline the URL
RABBITMQ_URL=amqps://user:pass@host/vhost \
  deno run --allow-net --allow-env deploy/debug-consumer/consumer.ts

# Custom queue name
DEBUG_LOG_QUEUE=my.queue \
  deno run --allow-net --allow-env deploy/debug-consumer/consumer.ts
```

The consumer declares the queue as **non-durable + auto-delete** — it vanishes
when you disconnect, so no stale messages accumulate on the broker.

---

### Option B — Node consumer (HTTP Management API polling)

**File:** `.tmp-q4w-log-consumer.mjs` (repo root)  
**Runtime:** Node ≥ 18, **no `npm install` required**

Polls the RabbitMQ HTTP Management API every 1.5 s. Use this when Deno is not
available. Reads `RABBITMQ_URL` directly from `.env` — no shell export needed.

```bash
# From the repo root (must have a .env file present)
node .tmp-q4w-log-consumer.mjs
```

The queue is declared **durable, not auto-delete** so messages buffer while
the script is not running and are delivered on the next poll.

---

### Log format

Both consumers render structured JSON as coloured terminal lines:

```
HH:MM:SS [service] LEVEL  message text
```

| Colour | Meaning |
|---|---|
| Cyan | `INFO` |
| Yellow | `WARN` |
| Red | `ERROR` |

Raw non-JSON lines are printed as-is.

---

## Environment variable quick reference

| Variable | Used by | Description |
|---|---|---|
| `SUPABASE_URL` | bot | Supabase project REST URL |
| `SUPABASE_ANON_KEY` | bot | Public anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | bot | Service-role key (auto-create test users) |
| `LIVEKIT_SERVER_URL` | bot | LiveKit WebSocket URL |
| `API_URL` | bot | Fallback API base (overridden by `--api-url`) |
| `RABBITMQ_URL` | log consumers | `amqp[s]://user:pass@host/vhost` |
| `DEBUG_LOG_MQ` | orchestrator | Set `true` to enable log forwarding |
| `DEBUG_LOG_QUEUE` | orchestrator + consumers | Queue name (default `quiz4win.debug.logs`) |
