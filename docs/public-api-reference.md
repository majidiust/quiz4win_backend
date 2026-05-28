# Public Games API — Reference

**Base URL:** `https://api.quiz4win.com`  
**Authentication:** None required — no `Authorization` header, no API key.  
**CORS:** Open (`Access-Control-Allow-Origin: *`). Preflight (`OPTIONS`) returns `204 No Content`.

---

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/public-games` | List games (filterable, paginated) |
| `GET` | `/public-games/:id` | Single game detail |
| `OPTIONS` | `/public-games` | CORS preflight |
| `OPTIONS` | `/public-games/:id` | CORS preflight |

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

## What These Endpoints Do NOT Return

- `joined_by_me` — requires a user JWT; available only on the authenticated `GET /games` endpoint
- Any user profile or PII data
- Questions, answers, or results — those require authentication via `GET /games/:id/question`
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
```
