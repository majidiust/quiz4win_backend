# Public API — Reference

**Base URL:** `https://api.quiz4win.com`
**Authentication:** None required — no `Authorization` header, no API key.
**CORS:** Open (`Access-Control-Allow-Origin: *`). Preflight (`OPTIONS`) returns `204 No Content`.

---

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/public-games` | List games (filterable, paginated) |
| `GET` | `/public-games/:id` | Single game detail |
| `GET` | `/public-winners` | Aggregate winner stats per completed game run |
| `GET` | `/public-leaderboard` | Ranked players by survivor finishes + credits over a window |
| `OPTIONS` | `/public-games` | CORS preflight |
| `OPTIONS` | `/public-games/:id` | CORS preflight |
| `OPTIONS` | `/public-winners` | CORS preflight |
| `OPTIONS` | `/public-leaderboard` | CORS preflight |

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

## What These Endpoints Do NOT Return

- `joined_by_me` — requires a user JWT; available only on the authenticated `GET /games` endpoint
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
```
