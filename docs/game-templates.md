# Game Templates API & Engine

Quiz4Win Backend — Last updated 2026-05-30

The **Game Template Engine** lets admins define recurring game configurations
that automatically spawn `games` rows on a cron schedule. Each generated game
copies the template's configuration (entry fee, prize pool, question filters,
branding, AI presenter assignment, …), starts in `upcoming` status with
`mode = 'live'`, and links back via `games.template_id`.

## Components

| Component | Path | Role |
|-----------|------|------|
| Schema | `supabase/migrations/20260530100000_game_templates_v1.sql` | `game_templates` table, `games.template_id` FK, triggers |
| Cron matcher | `…100001_game_templates_rpcs.sql` | `match_cron_expression(expr, ts)` SQL function (5-field cron) |
| Generator RPC | `…100002_game_templates_generator.sql` | `generate_game_from_template(template_id, skip_overlap)` — filter-based question selection, overlap guard, LiveKit room name |
| Tick RPC | `…100003_game_templates_cron_tick.sql` | `generate_games_from_active_templates()` — loops active templates, calls generator |
| Cron service | `deploy/template-generator/` | Deno Docker container that calls the tick RPC every 60 s |
| Admin API | `supabase/functions/admin-game-templates/` | CRUD + lifecycle endpoints |
| Admin UI | `admin/src/app/(app)/templates/` | List page, create dialog, detail page |
| RabbitMQ | `supabase/functions/_shared/rabbitmq.ts` | `publishQuizShowStart(...)` — invoked from `admin-games` start endpoint |
| LiveAvatar proxy | `supabase/functions/admin-liveavatar/` | Catalog (avatars/voices/credits) for the UI |

## `game_templates` schema (excerpt)

```
id                  UUID PK
name                TEXT NOT NULL
description         TEXT
cron_expression     TEXT NOT NULL        -- 5-field UTC cron
cron_description    TEXT                 -- human-friendly label
duration_minutes    INTEGER  (1..1440)
start_buffer_seconds INTEGER (0..3600)   -- gap between create and scheduled_at

mode                TEXT DEFAULT 'live'
language            TEXT  CHECK IN ('en','ar','fa','tr')
entry_fee           NUMERIC(10,2)
prize_pool          NUMERIC(12,2)
prize_pool_currency TEXT
max_players         INTEGER
questions_count     INTEGER > 0
time_per_question   INTEGER > 0
allowed_wrong_answers INTEGER

question_category   TEXT          -- filter for question selection (NULL = any)
question_difficulty TEXT
question_language   TEXT

enable_streaming    BOOLEAN DEFAULT TRUE

ai_enabled          BOOLEAN DEFAULT FALSE
ai_avatar_id        TEXT          -- LiveAvatar avatar UUID
ai_sound_id         TEXT          -- LiveAvatar voice UUID
ai_duration         INTEGER       -- 60..1800 seconds
ai_language         TEXT

is_active           BOOLEAN DEFAULT FALSE
current_game_id     UUID FK games(id) ON DELETE SET NULL
last_completed_game_id UUID FK games(id) ON DELETE SET NULL
last_generated_at   TIMESTAMPTZ
total_games_generated INTEGER DEFAULT 0

created_by          UUID FK profiles(id)
created_at / updated_at / deleted_at
```

RLS is enabled with **no** policies for `anon` / `authenticated` — the admin
Edge Function uses the service-role client and all access is gated by the
JWT + admin role check.

## Generation flow

```
template-generator (every 60 s)
        │
        ▼
generate_games_from_active_templates()        ← SECURITY DEFINER
        │   iterates active, non-deleted templates
        │   skips recently generated (dedup window)
        ▼
generate_game_from_template(template_id)      ← SECURITY DEFINER
        │   * match_cron_expression(cron, NOW())
        │   * overlap check vs current_game_id status
        │   * pick questions matching filters
        │   * insert games row (status=upcoming, mode=live, scheduled_at)
        │   * insert game_questions rows
        │   * update template: current_game_id, last_generated_at,
        │     total_games_generated++
        ▼
admin-games start endpoint (when admin starts the live game)
        │
        ▼   if template.ai_enabled
publishQuizShowStart() → RabbitMQ → LiveAvatar service joins LiveKit room
```

## Cron syntax

Standard 5-field POSIX cron, **UTC only**: `minute hour day-of-month month day-of-week`.
Supported: `*`, `,` lists, `-` ranges, `/` steps, named DoW (`0`-`6`).

| Example | Meaning |
|---------|---------|
| `0 * * * *` | Top of every hour |
| `0,30 * * * *` | Every 30 minutes |
| `0 18 * * *` | 18:00 UTC daily |
| `0 12 * * 1-5` | Noon UTC on weekdays |
| `0 20 * * 0,6` | 20:00 UTC on weekends |

## Admin API — `/admin/game-templates`

All routes require an admin JWT (role: `super_admin` / `admin` / `moderator`)
and emit `admin_audit_log` entries.

| Method | Path | Purpose |
|--------|------|---------|
| GET    | `/admin/game-templates` | List (query: `page`, `limit`, `is_active`) |
| GET    | `/admin/game-templates/:id` | Detail |
| POST   | `/admin/game-templates` | Create. Required: `name`, `cron_expression`, `questions_count` |
| PATCH  | `/admin/game-templates/:id` | Partial update (whitelisted writable fields) |
| DELETE | `/admin/game-templates/:id` | Soft delete + deactivate |
| PATCH  | `/admin/game-templates/:id/activate` | `is_active = true` |
| PATCH  | `/admin/game-templates/:id/deactivate` | `is_active = false` |
| POST   | `/admin/game-templates/:id/generate-now` | Body: `{ skip_overlap?: bool }`. Returns `{ game_id }` |
| GET    | `/admin/game-templates/:id/current-game` | Returns linked active game (or `null`) |
| GET    | `/admin/game-templates/:id/last-game` | Returns last completed game (or `null`) |
| GET    | `/admin/game-templates/:id/history` | Paginated list of generated games |
| POST   | `/admin/game-templates/:id/asset` | Multipart: `field` (`icon`/`thumbnail_url`/`poster_url`/`host_avatar_url`) + `file` (≤10 MB, JPEG/PNG/WebP/SVG) |

Server-side invariant: when `ai_enabled` is set to `true` the function forces
`enable_streaming = true` (the AI presenter requires a LiveKit room).

## Admin API — `/admin/liveavatar`

Thin proxy over the configured LiveAvatar provider so the admin UI can
populate avatar/voice pickers. Returns `503` if `LIVEAVATAR_API_URL` /
`LIVEAVATAR_API_KEY` are not configured (the UI falls back to free-form ID
entry).

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/admin/liveavatar/avatars` | Account (private/custom) avatars |
| GET | `/admin/liveavatar/avatars/public` | Platform-wide public avatars |
| GET | `/admin/liveavatar/avatars/:id` | Single avatar |
| GET | `/admin/liveavatar/voices` | Voices (params: `voice_type`, `page`, `page_size`) |
| GET | `/admin/liveavatar/voices/:id` | Single voice |
| GET | `/admin/liveavatar/voices/:id/preview` | Voice preview (audio_base64) |
| GET | `/admin/liveavatar/credits` | Remaining credits balance |

## RabbitMQ message — `quiz.show.start`

Published by `admin-games` after a generated, `ai_enabled` game is started.

| Field | Type | Notes |
|-------|------|-------|
| `jobId` | string | `quiz-<gameId>-<epoch>` |
| `correlationId` | UUID | random |
| `gameId` | string | `QUIZ:<uuid>` |
| `templateId` | UUID | source template |
| `tournamentName` | string | game title |
| `language` | enum | `en`/`ar`/`fa`/`tr` |
| `durationSeconds` | int | `template.ai_duration` |
| `avatarId` | string | `template.ai_avatar_id` |
| `voiceId` | string | `template.ai_sound_id` |
| `totalPrize` / `currency` | number + string | from game |
| `liveKit.url` / `liveKit.roomName` | strings | LiveKit join data |

Publish is **best-effort**: a failure logs an audit note (`ai_show_dispatch_failed:*`)
but never rolls back the game-start transition.

## Required environment variables

Added to `docker-compose.yml` for both the `api` service and the
`template-generator` service:

```
# LiveAvatar (catalog proxy) — optional
LIVEAVATAR_API_URL=
LIVEAVATAR_API_KEY=

# RabbitMQ (used to publish quiz.show.start) — optional
# Single AMQP URI; credentials, host and vhost are parsed from this value.
# amqp(s):// is rewritten to http(s):// for the Management API.
RABBITMQ_URL=
# Optional override; if absent, the vhost is taken from the URL path.
# RABBITMQ_VHOST=
MQ_COMMAND_EXCHANGE=
MQ_COMMAND_QUEUE=quiz.show.start

# Cron service tuning (defaults to 60 000 ms)
TEMPLATE_GEN_INTERVAL_MS=60000
```

Leaving the LiveAvatar / RabbitMQ vars empty disables the corresponding
integration without breaking the rest of the engine.
