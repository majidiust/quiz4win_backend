# Live Avatar (AI Presenter) & Game Template Engine

This document describes how the **Game Template Engine** automatically generates lotto games on a schedule, and how the **Live Avatar AI Presenter** produces a real-time draw-reveal show when each game finishes.

---

## Table of Contents

1. [Game Template Engine](#game-template-engine)
   - [What Is a Template?](#what-is-a-template)
   - [Database Schema](#database-schema)
   - [Template Lifecycle States](#template-lifecycle-states)
   - [Cron Expression Syntax](#cron-expression-syntax)
   - [How Games Are Generated](#how-games-are-generated)
   - [Recovery Mode](#recovery-mode)
   - [Image Inheritance](#image-inheritance)
   - [Streaming / LiveKit Room Creation](#streaming--livekit-room-creation)
   - [Template API Endpoints](#template-api-endpoints)
2. [Live Avatar (AI Presenter)](#live-avatar-ai-presenter)
   - [Overview](#overview)
   - [Configuration Fields on a Template](#configuration-fields-on-a-template)
   - [Default Avatar & Voice IDs](#default-avatar--voice-ids)
   - [Avatar & Voice Catalog APIs](#avatar--voice-catalog-apis)
   - [Language Codes](#language-codes)
   - [Trigger Conditions (Draw Time)](#trigger-conditions-draw-time)
   - [Order of Operations at Draw Time](#order-of-operations-at-draw-time)
   - [RabbitMQ Command: `lottery.show.start`](#rabbitmq-command-lotteryshowstart)
   - [Progress Events](#progress-events)
   - [Show Lifecycle Stages](#show-lifecycle-stages)
   - [Recording & Video URL](#recording--video-url)
3. [Full Lifecycle (End-to-End)](#full-lifecycle-end-to-end)
4. [Environment Variables](#environment-variables)

---

## Game Template Engine

### What Is a Template?

A **`LottoGameTemplate`** is a reusable game configuration with a cron schedule. When `isActive = true`, the cron job `cron/lotto_template_generator.ts` runs every minute, evaluates the template's `cronExpression`, and automatically creates a new `lotto_tournament` when the expression matches—unless one is already active for that template.

Key benefits:
- Zero manual game creation: set it and forget it.
- One template → unlimited sequential games over time.
- Built-in gap recovery: if the server is down when a cron fires, the next run creates a game with its `finishTime` aligned to the missed slot.

### Database Schema

The `lotto_game_templates` table mirrors all fields of `lotto_tournaments` plus these scheduling/tracking fields:

| Field | Type | Description |
|-------|------|-------------|
| `cronExpression` | VARCHAR(50) | Standard 5-field cron (see below) |
| `cronDescription` | VARCHAR(100) | Human-readable label, e.g. "Every 15 minutes" |
| `durationMinutes` | INT | How long each generated game runs |
| `ticketingCloseMinutes` | INT | Minutes before draw when ticket sales close |
| `isActive` | BOOLEAN | `true` = generator picks this template up |
| `currentGameId` | INT? | FK → the currently running game |
| `lastCompletedGameId` | INT? | FK → the last finished game |
| `lastGeneratedAt` | DATETIME? | When the last game was created |
| `totalGamesGenerated` | INT | Lifetime game count |
| `aiEnabled` | BOOLEAN | Master switch for the AI Presenter (see Part 2) |
| `aiAvatarId` | VARCHAR(100) | LiveAvatar avatar UUID |
| `aiSoundId` | VARCHAR(100) | LiveAvatar voice UUID |
| `aiDuration` | VARCHAR(50) | Show duration in seconds, e.g. `"300"` |
| `aiLanguage` | VARCHAR(10) | BCP-47 language code, e.g. `"fa"` |
| `enableStreaming` | BOOLEAN | Create a LiveKit room for each game |
| `mobileImageId` | INT? | Asset ID for mobile card image |
| `desktopImageId` | INT? | Asset ID for desktop card image |
| `backgroundImageId` | INT? | Asset ID for game background image |

All game-level fields (`ticketPrice`, `fakePrize`, `seatDetails`, `ninthPlaceConditions`, etc.) are copied verbatim into each generated tournament.

### Template Lifecycle States

```
isActive=false  →  (activate)  →  isActive=true
                                       │
                          Cron runs every minute
                                       │
                         cronExpression matches?
                         Yes + no active game
                                       │
                    generateGameFromTemplateService()
                                       │
                     tournament created → currentGameId set
                                       │
                       Game runs until finishTime
                                       │
                    lotto_drawn cron settles winners
                                       │
                      Template ready for next cycle
```

### Cron Expression Syntax

The template generator uses its own 5-field cron parser. Standard format:

```
<minute> <hour> <day-of-month> <month> <day-of-week>
```

Supported per-field syntax:

| Syntax | Example | Meaning |
|--------|---------|---------|
| Wildcard | `*` | Every value |
| Single value | `30` | At minute 30 |
| Range | `1-5` | Minutes 1 through 5 |
| Step | `*/15` | Every 15 minutes |
| Step from base | `0/15` | At 0, 15, 30, 45 |
| Comma list | `0,15,30,45` | At those specific minutes |

**Examples:**

| Expression | Meaning |
|------------|---------|
| `* * * * *` | Every minute |
| `0/15 * * * *` | Every 15 minutes |
| `0 * * * *` | Every hour on the hour |
| `0 20 * * *` | Daily at 20:00 |
| `0 9,21 * * *` | Twice a day at 09:00 and 21:00 |
| `0 0 * * 1` | Weekly every Monday midnight |

### How Games Are Generated

**Source:** `cron/lotto_template_generator.ts` → calls `generateGameFromTemplateService()` in `services/lottoAdmin.service.ts`.

**Decision tree (per template, per cron tick):**

```
1. hasActiveGame?  →  YES: skip (log only if cron matched)
                   →  NO ↓
2. cronMatches?    →  YES + wasRecentlyGenerated (< 2 min): skip (dedup guard)
                   →  YES + not recently generated: GENERATE NORMAL
                   →  NO: GENERATE RECOVERY (alignedEndTime = next cron trigger)
```

**What `generateGameFromTemplateService` does:**

1. Loads the `LottoGameTemplate` record.
2. Computes `startTime`, `finishTime`, `drawTime_gregorian/jalali`, and `ticketingCloseTime` from `durationMinutes` / `ticketingCloseMinutes`.
3. Copies all template fields into a new `lotto_tournaments` row (including `mobileImageId`, `desktopImageId`, `backgroundImageId`, `aiEnabled`, `aiAvatarId`, `aiSoundId`, `aiDuration`, `aiLanguage`, `templateId`).
4. Creates the `lotto_additional_prizes` row (seeded with `−fakePrize`).
5. Updates `LottoGameTemplate`: sets `currentGameId`, bumps `lastGeneratedAt` and `totalGamesGenerated`.
6. If `enableStreaming || aiEnabled`: fire-and-forget `createLottoLiveKitRoomBestEffort()` (room name: `lotto-<tournamentId>`, gameId: `LOTTO:<tournamentId>`).

### Recovery Mode

If the server is restarted or the cron container is offline when a scheduled tick fires, the next minute that the template has no active game and the cron does **not** match, the generator enters **recovery mode**:

- `alignedEndTime` is calculated as the **next** cron trigger moment.
- The new game's `finishTime` is set to that aligned time, so its draw time lands cleanly on the schedule grid.
- The game starts immediately and ends at the aligned time, covering the gap without overlap.

### Image Inheritance

Images uploaded to a template via the template image endpoints are automatically propagated to every generated game:

```
Upload to template
       │
LottoGameTemplate.mobileImageId / desktopImageId / backgroundImageId = asset.id
Also updates currentGameId tournament immediately (real-time propagation)
       │
Next game generation copies those IDs into the new lotto_tournament row
       │
Frontend fetches tournament → asset URL resolved ✅
```

**Template image endpoints:**

| Method | Route | Effect |
|--------|-------|--------|
| `POST` | `/lotto-admin/templates/:id/upload-mobile-image` | Sets `mobileImageId` on template + current game |
| `GET` | `/lotto-admin/templates/:id/mobile-image` | Returns mobile image asset |
| `POST` | `/lotto-admin/templates/:id/upload-desktop-image` | Sets `desktopImageId` on template + current game |
| `GET` | `/lotto-admin/templates/:id/desktop-image` | Returns desktop image asset |
| `POST` | `/lotto-admin/templates/:id/upload-background-image` | Sets `backgroundImageId` on template + current game |
| `GET` | `/lotto-admin/templates/:id/background-image` | Returns background image asset |

### Streaming / LiveKit Room Creation

When a template has `enableStreaming = true` **or** `aiEnabled = true`, a LiveKit room is created for each generated game. The creation is non-blocking (fire-and-forget); a failure never prevents game creation.

- **Room name:** `lotto-<tournamentId>`
- **gameId:** `LOTTO:<tournamentId>`
- **DB record:** `streamRoom` table, `status: "active"`
- If a room already exists for that `gameId`, it is updated rather than duplicated.

> `aiEnabled = true` **forces** `enableStreaming = true` at the service layer—the invariant is enforced at creation/update time so the LiveKit room is always present for AI presenter games.

### Template API Endpoints

All under `/lotto-admin/templates`, all require admin auth.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/templates` | List templates (`page`, `perPage`, `isActive` params) |
| `GET` | `/templates/:id` | Get single template |
| `POST` | `/templates` | Create template |
| `PUT` | `/templates/:id` | Update template |
| `DELETE` | `/templates/:id` | Delete template |
| `PATCH` | `/templates/:id/activate` | Set `isActive = true` |
| `PATCH` | `/templates/:id/deactivate` | Set `isActive = false` |
| `POST` | `/templates/:id/generate-now` | Manually create a game from template (bypasses cron) |
| `GET` | `/templates/:id/current-game` | Return the active game for this template |
| `GET` | `/templates/:id/history` | Past games generated from this template |

---

## Live Avatar (AI Presenter)

### Overview

When a lotto game finishes its draw, and the template that spawned it has `aiEnabled = true`, the system:

1. **Starts a YouTube live broadcast** via StreamingHub (RabbitMQ `create_stream` command).
2. **Publishes a `lottery.show.start` command** to the AI presenter service over RabbitMQ.

The AI presenter service then:
- Joins the LiveKit room as a video publisher.
- Generates a script (LLM) and initialises an avatar session (LiveAvatar / HeyGen).
- Streams the avatar video live—revealing draw numbers one by one, announcing prizes, and closing the show.
- Records the show to object storage and writes the URL back to `lotto_tournaments.style.videoUrls.fa`.

The entire show runs **without human intervention**.

### Configuration Fields on a Template

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `aiEnabled` | boolean | `false` | Master switch. When `true`, the AI show runs after every draw. Also forces `enableStreaming = true`. |
| `aiAvatarId` | string (UUID) | `bfed3e3e-7d44-4fdb-b2be-ce9a9fd0b9b5` | LiveAvatar avatar UUID — the on-screen presenter. |
| `aiSoundId` | string (UUID) | `94ba6789-4af8-4024-9914-ac083d93a816` | LiveAvatar voice UUID — the presenter's voice. |
| `aiDuration` | string | `null` | Target show length in **seconds** (stored as string), e.g. `"300"`. Valid range: 60–1800. |
| `aiLanguage` | string | `null` | BCP-47 language code sent to the presenter. Supported: `fa`, `en`, `ar`. |

### Default Avatar & Voice IDs

The seeded defaults (written at `createLottoTemplateService` time):

| Resource | UUID | Notes |
|----------|------|-------|
| Avatar | `bfed3e3e-7d44-4fdb-b2be-ce9a9fd0b9b5` | Account avatar named "Aria" (example). Verify name via `/liveavatar-admin/avatars`. |
| Voice | `94ba6789-4af8-4024-9914-ac083d93a816` | Public voice named "Dariush" — warm Farsi male. Verify via `/liveavatar-admin/voices`. |

> These defaults target **Farsi** production use. Override them when creating a template for a different language or persona.

### Avatar & Voice Catalog APIs

LiveAvatar resources are managed through the `/liveavatar-admin` prefix.

#### Avatars

| Endpoint | Description |
|----------|-------------|
| `GET /liveavatar-admin/avatars` | Account (private/custom) avatars. Paginated. Only show `status=ACTIVE`, `is_expired=false`. |
| `GET /liveavatar-admin/avatars/public` | Platform-wide public avatars (same shape). |
| `GET /liveavatar-admin/avatars/:id` | Single avatar by UUID. |
| `PATCH /liveavatar-admin/avatars/:id` | Update name or default voice. |
| `DELETE /liveavatar-admin/avatars/:id` | Soft-delete avatar. |

**Avatar object shape:**

```json
{
  "id": "bfed3e3e-7d44-4fdb-b2be-ce9a9fd0b9b5",
  "name": "Aria",
  "type": "VIDEO",
  "status": "ACTIVE",
  "preview_url": "https://...",
  "is_expired": false,
  "default_voice": { "id": "...", "name": "..." },
  "created_at": "2025-01-01T00:00:00Z"
}
```

#### Voices

| Endpoint | Description |
|----------|-------------|
| `GET /liveavatar-admin/voices` | List voices. Params: `voice_type` (`public`/`private`), `page`, `page_size`. |
| `GET /liveavatar-admin/voices/:id` | Single voice by UUID. |
| `GET /liveavatar-admin/voices/:id/preview` | Returns `audio_base64` (MP3). Play with `<audio>` or Web Audio API. |

**Voice object shape:**

```json
{
  "id": "94ba6789-4af8-4024-9914-ac083d93a816",
  "name": "Dariush",
  "language": "fa",
  "gender": "male",
  "description": "Warm Farsi male voice",
  "tags": ["news", "formal"]
}
```

#### Credits

```
GET /liveavatar-admin/credits
```

Returns `{ "credits_left": "850.00" }`. Credits are consumed at draw time (~2 credits per minute of generated video). Monitor this to avoid failed shows due to balance exhaustion.

### Language Codes

| Code | Language |
|------|----------|
| `fa` | Farsi / Persian (production default) |
| `en` | English |
| `ar` | Arabic |

Pass the code that matches the avatar's voice language. The presenter service forwards `aiLanguage` as-is to the script-generation LLM.

### Trigger Conditions (Draw Time)

The AI presenter is triggered from `cron/lotto_drawn.ts`. **All** of the following must be true:

| # | Condition |
|---|-----------|
| 1 | `lotto_tournaments.templateId != null` |
| 2 | `LottoGameTemplate.aiEnabled === true` |
| 3 | Draw time has passed **and** `tournament.result` is a valid 7-number JSON array |
| 4 | No active LiveKit stream room is already blocking this tournament |
| 5 | All 9 prize-tier winner functions have returned successfully |

If `aiEnabled = false` (but `templateId` is set), the **legacy Animator API** path (`generateLottoVideos()`) runs instead — the two paths are mutually exclusive.

### Order of Operations at Draw Time

After prize distribution completes, before `cronStatus = 2` / `status = 'finish'`, **two operations run in parallel** (both best-effort — a failure in either does not revert the draw):

```
            ┌── A. Start YouTube live broadcast (StreamingHub)  ─────┐
draw done ──┤                                                          ├── cronStatus=2, status=finish
            └── B. Publish lottery.show.start (RabbitMQ) ────────────┘
```

**Step A — YouTube broadcast:**  
Calls `startFFmpegStream({ gameId: 'LOTTO:<tournamentId>', youtubeRtmpUrl, youtubeStreamKey })`.  
Already-active sessions are treated as success.

**Step B — Publish `lottery.show.start`:**  
Sends the command to queue `lottery.show.start`. The AI presenter acks only after the show ends.

**Idempotency:** `jobId` (= `lotto-<tournamentId>-<timestamp>`) is stored in `tournament.style.aiJobId` before publishing. If the cron retries, it skips the publish if `aiJobId` already exists.

### RabbitMQ Command: `lottery.show.start`

**Queue:** `lottery.show.start` (durable, classic)  
**Broker:** `RABBITMQ_URL` env var

Key fields sent from the cron:

| Field | Source |
|-------|--------|
| `jobId` | `lotto-${tournament.id}-${Date.now()}` |
| `correlationId` | UUID v4, generated at publish time |
| `language` | `template.aiLanguage ?? 'fa'` |
| `durationSeconds` | `parseInt(template.aiDuration ?? '300', 10)` |
| `avatarId` | `template.aiAvatarId` |
| `voiceId` | `template.aiSoundId` |
| `totalPrize` | Computed prize pool (same value used for payouts) |
| `winningPositionsCount` | `tournament.noWinnersSeats` |
| `prizePerPosition` | Array built from `seatDetails × totalPrize / 100` |
| `drawNumbers` | `JSON.parse(tournament.result).slice(0, 6)` |
| `luckyNumber` | `JSON.parse(tournament.result)[6]` |
| `tournamentName` | `tournament.name` |
| `awards` | Per-place breakdown `[{place, combination, prize}]` |
| `liveKit.url` | `process.env.LIVEKIT_URL` |
| `liveKit.roomName` | `lotto-${tournament.id}` |

Full schema reference: **`docs/ai_presentor_integration.md` §2**.

### Progress Events

The AI presenter publishes progress to exchange `lottery.show.events` (topic, durable).

Subscribe with routing key `lottery.show.#` to receive all events for all jobs.

**Event envelope:**

```json
{
  "eventType": "lottery.show.progress | lottery.show.failed | lottery.show.completed",
  "jobId": "lotto-116-1716000000000",
  "correlationId": "...",
  "stage": "<stage_name>",
  "status": "running | failed | succeeded",
  "progressPercent": 45,
  "message": "livekit connected",
  "timestamp": "2026-05-30T12:00:00.000Z",
  "details": { }
}
```

### Show Lifecycle Stages

| Stage | % | Key `details` fields | What happens |
|-------|---:|----------------------|--------------|
| `request_received` | 1 | — | Command parsed |
| `validation_completed` | 5 | — | Schema valid |
| **`viewer_access_ready`** | 6 | `roomName, url, viewerToken` | **Redirect viewers to the LiveKit room here** |
| `avatar_init_started` | 8 | — | HeyGen session request |
| `script_generation_started` | 18 | — | LLM generating script |
| `avatar_ready` | 15 | `provider, bridge` | Avatar session live |
| `livekit_connected` | 45 | `roomName, viewerToken` | Relay publisher connected |
| `script_generation_completed` | 35 | `segmentCount, revealPlan[]` | Script frozen |
| `recording_started` | 48 | `recording` | LiveKit egress running |
| `show_execution_started` | 50 | — | First segment playing |
| `draw_number_revealed` (×6) | 50–88 | `ordinal, number` | Each draw number announced |
| `lucky_number_revealed` | 92 | `number` | Lucky number announced |
| `show_closing` | 95 | — | Script finished |
| `recording_finalized` | 98 | `recording.publicUrl` | File uploaded to storage |
| **`completed`** | 100 | `recording, durationMs` | Terminal success |
| `failed` | 100 | `errorCode, message` | Terminal failure |

On `completed`: `details.recording.publicUrl` is written to `lotto_tournaments.style.videoUrls.fa`.

**Error codes:** `VALIDATION_ERROR`, `AVATAR_ERROR`, `LIVEKIT_ERROR`, `SCRIPT_VALIDATION_ERROR`, `EXECUTION_ERROR`, `CANCELLATION_ERROR`, `SHOW_ERROR`.

### Recording & Video URL

After the show:
- Recording stored at: `shows/<roomName>/<jobId>.mp4` on S3/object storage.
- URL written to: `lotto_tournaments.style.videoUrls.fa` (same JSON shape as the legacy Animator API).
- Failure does not mark the tournament as failed — an error is logged and `style.aiShow.error` is populated.

---

## Full Lifecycle (End-to-End)

```
Admin creates LottoGameTemplate
  aiEnabled=true, aiAvatarId=<uuid>, aiSoundId=<uuid>, aiLanguage="fa"
  cronExpression="0/15 * * * *", durationMinutes=14
        │
        ▼
Admin uploads images to template
  POST /lotto-admin/templates/:id/upload-mobile-image
  POST /lotto-admin/templates/:id/upload-background-image
        │
        ▼
Admin activates template: PATCH /lotto-admin/templates/:id/activate
        │
        ▼
cron/lotto_template_generator.ts (runs every minute)
  ┌── cronExpression matches current time? ──────────────────┐
  │   no active game?                                        │
  │                                                          │
  ▼                                                          ▼
generateGameFromTemplateService()                     skip / recovery mode
  • Creates lotto_tournament (copies all template fields)
  • Inherits mobileImageId, backgroundImageId from template
  • Creates lotto_additional_prizes
  • Sets template.currentGameId = tournament.id
  • createLottoLiveKitRoomBestEffort() → StreamRoom record
        │
        ▼ (14 minutes later)
cron/lotto_drawn.ts detects drawTime passed + result set
  • Calculates prize distribution (all 9 tiers)
  • Sets cronStatus=1 (Processing)
        │
    template.aiEnabled = true?
    YES ──────────────────────────────────────────────────────┐
                                                              │
  ┌── A. startFFmpegStream(LOTTO:<id>) to StreamingHub ──── B. publish lottery.show.start ──┐
  │       YouTube goes live                                                                  │
  └───────────────────────────────────────────────────────────────────────────────────────── ┘
        │
  cronStatus=2, status='finish'
        │
AI presenter service:
  viewer_access_ready → viewers can join LiveKit room
  avatar_ready → HeyGen session live
  draw numbers revealed 1 by 1 via avatar speech
  lucky_number_revealed
  recording_finalized → publicUrl written to style.videoUrls.fa
  completed ✅
```

---

## Environment Variables

Variables required by the cron container for AI presenter operation:

```env
# RabbitMQ (shared with StreamingHub)
RABBITMQ_URL=amqps://user:password@host/vhost

# AI presenter queue/exchange (defaults shown)
MQ_COMMAND_QUEUE=lottery.show.start
MQ_PROGRESS_EXCHANGE=lottery.show.events
MQ_PROGRESS_ROUTING_KEY_PREFIX=lottery.show

# LiveKit
LIVEKIT_URL=wss://livekit.example.com
LIVEKIT_API_KEY=...
LIVEKIT_API_SECRET=...

# YouTube target
YOUTUBE_RTMP_URL=rtmp://x.rtmp.youtube.com/live2
YOUTUBE_STREAM_KEY=...
```

> **Related documents:**
> - `docs/ai_presentor_integration.md` — Full RabbitMQ wire protocol and field-level schema
> - `docs/ai-avatar-frontend-guide.md` — Frontend integration guide for the admin panel
> - `docs/template-image-apis.md` — Template image upload endpoint reference
> - `docs/streaminghub_mng_amqp.md` — StreamingHub AMQP command reference
> - `docs/streaming-manager-api.md` — REST endpoints for LiveKit / StreamingHub management
