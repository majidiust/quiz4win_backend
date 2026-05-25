# Quiz4Win API — Games Reference

Base URL: `https://api.quiz4win.com`  
All requests require: `Authorization: Bearer <user_jwt>`  
All responses are JSON: `{ "data": { ... } }` on success, `{ "error": "<code>" }` on failure.

---

## Common Error Codes

| Code | HTTP | Meaning |
|------|------|---------|
| `unauthorized` | 401 | Missing or invalid JWT |
| `game_not_found` | 404 | Game UUID doesn't exist |
| `game_not_open` | 400 | Game status is not `open` |
| `game_full` | 400 | `participant_count` reached `max_participants` |
| `already_joined` | 409 | User already a participant |
| `insufficient_balance` | 400 | Wallet balance < entry fee |
| `not_joined` | 403 | Must join before accessing questions/answers |
| `no_active_question` | 404 | No more questions (game finished for you) |
| `already_answered` | 400 | That `question_id` was already submitted |
| `no_prize_to_claim` | 400 | `prize_earned` is 0 |
| `prize_already_credited` | 409 | Prize was already claimed |
| `cannot_leave_started_game` | 400 | Game already started or ended |

---

## Customer Game API

### `GET /games` — List Games

**Query Parameters**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `status` | string | `open` | Filter by status. Pipe-delimit for OR: `open|upcoming` |
| `mode` | string | — | Filter by mode: `timed`, `battle`, `daily`, `tournament`, `live` |
| `featured` | string | — | If `true`, returns only games where `is_featured = true` (powers the home-screen hero carousel) |
| `page` | number | `1` | Pagination page |
| `limit` | number | `20` | Results per page (max 50) |

**Response (`GameSummary[]`)**

> `GameSummary` and `GameDetail` share the **same key set** — see field reference below the example. Aliases: `max_participants` (← `max_players`), `participant_count` (← `total_participants`), `start_time` (← `scheduled_at`), `end_time` (← `ended_at`).

```json
{
  "data": {
    "games": [
      {
        "id": "uuid",
        "title": "Champions League Quiz",
        "subtitle": "Test your football knowledge",
        "description": "Full description text",
        "mode": "live",
        "status": "open",
        "entry_fee": 5.00,
        "prize_pool": 500.00,
        "prize_pool_currency": "USD",
        "category": "Sports",
        "difficulty": "Medium",
        "language": "en",
        "questions_count": 10,
        "time_per_question": 15,
        "allowed_wrong_answers": 3,
        "participant_count": 42,
        "max_participants": 100,
        "start_time": "2026-05-25T20:00:00Z",
        "end_time": null,
        "is_featured": true,
        "joined_by_me": false,
        "icon": "https://cdn.example.com/games/uuid/icon.png",
        "thumbnail_url": "https://cdn.example.com/games/uuid/thumbnail.jpg",
        "accent_color": "#EF4444",
        "glow_color": "#FF6B6B",
        "gradient_colors": ["#0A0518", "#13082E"],
        "sponsor": "Sponsor Name",
        "tags": ["football", "champions"],
        "host_name": "Alex Johnson",
        "host_avatar_url": "https://cdn.example.com/games/uuid/host_avatar.jpg",
        "host_title": "Live Host",
        "rules": ["Each question has one correct answer", "No skipping"]
      }
    ],
    "pagination": { "page": 1, "limit": 20, "total": 5, "total_pages": 1 }
  }
}
```

**Field Reference (shared by `GameSummary` and `GameDetail`)**

| Field | Type | Notes |
|-------|------|-------|
| `id` | string (uuid) | |
| `title`, `subtitle`, `description` | string\|null | |
| `mode` | enum | `timed` \| `battle` \| `daily` \| `tournament` \| `live` |
| `status` | enum | `upcoming` \| `open` \| `live` \| `completed` \| `cancelled` |
| `entry_fee`, `prize_pool` | number | NUMERIC dollars |
| `prize_pool_currency` | string | ISO-4217 (or local) code — `USD`, `AED`, `EUR`, etc. UI uses this to pick the symbol |
| `category`, `difficulty`, `language` | string\|null | |
| `questions_count` | integer | Total questions in the game |
| `time_per_question` | integer | Seconds per question (countdown) |
| `allowed_wrong_answers` | integer\|null | "Lives" before elimination (null = unlimited) |
| `participant_count` | integer | Alias of `total_participants` |
| `max_participants` | integer\|null | Alias of `max_players` (null = uncapped) |
| `start_time` | timestamptz\|null | Alias of `scheduled_at` |
| `end_time` | timestamptz\|null | Alias of `ended_at` |
| `is_featured` | boolean | Drives the hero/carousel slot |
| `joined_by_me` | boolean | True when the authenticated user is already a participant — lets the UI show "✓ Joined" without a detail fetch |
| `icon`, `thumbnail_url`, `host_avatar_url` | string\|null | Public S3 URLs |
| `accent_color`, `glow_color` | string\|null | Hex (e.g. `#EF4444`) — glow may include alpha (`#EF444440`) |
| `gradient_colors` | string[]\|null | Hex array for backgrounds, e.g. `["#0A0518", "#13082E"]` |
| `sponsor`, `host_name`, `host_title` | string\|null | |
| `tags`, `rules` | string[]\|null | |

---

### `GET /games/:id` — Game Detail

Returns the same object shape as a `GameSummary` row (see field reference above) plus `joined_by_me`.

**Response (`GameDetail`)**

```json
{
  "data": {
    "game": {
      "id": "uuid",
      "title": "Champions League Quiz",
      "status": "open",
      "mode": "live",
      "entry_fee": 5.00,
      "prize_pool": 500.00,
      "prize_pool_currency": "USD",
      "questions_count": 10,
      "time_per_question": 15,
      "allowed_wrong_answers": 3,
      "max_participants": 100,
      "participant_count": 42,
      "start_time": "2026-05-25T20:00:00Z",
      "end_time": null,
      "is_featured": true,
      "joined_by_me": true,
      "accent_color": "#EF4444",
      "glow_color": "#FF6B6B",
      "gradient_colors": ["#0A0518", "#13082E"],
      "icon": "https://cdn.example.com/...",
      "thumbnail_url": "https://cdn.example.com/...",
      "host_name": "Alex Johnson",
      "host_avatar_url": "https://cdn.example.com/...",
      "host_title": "Live Host",
      "sponsor": null,
      "tags": [],
      "rules": []
    }
  }
}
```

---

### `POST /games/:id/join` — Join Game

Atomically debits the entry fee from the user's wallet and creates a participant record (R-09). Requires game `status = "open"` and sufficient `wallet_balance`.

**Request body:** none

**Response `201`**
```json
{
  "data": { "message": "Joined game successfully" }
}
```

**Error cases:** `game_not_found`, `game_not_open`, `game_full`, `already_joined`, `insufficient_balance`

---

### `DELETE /games/:id/join` — Leave Game

Removes the participant record and refunds the entry fee. Only allowed when `status` is `upcoming` or `open` (cannot leave a started/ended game).

**Request body:** none

**Response `200`**
```json
{
  "data": { "message": "Left game and entry fee refunded" }
}
```

**Error cases:** `game_not_found`, `not_joined`, `cannot_leave_started_game`

---

### `GET /games/:id/participants` — Participants List

**Query Parameters**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `page` | number | `1` | Pagination page |
| `limit` | number | `50` | Results per page (max 100) |

**Response**
```json
{
  "data": {
    "participants": [
      {
        "user_id": "uuid",
        "score": 8500,
        "rank": 1,
        "joined_at": "2026-05-25T19:55:00Z",
        "profiles": {
          "name": "John Doe",
          "avatar_url": "https://cdn.example.com/avatars/uuid.jpg"
        }
      }
    ],
    "pagination": { "page": 1, "limit": 50, "total": 42 }
  }
}
```

---

### `GET /games/:id/question` — Get Current Question

Returns the next unanswered question for the authenticated user. The question index is derived from the number of answers already submitted — call this repeatedly to advance through the game.

**Response `200`**
```json
{
  "data": {
    "question": {
      "order": 0,
      "questions": {
        "id": "question-uuid",
        "text": "Who won the 2024 Champions League?",
        "options": ["Real Madrid", "Man City", "Bayern", "PSG"],
        "category": "Football",
        "difficulty": "Medium"
      }
    },
    "time_per_question_sec": 15
  }
}
```

**Error cases:** `not_joined` (403), `no_active_question` (404 — all questions answered)

---

### `POST /games/:id/answer` — Submit Answer

**Request Body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `question_id` | string (UUID) | \u2705 | From `GET /question` \u2192 `questions.id` |
| `answer` | number | \u2705 | Zero-based index into the `options` array |
| `response_time_ms` | number | \u2014 | Response time in milliseconds (used for scoring) |

**Example**
```json
{
  "question_id": "question-uuid",
  "answer": 0,
  "response_time_ms": 1450
}
```

**Response `200`**
```json
{
  "data": {
    "result": {
      "correct": true,
      "correct_index": 0,
      "points_earned": 850
    }
  }
}
```

**Scoring:** `points = MAX(1000 \u2212 response_time_ms, 100)` if correct, `0` if wrong.

**Error cases:** `not_a_participant`, `already_answered`, `question_not_found`

---

### `GET /games/:id/leaderboard` — Leaderboard

**Query Parameters**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | number | `50` | Max entries (capped at 200) |

**Response `200`**
```json
{
  "data": {
    "leaderboard": [
      {
        "rank": 1,
        "score": 8500,
        "prize_amount": 250.00,
        "user_id": "uuid",
        "profiles": {
          "name": "John Doe",
          "avatar_url": "https://cdn.example.com/avatars/uuid.jpg"
        }
      }
    ]
  }
}
```

---

### `GET /games/:id/result` — My Result

Returns the authenticated user's personal result after the game ends.

**Response `200`**
```json
{
  "data": {
    "result": {
      "score": 8500,
      "rank": 1,
      "prize_amount": 250.00,
      "correct_answers": 9,
      "wrong_answers": 1,
      "completed_at": "2026-05-25T20:22:00Z"
    }
  }
}
```

**Error cases:** `result_not_found` (404 \u2014 game not finished or user didn't participate)

---

### `POST /games/:id/claim-prize` — Claim Prize

Manually triggers a prize credit if the automatic post-game crediting failed. Idempotency-safe \u2014 returns `prize_already_credited` on double-claim.

**Request body:** none

**Response `200`**
```json
{
  "data": {
    "message": "Prize credited to wallet",
    "amount": 250.00
  }
}
```

**Error cases:** `not_a_participant`, `no_prize_to_claim`, `prize_already_credited`

---

## Admin Game API

All admin endpoints additionally require the JWT to belong to a user with role `super_admin`, `admin`, or `moderator`.

---

### `GET /admin/games` — List All Games

**Query Parameters**

| Param | Type | Description |
|-------|------|-------------|
| `status` | string | Filter: `upcoming`, `open`, `live`, `paused`, `ended`, `cancelled`. Pipe for OR. |
| `page` | number | Default `1` |
| `limit` | number | Default `20`, max `100` |

**Response `200`** \u2014 same shape as customer list but with all columns (`created_by`, `prize_breakdown`, etc.)

---

### `POST /admin/games` — Create Game

**Request Body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | string | \u2705 | Game title |
| `mode` | string | \u2705 | `timed`, `battle`, `daily`, `tournament`, `live` |
| `entry_fee` | number | \u2705 | Entry fee in dollars (e.g. `5.00`) |
| `prize_pool` | number | \u2705 | Total prize pool in dollars |
| `start_time` | string | \u2705 | ISO 8601 scheduled start |
| `max_participants` | number | \u2705 | Maximum players allowed |
| `subtitle` | string | \u2014 | Short subtitle for cards |
| `description` | string | \u2014 | Long description |
| `category` | string | \u2014 | e.g. `"Sports"` |
| `difficulty` | string | \u2014 | `Easy`, `Medium`, `Hard` |
| `language` | string | \u2014 | `en`, `ar`, `fa`, `tr` |
| `time_per_question` | number | \u2014 | Seconds per question (default `15`) |
| `accent_color` | string | \u2014 | 7-char hex `#RRGGBB` |
| `glow_color` | string | \u2014 | 7-char hex `#RRGGBB` |
| `gradient_colors` | string[] | \u2014 | Array of hex strings |
| `sponsor` | string | \u2014 | Sponsor name |
| `tags` | string[] | \u2014 | Searchable tags |
| `host_name` | string | \u2014 | Display name of the host |
| `host_title` | string | \u2014 | Host title/role text |
| `rules` | string[] | \u2014 | List of game rules |

**Response `201`**
```json
{
  "data": { "game": { "id": "new-uuid", "status": "upcoming", "..." : "..." } }
}
```

---

### `PATCH /admin/games/:id` — Update Game

Same fields as POST (all optional). Only allowed when `status` is `upcoming` or `open`.

**Response `200`** \u2014 `{ \"data\": { \"game\": { ... } } }`

---

### `POST /admin/games/:id/asset` — Upload Game Asset

Uploads an image to S3 and writes the URL to the matching game column.

**Request:** `multipart/form-data`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `field` | string | \u2705 | Target column: `icon`, `thumbnail_url`, or `host_avatar_url` |
| `file` | File | \u2705 | Image file \u2014 JPEG, PNG, WebP, or SVG. Max 10 MB. |

**Response `200`**
```json
{
  "data": {
    "field": "thumbnail_url",
    "url": "https://your-spaces.region.digitaloceanspaces.com/games/uuid/thumbnail_url-1716667200000.jpg"
  }
}
```

---

### `POST /admin/games/:id/questions` — Assign Question Set

**Request Body**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `question_ids` | string[] | \u2705 | Ordered array of question UUIDs |
| `replace` | boolean | \u2014 | Default `true` \u2014 delete existing questions first |

**Response `200`**
```json
{ "data": { "message": "Assigned 10 questions", "count": 10 } }
```

---

### `POST /admin/games/:id/start` \u2014 Start Game
Sets status to `live`. No body required.

### `POST /admin/games/:id/end` \u2014 End Game
Sets status to `ended`. No body required.

### `POST /admin/games/:id/pause` \u2014 Pause Game
Sets status to `paused` (only from `live`). No body required.

### `POST /admin/games/:id/resume` \u2014 Resume Game
Sets status back to `live` (only from `paused`). No body required.

### `POST /admin/games/:id/cancel` \u2014 Cancel Game

Cancels and refunds all participant entry fees.

**Request Body**
```json
{ "reason": \"Technical issues\" }
```

**Response `200`** \u2014 `{ \"data\": { \"message\": \"Game cancelled and entry fees refunded\" } }`

---

### `POST /admin/games/:id/duplicate` \u2014 Duplicate Game

Clones all settings into a new `upcoming` game. Optionally copies the question set.

**Request Body (all optional)**

| Field | Type | Description |
|-------|------|-------------|
| `title` | string | Override title (defaults to `\"<original> (copy)\"`) |
| `copy_questions` | boolean | Default `true` \u2014 copies `game_questions` |
| any game field | \u2014 | Override any field on the clone |

**Response `201`** \u2014 `{ \"data\": { \"game\": { ... } } }`

---

### `GET /admin/games/:id/participants` \u2014 Participant Details (Admin)

Returns full participant data including profiles join.

**Response `200`**
```json
{
  "data": {
    "participants": [
      {
        "user_id": "uuid",
        "score": 8500,
        "rank": 1,
        "correct_answers": 9,
        "wrong_answers": 1,
        "prize_amount": 250.00,
        "prize_credited": false,
        "joined_at": "2026-05-25T19:55:00Z",
        "profiles": { \"name\": \"John Doe\", \"email\": \"john@example.com\", \"avatar_url\": \"...\" }
      }
    ]
  }
}
```

---

### `DELETE /admin/games/:id/participants/:userId` \u2014 Remove Participant

Removes a specific user from the game. No refund is issued automatically.

**Response `200`** \u2014 `{ \"data\": { \"message\": \"Participant removed\" } }`

---

### `GET /admin/games/:id/result` \u2014 Game Results & Prize Breakdown

**Response `200`**
```json
{
  "data": {
    "game": { \"id\": \"...\", \"title\": \"...\", \"status\": \"ended\", \"prize_pool\": 500.00 },
    "rankings": [
      {
        "user_id": "uuid",
        "rank": 1,
        "score": 8500,
        "correct_answers": 9,
        "wrong_answers": 1,
        "prize_amount": 250.00,
        "prize_credited": true,
        "profiles": { \"name\": \"John Doe\", \"email\": \"john@example.com\", \"avatar_url\": \"...\" }
      }
    ],
    "questions": [
      {
        "question_id": "uuid",
        "question_index": 0,
        "asked_at": "2026-05-25T20:01:00Z",
        "questions": { \"text\": \"Who won...\", \"category\": \"Sports\", \"difficulty\": \"Medium\" }
      }
    ],
    "summary": {
      "total_prizes_paid_cents": 450.00,
      "prize_pool_cents": 500.00
    }
  }
}
```

---

### `GET /admin/games/:id/export` \u2014 Export Results as CSV

Returns a `text/csv` file download with columns:
`user_id`, `name`, `email`, `rank`, `score`, `prize_amount_cents`, `prize_credited`, `joined_at`

**Response:** `Content-Type: text/csv`, `Content-Disposition: attachment; filename=\"game-<id>-results-<date>.csv\"`

---

### `POST /admin/games/:id/next-question` \u2014 Advance to Next Question

Calls the `advance_game_question` DB RPC (live-show host action). Returns the RPC result.

> \u26a0\ufe0f The `advance_game_question` RPC has not yet been defined in a migration. This endpoint will return a DB error until that migration is deployed.
