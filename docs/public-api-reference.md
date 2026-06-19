# Public API — Reference

**Base URL:** `https://api.quiz4win.com`
**Authentication:** None required — no `Authorization` header, no API key.
**CORS:** Open (`Access-Control-Allow-Origin: *`). Preflight (`OPTIONS`) returns `204 No Content`.

## Rate limiting (R-17)

Every request is rate-limited **per client IP** by a central Redis-backed
fixed-window limiter in the API gateway. Public read endpoints (`GET /public-*`)
use the **public** tier of **60 requests/minute**; the abuse-prone write
endpoints `POST /public-host-applications` and `POST /public-early-birds` use
the stricter **20 requests/minute** tier (and keep their own longer-window RPC
limiters as a second layer). Every routed response carries `X-RateLimit-Limit`,
`X-RateLimit-Remaining`, and `X-RateLimit-Reset` (seconds until the window
resets). When the budget is exhausted the API returns:

```
HTTP/1.1 429 Too Many Requests
Retry-After: 42
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 42
Content-Type: application/json

{ "error": "rate_limited" }
```

CORS preflight (`OPTIONS`) requests are exempt and never consume budget.
Clients SHOULD honour `Retry-After` and back off rather than retry immediately.

---

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/public-games` | List games (filterable, paginated) |
| `GET` | `/public-games/:id` | Single game detail |
| `GET` | `/public-games/:id/result` | Final result + prize distribution for a completed game |
| `GET` | `/public-winners` | Aggregate winner stats per completed game run |
| `GET` | `/public-leaderboard` | Ranked players by survivor finishes + credits over a window |
| `GET` | `/public-featured-host` | Host of the closest active featured game (Host Spotlight) |
| `GET` | `/public-sounds` | Active app sound assets (flat list + grouped by usage) |
| `GET` | `/public-sounds/:id/stream` | Proxy audio bytes through the API (CDN-bypass fallback) |
| `POST` | `/public-host-applications` | Submit a host application (public website form) |
| `POST` | `/public-early-birds` | Mobile early-access sign-up (iOS / Android) |
| `OPTIONS` | `/public-*` | CORS preflight (returns `204`, exempt from rate limiting) |

> A separate **Hosts API (Mobile)** doc covers the read-only host-directory
> routes `GET /public-hosts*` used by the Android/iOS apps — see
> `docs/mobile-hosts-api-reference.md`.

---

## GET /public-games

Returns a paginated list of games. By default returns only `upcoming`, `open`, and `live` games.

### Query Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `status` | string | `upcoming\|open\|live` | Single value or pipe-separated set.<br>Allowed: `upcoming`, `open`, `live`, `closed`, `completed`, `cancelled`.<br>Example: `status=open\|live` |
| `mode` | string | — | Exact match on game mode. Example: `mode=solo` |
| `featured` | string | — | `"true"` → featured only. `"false"` → non-featured only. Omit for all. |
| `category` | string | — | Exact match. Example: `category=sports` |
| `difficulty` | string | — | Case-insensitive. Accepted: `easy`, `medium`, `hard`. |
| `language` | string | — | Accepted: `en`, `ar`, `fa`, `tr`. |
| `search` | string | — | Case-insensitive substring search across `title` and `subtitle`. Characters `%` and `_` are stripped before matching. |
| `sort` | string | `start_asc` | `start_asc` — soonest first<br>`start_desc` — latest first<br>`prize_desc` — highest prize first<br>`prize_asc` — lowest prize first<br>`featured_first` — featured first, then by soonest |
| `page` | integer | `1` | 1-based page number. |
| `limit` | integer | `20` | Results per page. Min `1`, max `50`. |

### Success Response — `200 OK`

```json
{
  "games": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "title": "Weekend Trivia",
      "subtitle": "Test your general knowledge",
      "description": "Full game description text.",
      "mode": "solo",
      "status": "open",
      "entry_fee": 1.00,
      "prize_pool": 500.00,
      "prize_pool_currency": "USD",
      "category": "general",
      "difficulty": "Easy",
      "language": "en",
      "questions_count": 10,
      "time_per_question": 15,
      "allowed_wrong_answers": 3,
      "participant_count": 42,
      "max_participants": 200,
      "start_time": "2026-06-01T18:00:00Z",
      "end_time": null,
      "is_featured": true,
      "icon": "https://cdn.example.com/icon.png",
      "thumbnail_url": "https://cdn.example.com/thumb.jpg",
      "poster_url": "https://cdn.example.com/poster.jpg",
      "accent_color": "#FF6B00",
      "glow_color": "#FF6B0066",
      "gradient_colors": ["#FF6B00", "#FFD700"],
      "sponsor": "Acme Corp",
      "tags": ["trivia", "weekend"],
      "host_name": "Ali Reza",
      "host_avatar_url": "https://cdn.example.com/host.jpg",
      "host_title": "Quiz Master",
      "rules": "No cheating. First to finish wins."
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 137,
    "total_pages": 7
  }
}
```

### Error Responses

| HTTP | `error` | Cause |
|------|---------|-------|
| `400` | `invalid_status` | A value in `status` is not in the allowed set |
| `400` | `invalid_language` | `language` is not one of `en`, `ar`, `fa`, `tr` |
| `400` | `invalid_difficulty` | `difficulty` is not `easy`, `medium`, or `hard` |
| `500` | `failed_to_fetch_games` | Database query failure |
| `500` | `internal_server_error` | Unexpected server error |

---

## GET /public-games/:id

Returns a single game by its UUID.

### Path Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | UUID | The game's `id` field |

### Success Response — `200 OK`

```json
{
  "game": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "title": "Weekend Trivia",
    "subtitle": "Test your general knowledge",
    "description": "Full game description text.",
    "mode": "solo",
    "status": "open",
    "entry_fee": 1.00,
    "prize_pool": 500.00,
    "prize_pool_currency": "USD",
    "category": "general",
    "difficulty": "Easy",
    "language": "en",
    "questions_count": 10,
    "time_per_question": 15,
    "allowed_wrong_answers": 3,
    "participant_count": 42,
    "max_participants": 200,
    "start_time": "2026-06-01T18:00:00Z",
    "end_time": null,
    "is_featured": true,
    "icon": "https://cdn.example.com/icon.png",
    "thumbnail_url": "https://cdn.example.com/thumb.jpg",
    "poster_url": "https://cdn.example.com/poster.jpg",
    "accent_color": "#FF6B00",
    "glow_color": "#FF6B0066",
    "gradient_colors": ["#FF6B00", "#FFD700"],
    "sponsor": "Acme Corp",
    "tags": ["trivia", "weekend"],
    "host_name": "Ali Reza",
    "host_avatar_url": "https://cdn.example.com/host.jpg",
    "host_title": "Quiz Master",
    "rules": "No cheating. First to finish wins."
  }
}
```

### Error Responses

| HTTP | `error` | Cause |
|------|---------|-------|
| `404` | `game_not_found` | No game exists with the given `id` |
| `500` | `internal_server_error` | Unexpected server error |

---

## GET /public-games/:id/result

Returns the final result and prize distribution for a **completed** game. The
payload is the `result_summary` JSONB persisted once by `distribute_prizes()`,
so it is stable across calls and matches the `GAME_RESULT` LiveKit broadcast
emitted by the orchestrator (see `docs/game-result-api.md` for the `result`
object schema).

### Path Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | UUID | The game's `id` field |

### Success Response — `200 OK`

```json
{
  "game_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "completed",
  "ended_at": "2026-06-01T18:42:11Z",
  "prizes_distributed_at": "2026-06-01T18:42:14Z",
  "result": { }
}
```

| Field | Type | Notes |
|-------|------|-------|
| `game_id` | UUID string | The game's `id` |
| `status` | string | Game status (always `completed` when `result` is present) |
| `ended_at` | ISO 8601 string \| null | When the game ended |
| `prizes_distributed_at` | ISO 8601 string \| null | When prizes were distributed |
| `result` | object | The persisted `result_summary` (winners, pool split, etc. — see `docs/game-result-api.md`) |

### Error Responses

| HTTP | `error` | Cause |
|------|---------|-------|
| `404` | `game_not_found` | No game exists with the given `id` |
| `409` | `result_pending` | Game is `completed` but prize distribution has not finished yet — poll again |
| `409` | `game_not_completed` | Game has not finished, so no result exists yet |

---

## Response Field Reference

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID string | Unique game identifier |
| `title` | string | Game title |
| `subtitle` | string \| null | Short tagline |
| `description` | string \| null | Full description |
| `mode` | string | Game mode (e.g. `solo`) |
| `status` | string | `upcoming` / `open` / `live` / `closed` / `completed` / `cancelled` |
| `entry_fee` | number | Entry fee in dollars (`0` = free) |
| `prize_pool` | number | Total prize in dollars |
| `prize_pool_currency` | string | e.g. `USD` |
| `category` | string \| null | Game category |
| `difficulty` | string \| null | `Easy` / `Medium` / `Hard` |
| `language` | string | `en` / `ar` / `fa` / `tr` |
| `questions_count` | integer \| null | Number of questions; `null` for runtime-generated games |
| `time_per_question` | integer | Seconds allowed per question (default `15`) |
| `allowed_wrong_answers` | integer \| null | Max wrong answers allowed; `null` = unlimited |
| `participant_count` | integer | Current number of joined participants |
| `max_participants` | integer \| null | Cap on participants; `null` = unlimited |
| `start_time` | ISO 8601 string | Scheduled start (`scheduled_at` in DB) |
| `end_time` | ISO 8601 string \| null | Actual end time (`ended_at` in DB); `null` if not yet ended |
| `is_featured` | boolean | Whether the game is promoted/featured |
| `icon` | URL string \| null | Small icon image |
| `thumbnail_url` | URL string \| null | Larger card thumbnail |
| `poster_url` | URL string \| null | Large promotional poster image (full-bleed hero) |
| `accent_color` | hex string \| null | Brand accent color, e.g. `#FF6B00` |
| `glow_color` | hex string \| null | Glow/shadow color, e.g. `#FF6B0066` |
| `gradient_colors` | string[] \| null | Ordered array of hex colors for gradient background |
| `sponsor` | string \| null | Sponsor name |
| `tags` | string[] \| null | Free-form tag list |
| `host_name` | string \| null | Host display name |
| `host_avatar_url` | URL string \| null | Host avatar image |
| `host_title` | string \| null | Host title/role |
| `rules` | string \| null | Game rules text |

---

---

## GET /public-winners

Returns aggregate results per **completed** game run plus rolling totals for the Winners page. Each row in `runs` represents one finished game — NOT one row per player (a single Saturday show may have 10,000+ survivors).

### Query Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | integer | `20` | Max runs to return. Min `1`, max `100`. |
| `game_id` | string | — | Optional. UUID → filters `games.id`. Slug (non-UUID) → filters `games.show_id`. |
| `language` | string | — | Optional. Accepted: `en`, `ar`, `fa`, `tr`. Filters both `runs` and `totals`. |

### Success Response — `200 OK`

```json
{
  "runs": [
    {
      "run_id": "550e8400-e29b-41d4-a716-446655440000",
      "date": "2026-05-24",
      "game_id": "saturday-mega",
      "game_title": "Saturday Night Live · Flagship Show",
      "game_tag": "Weekly",
      "participants": 84210,
      "survivors": 12480,
      "pool_credits": 50000,
      "share_per_survivor_credits": 4
    }
  ],
  "totals": {
    "credits_distributed": 1845000,
    "runs_listed": 312,
    "survivors_paid_total": 462910,
    "active_shows": 6,
    "avg_weekly_pool_credits": 50000
  }
}
```

### Error Responses

| HTTP | `error` | Cause |
|------|---------|-------|
| `400` | `invalid_language` | `language` is not one of `en`, `ar`, `fa`, `tr` |
| `404` | `not_found` | Path is not exactly `/public-winners` |
| `500` | `failed_to_fetch_winners` | Database query failure |
| `500` | `internal_server_error` | Unexpected server error |

### Response Field Reference — `runs[]`

| Field | Type | Notes |
|-------|------|-------|
| `run_id` | UUID string | The game's `id` in the database |
| `date` | date string \| null | `ended_at` date (YYYY-MM-DD); falls back to `scheduled_at` |
| `game_id` | string | The game's `show_id` slug (falls back to UUID if no slug set) |
| `game_title` | string | Game title |
| `game_tag` | string \| null | First tag, or category, or mode — whichever is first non-null |
| `participants` | integer | Total joined participants (`total_participants`) |
| `survivors` | integer | Players who finished as survivors (`total_winners`) |
| `pool_credits` | integer | Prize pool in credits (integer, R-02 compliant) |
| `share_per_survivor_credits` | integer | `floor(pool_credits / survivors)`; `0` if no survivors |

### Response Field Reference — `totals`

| Field | Type | Notes |
|-------|------|-------|
| `credits_distributed` | integer | Sum of `prize_pool` across all matching completed runs |
| `runs_listed` | integer | Total completed runs matching the filter (not capped by `limit`) |
| `survivors_paid_total` | integer | Sum of `total_winners` across all matching completed runs |
| `active_shows` | integer | Games currently in `upcoming`, `open`, or `live` status |
| `avg_weekly_pool_credits` | integer | `credits_distributed / runs_listed`; `0` if no runs |

---

## GET /public-leaderboard

Ranks players by how many games they finished as a survivor and total credits earned over a window. **This is the only public endpoint that exposes individual players.** Names are rendered server-side as `"<First> <Initial>."` (e.g. `"Aram K."`); no emails, wallet balances, or other PII are returned.

### Query Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `period` | string | **required** | `weekly` (rolling 7 days) or `all_time` |
| `limit` | integer | `20` | Max players to return. Min `1`, max `100`. |
| `language` | string | — | Optional. Accepted: `en`, `ar`, `fa`, `tr`. Filters by `games.language`. |

### Success Response — `200 OK`

```json
{
  "period": "weekly",
  "window": {
    "from": "2026-05-21T00:00:00.000Z",
    "to":   "2026-05-28T00:00:00.000Z"
  },
  "players": [
    {
      "rank": 1,
      "player_name": "Aram K.",
      "avatar_url": null,
      "games_won": 6,
      "games_played": 11,
      "total_credits": 4280,
      "favourite_show": "Saturday Night Live"
    }
  ],
  "totals": {
    "players_listed": 20,
    "credits_distributed_in_window": 92800
  }
}
```

For `period=all_time`, `window.from` is `null` and `window.to` is the current server time.

### Error Responses

| HTTP | `error` | Cause |
|------|---------|-------|
| `400` | `invalid_period` | `period` missing or not `weekly` / `all_time` |
| `400` | `invalid_language` | `language` is not one of `en`, `ar`, `fa`, `tr` |
| `404` | `not_found` | Path is not exactly `/public-leaderboard` |
| `500` | `failed_to_fetch_leaderboard` | Database query failure |
| `500` | `internal_server_error` | Unexpected server error |

### Response Field Reference — `players[]`

| Field | Type | Notes |
|-------|------|-------|
| `rank` | integer | Cross-game ranking within this response. Ordered by `games_won DESC`, then `total_credits DESC`. |
| `player_name` | string | Display-safe `"<First> <Initial>."` rendered from `profiles.full_name`. Never the full name. Falls back to `"Player"` if no name on file. |
| `avatar_url` | URL string \| null | `profiles.avatar_url` if set |
| `games_won` | integer | Games in the window where the player ended as a survivor (`status=completed AND eliminated=false`) |
| `games_played` | integer | Total games the player completed in the window (`role='player'` participations with `completed_at` set) |
| `total_credits` | integer | Sum of `prize_earned` across the window, rounded to nearest integer |
| `favourite_show` | string \| null | Most-played show title within the window. Ties broken alphabetically. |

### Response Field Reference — `totals`

| Field | Type | Notes |
|-------|------|-------|
| `players_listed` | integer | Number of players in the `players` array (≤ `limit`) |
| `credits_distributed_in_window` | integer | Sum of `prize_earned` across **all** matching participants in the window (NOT capped by `limit`) |

---

## GET /public-featured-host

Returns the host of the **closest active featured game** for the homepage "Host Spotlight" card. A game qualifies when `is_featured = true` AND `status ∈ ('upcoming','open','live')`. Selection is by `scheduled_at` ascending — currently-live shows naturally sort first.

When no qualifying game has a linked host record, the endpoint returns `{ "host": null }` so the front-end can hide the section.

### Query Parameters

None.

### Success Response — `200 OK`

```json
{
  "host": {
    "name": "Daniel Reyes",
    "title": "Live Show Host",
    "avatar_url": "https://cdn.quiz4win.com/hosts/daniel.jpg",
    "bio": "Five-time award-winning trivia presenter.",
    "years_on_air": 7,
    "shows_hosted": 412,
    "rating": 4.9,
    "next_show_title": "Saturday Night Live",
    "next_show_pool_credits": 50000,
    "next_show_start_time": "2026-05-30T21:00:00Z"
  }
}
```

### Empty Response — `200 OK`

Returned when no active featured game exists or the matching game has no `host_id` set:

```json
{ "host": null }
```

### Error Responses

| HTTP | `error` | Cause |
|------|---------|-------|
| `404` | `not_found` | Path is not exactly `/public-featured-host` |
| `500` | `failed_to_fetch_featured_host` | Database query failure |
| `500` | `internal_server_error` | Unexpected server error |

### Response Field Reference — `host`

| Field | Type | Notes |
|-------|------|-------|
| `name` | string | `show_hosts.name` |
| `title` | string | From the matching game's `host_title`; falls back to `"Show Host"` if unset |
| `avatar_url` | URL string \| null | `show_hosts.avatar_url`, falls back to the game's inline `host_avatar_url` |
| `bio` | string \| null | `show_hosts.bio` |
| `years_on_air` | integer \| null | `show_hosts.years_on_air` |
| `shows_hosted` | integer | `show_hosts.shows_hosted`; `0` if null |
| `rating` | number \| null | `show_hosts.avg_rating` (`NUMERIC(3,2)`) |
| `next_show_title` | string | The featured game's `title` |
| `next_show_pool_credits` | integer | The featured game's `prize_pool`, rounded |
| `next_show_start_time` | ISO 8601 string \| null | The featured game's `scheduled_at` |

---

## GET /public-sounds

Returns every **active** app sound asset so the mobile app can fetch them once
on startup and cache the correct audio file for each UI event (correct answer,
countdown, winner, etc.). Sounds are returned both as a flat `sounds` array and
pre-`grouped` by `usage` for O(1) lookup by event name.

### Query Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `usage` | string | — | Optional. Restrict to a single usage slot. Allowed: `splash`, `home`, `home_before_start`, `register`, `game_details`, `correct_answer`, `incorrect_answer`, `countdown`, `pregame_music`, `winner`, `loser`, `announcement`, `livestream`. |

### Success Response — `200 OK`

```json
{
  "sounds": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "name": "Correct Answer Chime",
      "usage": "correct_answer",
      "url": "https://fra1.digitaloceanspaces.com/quiz4win/sounds/correct.mp3",
      "proxy_url": "https://api.quiz4win.com/public-sounds/550e8400-e29b-41d4-a716-446655440000/stream",
      "mime_type": "audio/mpeg",
      "duration_seconds": 1.4,
      "updated_at": "2026-05-20T10:00:00Z"
    }
  ],
  "grouped": {
    "correct_answer": [
      { "id": "550e8400-e29b-41d4-a716-446655440000", "name": "Correct Answer Chime", "usage": "correct_answer", "url": "https://fra1.digitaloceanspaces.com/quiz4win/sounds/correct.mp3", "proxy_url": "https://api.quiz4win.com/public-sounds/550e8400-e29b-41d4-a716-446655440000/stream", "mime_type": "audio/mpeg", "duration_seconds": 1.4, "updated_at": "2026-05-20T10:00:00Z" }
    ]
  }
}
```

### Response Field Reference — `sounds[]`

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID string | Sound asset identifier |
| `name` | string | Human-readable label |
| `usage` | string | The UI event slot this sound is for (see allowed values above) |
| `url` | URL string | Direct DigitalOcean Spaces CDN URL of the audio file |
| `proxy_url` | URL string | Server-side proxy URL (`GET /public-sounds/:id/stream`). Use as a fallback when `url` is unreachable on filtered networks. |
| `mime_type` | string \| null | e.g. `audio/mpeg` |
| `duration_seconds` | number \| null | Clip length in seconds |
| `updated_at` | ISO 8601 string | Last update — use for cache invalidation |

### Error Responses

| HTTP | `error` | Cause |
|------|---------|-------|
| `400` | `Unknown usage. Valid values: …` | `usage` is not one of the allowed slots |
| `405` | `Method not allowed` | Method other than `GET` |
| `500` | `Failed to fetch sounds` | Database query failure |

---

## GET /public-sounds/:id/stream

Streams a single active sound's audio bytes through the API server. Use this as
a **fallback** when the direct CDN `url` is unreachable on filtered networks (e.g.
certain ISPs in Iran / Arabic-speaking markets that block DigitalOcean Spaces).

The server presigns a short-lived S3 GET URL internally and forwards the object
bytes without buffering. The client's `Range` header is forwarded, so seekable
playback and partial-content requests work correctly.

### Path Parameters

| Parameter | Type | Notes |
|-----------|------|-------|
| `id` | UUID | Sound asset ID (from `GET /public-sounds`) |

### Request Headers

| Header | Notes |
|--------|-------|
| `Range` | Optional. Standard HTTP range request (e.g. `bytes=0-65535`). Forwarded to S3; enables audio seeking. |

### Success Responses

| HTTP | Description |
|------|-------------|
| `200 OK` | Full object body; `Content-Type`, `Content-Length`, `Accept-Ranges: bytes` set. |
| `206 Partial Content` | Returned when a `Range` header was sent; `Content-Range` propagated from upstream. |

**Response headers:**

| Header | Notes |
|--------|-------|
| `Content-Type` | Audio MIME type (e.g. `audio/mpeg`) |
| `Content-Length` | File size in bytes (when known) |
| `Accept-Ranges` | Always `bytes` — tells clients that range requests are supported |
| `Content-Range` | Present on `206` responses (e.g. `bytes 0-65535/204800`) |
| `Cache-Control` | `public, max-age=86400` (24 h) |

### Error Responses

| HTTP | `error` | Cause |
|------|---------|-------|
| `404` | `sound_not_found` | No active sound with that ID |
| `405` | `Method not allowed` | Method other than `GET` or `HEAD` |
| `502` | `sound_unavailable` | Upstream S3 fetch failed |
| `500` | `Failed to fetch sound` | Database lookup failure |

### Client usage pattern

```swift
// Swift (iOS) — try direct CDN first, fall back to proxy
func loadSound(sound: AppSound) async throws -> Data {
    if let data = try? await fetchURL(sound.url) { return data }
    return try await fetchURL(sound.proxyUrl)   // filtered network fallback
}
```

### Example Requests

```bash
# Stream full audio file
curl "https://api.quiz4win.com/public-sounds/550e8400-e29b-41d4-a716-446655440000/stream"

# Range request — first 64 KB (audio seeking / progressive load)
curl -H "Range: bytes=0-65535" \
  "https://api.quiz4win.com/public-sounds/550e8400-e29b-41d4-a716-446655440000/stream"

# HEAD — get headers without downloading the body
curl -I "https://api.quiz4win.com/public-sounds/550e8400-e29b-41d4-a716-446655440000/stream"
```

---

## What These Endpoints Do NOT Return

- `joined_by_me` — requires an access token; available only on the authenticated `GET /games` endpoint
- Email, wallet balance, KYC status, or any other PII
- Full player names — `/public-leaderboard` only returns `"<First> <Initial>."`
- Player UUIDs / user IDs
- Questions, answers, or results — those require authentication via `GET /games/:id/question`
- Per-player winner rows — `/public-winners` returns only run-level aggregates
- Admin-only fields (internal flags, audit info)

---

## Example Requests

```bash
# List open or live games, highest prize first
curl "https://api.quiz4win.com/public-games?status=open|live&sort=prize_desc&limit=10"

# Featured games in English only
curl "https://api.quiz4win.com/public-games?featured=true&language=en"

# Search for "trivia" at Easy difficulty, page 2
curl "https://api.quiz4win.com/public-games?search=trivia&difficulty=easy&page=2&limit=20"

# All upcoming sports games sorted by start time
curl "https://api.quiz4win.com/public-games?status=upcoming&category=sports&sort=start_asc"

# Single game detail
curl "https://api.quiz4win.com/public-games/550e8400-e29b-41d4-a716-446655440000"

# Final result + prize distribution for a completed game
curl "https://api.quiz4win.com/public-games/550e8400-e29b-41d4-a716-446655440000/result"

# Recent 20 completed game runs (winners summary)
curl "https://api.quiz4win.com/public-winners"

# Last 5 runs for a specific show slug
curl "https://api.quiz4win.com/public-winners?game_id=saturday-mega&limit=5"

# Arabic-language winners only
curl "https://api.quiz4win.com/public-winners?language=ar&limit=50"

# Weekly leaderboard, top 20 players (default)
curl "https://api.quiz4win.com/public-leaderboard?period=weekly"

# All-time top 50, English-language games only
curl "https://api.quiz4win.com/public-leaderboard?period=all_time&limit=50&language=en"

# Host Spotlight — closest active featured game's host (homepage card)
curl "https://api.quiz4win.com/public-featured-host"

# All active app sounds (flat list + grouped by usage)
curl "https://api.quiz4win.com/public-sounds"

# Only the countdown sound
curl "https://api.quiz4win.com/public-sounds?usage=countdown"

# Stream a sound through the API proxy (CDN-bypass fallback)
curl "https://api.quiz4win.com/public-sounds/550e8400-e29b-41d4-a716-446655440000/stream"

# Submit a host application
curl -X POST "https://api.quiz4win.com/public-host-applications" \
  -H "Content-Type: application/json" \
  -d '{"name":"Sarah Chen","email":"sarah@example.com","country":"Canada","instagram":"@sarahplays","followers":48000}'

# Mobile early-access sign-up (Android, with country)
curl -X POST "https://api.quiz4win.com/public-early-birds" \
  -H "Content-Type: application/json" \
  -d '{"platform":"android","name":"Alex Rivera","email":"alex@example.com","country_name":"Canada","country_code":"CA"}'

# Mobile early-access sign-up (iOS — email is the Apple ID identifier)
curl -X POST "https://api.quiz4win.com/public-early-birds" \
  -H "Content-Type: application/json" \
  -d '{"platform":"ios","name":"Mia Tanaka","email":"mia@privaterelay.appleid.com","country_name":"Japan","country_code":"JP"}'
```

---

## `POST /public-host-applications`

Submit a host application from the public website. No authentication required.

### Request body (JSON)

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `name` | `string` | ✅ | 2–120 characters |
| `email` | `string` | ✅ | Valid email, 5–254 characters |
| `country` | `string` | — | Up to 80 characters |
| `instagram` | `string` | — | Handle with or without `@`, up to 80 characters |
| `followers` | `integer` | — | Non-negative integer |

### Success response `201 Created`

```json
{
  "ok": true,
  "application_id": "b7e4c2a1-9f3d-4d8e-a5b0-1234567890ab"
}
```

### Error responses

| Status | `error` | Meaning |
|--------|---------|---------|
| `400` | `invalid_json` | Body is not valid JSON |
| `400` | `name_invalid` | Name missing or out of range |
| `400` | `email_invalid` | Email missing, malformed, or too long |
| `404` | `not_found` | Wrong HTTP method or path |
| `409` | `application_already_pending` | Email already has a pending application |
| `429` | `rate_limited` | Too many requests from this IP (see limits below) |
| `500` | `failed_to_submit_application` | Unexpected server error |

### Rate limits

To protect against abuse:

- **3 submissions per IP per 10 minutes**
- **5 submissions per IP per hour**

On `429`, the response includes a `Retry-After: 600` header (10 minutes).

### Confirmation email

A branded **"Thanks for applying"** email is sent to the applicant immediately on successful submission. The email outlines the 3-step review process (Review → Screen test → Go live) and links to a live show.

### Admin management

Submitted applications are visible in the Quiz4Win Admin Panel under **Content → Host Applications**. Admins can:

- **Accept** — approve the applicant and add internal notes.
- **Reject** — dismiss with an optional reason note.
- **Request more info** — flag the application for follow-up.
- **Send custom email** — compose and send an email directly to the applicant's provided address.

---

## `POST /public-early-birds`

Mobile app early-access sign-up — collects the user's name and email (or Apple ID identifier for iOS) and sends a branded welcome email. No authentication required.

### Request body (JSON)

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `platform` | `"ios" \| "android"` | ✅ | Must be exactly one of these literal strings. |
| `name` | `string` | ✅ | 1–120 characters. |
| `email` | `string` | ✅ | For Android: regular email address. For iOS: the user's Apple ID identifier (email-format, possibly `@privaterelay.appleid.com`) as returned by Sign in with Apple. 5–254 characters. |
| `country_name` | `string` | — | Full country name, e.g. `"Canada"`. Up to 100 characters. |
| `country_code` | `string` | — | ISO 3166-1 alpha-2 country code, e.g. `"CA"`. Exactly 2 characters. Stored uppercase. |

### Success response `201 Created`

```json
{
  "ok": true,
  "early_bird_id": "8f0a3b21-2e10-4f3a-9b66-0a1f2c3d4e5f"
}
```

### Error responses

| Status | `error` | Meaning |
|--------|---------|---------|
| `400` | `invalid_json` | Body is not valid JSON |
| `400` | `platform_invalid` | `platform` missing or not `"ios" \| "android"` |
| `400` | `name_invalid` | Name missing or > 120 chars |
| `400` | `email_invalid` | Email/Apple-ID missing, malformed, or > 254 chars |
| `400` | `country_name_invalid` | `country_name` provided but exceeds 100 characters |
| `400` | `country_code_invalid` | `country_code` provided but is not exactly 2 characters |
| `404` | `not_found` | Wrong HTTP method or path |
| `409` | `already_signed_up` | This `(platform, email)` is already on the early-access list |
| `429` | `rate_limited` | Too many requests from this IP (see limits below) |
| `500` | `failed_to_sign_up` | Unexpected server error |

### Rate limits

- **5 submissions per IP per 10 minutes**
- **10 submissions per IP per hour**

On `429`, the response includes a `Retry-After: 600` header (10 minutes). Limits are slightly more permissive than `/public-host-applications` because mobile onboarding may legitimately retry from the same NAT'd IP.

### Welcome email

A graphical **"You're on the list"** email is sent to the supplied address immediately on success. It includes:

- Platform-aware subject line (iOS / Android)
- Early-access perks (launch-day bonus credits, invite-only shows, etc.)
- A CTA to play in the browser while waiting for the mobile launch

The email send is best-effort and asynchronous — if Brevo is unreachable the sign-up still succeeds and the failure is logged server-side.
