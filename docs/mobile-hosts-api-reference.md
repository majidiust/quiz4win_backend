# Hosts API (Mobile) — Reference

Read-only endpoints for browsing show-host directories and profiles. Intended
**only** for the Quiz4Win **Android** and **iOS** apps — not a general-purpose
public web API.

**Base URL:** `https://api.quiz4win.com`
**Route prefix:** `/public-hosts/*` — this is the deployed path (kept stable for
backward compatibility); treat it as the mobile hosts API, not a public-web one.
**Authentication:** No `Authorization` header or JWT is required to call these
routes today. They return only non-PII, already-public host data.
**CORS:** Open (`Access-Control-Allow-Origin: *`). Preflight (`OPTIONS`) returns `204 No Content`.

**Visibility:** Only hosts with `status = 'active'` (enforced by the
`show_hosts_select_active` RLS policy) **and** `application_status = 'approved'`
(defence-in-depth filter on every query) are ever returned.

**PII (never returned, per R-01):** `phone`, `auth_user_id`, `total_earnings`,
and all lifecycle timestamps (`applied_at`, `approved_at`, `approved_by`,
`rejected_at`, `rejection_reason`, `suspended_at`, `suspension_reason`).

**Rate limiting (R-17):** These routes are limited to **60 requests/minute per
client IP** (the `public` tier). Every response carries `X-RateLimit-Limit`,
`X-RateLimit-Remaining`, and `X-RateLimit-Reset` (seconds until the window
resets). When the budget is exhausted the API responds:

```
HTTP/1.1 429 Too Many Requests
Retry-After: 42
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 42
Content-Type: application/json

{ "error": "rate_limited" }
```

Clients SHOULD honour `Retry-After` and back off rather than retrying
immediately. The window is fixed (per-minute) and shared across all
`/public-hosts/*` routes for a given IP.

---

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/public-hosts` | List hosts (filterable, paginated) |
| `GET` | `/public-hosts/live` | Hosts on air right now (+ their live show) |
| `GET` | `/public-hosts/upcoming` | Hosts with future shows (+ those shows) |
| `GET` | `/public-hosts/:id` | Single host profile + live/upcoming stats |
| `GET` | `/public-hosts/:id/live` | The host's current live show (or `null`) |
| `GET` | `/public-hosts/:id/upcoming` | The host's upcoming shows (paginated) |
| `GET` | `/public-hosts/:id/history` | The host's past completed shows (paginated) |
| `OPTIONS` | `/public-hosts/*` | CORS preflight |

> `live` and `upcoming` are reserved path keywords. Host IDs are UUIDs, so they
> can never collide with the `/public-hosts/:id` route.

---

## Shared object schemas

### `Host` object

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID | Host identifier |
| `name` | string | Display name |
| `short_bio` | string \| null | One-line tagline |
| `bio` | string \| null | Full biography |
| `avatar_url` | string \| null | Profile image URL |
| `country` | string \| null | ISO country / display name |
| `languages` | string[] | e.g. `["en","ar","fa","tr"]` |
| `shows_hosted` | integer | Lifetime count of shows hosted |
| `avg_rating` | number \| null | Average rating (`null` if unrated) |
| `years_on_air` | integer \| null | Tenure in years |
| `created_at` | timestamp | When the host record was created |
| `instagram_url` | string \| null | Social link |
| `telegram_url` | string \| null | Social link |
| `youtube_url` | string \| null | Social link |
| `tiktok_url` | string \| null | Social link |
| `twitter_url` | string \| null | Social link |
| `website_url` | string \| null | Social link |

### `GameSummary` object

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID | Game identifier |
| `title` | string | Show title |
| `mode` | string | Game mode |
| `status` | string | `upcoming` \| `open` \| `live` \| `completed` |
| `entry_fee` | number | Entry fee |
| `prize_pool` | number | Total prize pool |
| `prize_pool_currency` | string | e.g. `USD` |
| `participant_count` | integer | Current participants (`total_participants`) |
| `max_participants` | integer | Capacity (`max_players`) |
| `start_time` | timestamp \| null | Scheduled start (`scheduled_at`) |
| `end_time` | timestamp \| null | End time (`ended_at`) |
| `thumbnail_url` | string \| null | Thumbnail image |
| `poster_url` | string \| null | Poster image |
| `accent_color` | string \| null | Brand accent colour |

---

## `GET /public-hosts`

Paginated, filterable list of all visible hosts.

### Query parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `search` | string | — | Case-insensitive `ILIKE` against `name` and `short_bio`. `%` and `_` are stripped before matching. |
| `country` | string | — | Exact match on `country`. |
| `language` | string | — | Returns hosts whose `languages[]` contains this value (e.g. `en`, `ar`, `fa`, `tr`). |
| `sort` | string | `rating_desc` | `rating_desc` — highest rating first<br>`shows_desc` — most shows hosted first<br>`newest` — most recently created first |
| `page` | integer | `1` | 1-based page number. |
| `limit` | integer | `20` | Results per page. Min `1`, max `50`. |

### Success response — `200 OK`

```json
{
  "hosts": [ { "id": "…", "name": "Ali Reza", "...": "Host object fields" } ],
  "pagination": { "page": 1, "limit": 20, "total": 137, "total_pages": 7 }
}
```

### Error responses

| HTTP | `error` | Cause |
|------|---------|-------|
| `500` | `internal_server_error` | Database query failure or unexpected error |

---

## `GET /public-hosts/live`

Hosts that currently have a `status='live'` game (inner-join on `games`).
Sorted by `avg_rating` descending.

### Query parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | integer | `1` | 1-based page number. |
| `limit` | integer | `20` | Results per page. Min `1`, max `50`. |

### Success response — `200 OK`

```json
{
  "hosts": [
    { "id": "…", "name": "Ali Reza", "live_shows": [ { "id": "…", "...": "GameSummary fields" } ] }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 4, "total_pages": 1 }
}
```

Each host object is a full **Host** object plus a `live_shows` array of
**GameSummary** objects (the games currently on air).

### Error responses

| HTTP | `error` | Cause |
|------|---------|-------|
| `500` | `internal_server_error` | Database query failure or unexpected error |

---

## `GET /public-hosts/upcoming`

Hosts that have at least one `upcoming` or `open` game (inner-join on `games`).
Hosts are sorted by `avg_rating` descending; each host's embedded shows are
sorted soonest-first.

### Query parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | integer | `1` | 1-based page number. |
| `limit` | integer | `20` | Results per page. Min `1`, max `50`. |

### Success response — `200 OK`

```json
{
  "hosts": [
    {
      "id": "…", "name": "Ali Reza",
      "upcoming_shows": [ { "id": "…", "...": "GameSummary fields" } ],
      "upcoming_shows_count": 3
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 12, "total_pages": 1 }
}
```

Each host object is a full **Host** object plus an `upcoming_shows` array of
**GameSummary** objects and an `upcoming_shows_count` integer.

### Error responses

| HTTP | `error` | Cause |
|------|---------|-------|
| `500` | `internal_server_error` | Database query failure or unexpected error |

---

## `GET /public-hosts/:id`

Single host profile, plus live/upcoming summary flags.

### Path parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | UUID | The host's `id`. |

### Success response — `200 OK`

```json
{
  "host": {
    "id": "…", "name": "Ali Reza", "...": "Host object fields",
    "is_live": true,
    "upcoming_shows_count": 3
  }
}
```

Returns a full **Host** object plus two derived fields:

| Field | Type | Notes |
|-------|------|-------|
| `is_live` | boolean | `true` if the host has a `status='live'` game right now. |
| `upcoming_shows_count` | integer | Count of the host's `upcoming`/`open` games. |

### Error responses

| HTTP | `error` | Cause |
|------|---------|-------|
| `404` | `host_not_found` | No visible host with that `id`. |
| `500` | `internal_server_error` | Database query failure or unexpected error |

---

## `GET /public-hosts/:id/live`

The host's current live show, or `null` if not on air.

### Path parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | UUID | The host's `id`. |

### Success response — `200 OK`

```json
{ "live_show": { "id": "…", "...": "GameSummary fields" } }
```

`live_show` is a single **GameSummary** object, or `null` when the host has no
live game.

### Error responses

| HTTP | `error` | Cause |
|------|---------|-------|
| `404` | `host_not_found` | No visible host with that `id`. |
| `500` | `internal_server_error` | Database query failure or unexpected error |

---

## `GET /public-hosts/:id/upcoming`

The host's upcoming (`upcoming`/`open`) shows, soonest-first, paginated.

### Path parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | UUID | The host's `id`. |

### Query parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | integer | `1` | 1-based page number. |
| `limit` | integer | `10` | Results per page. Min `1`, max `50`. |

### Success response — `200 OK`

```json
{
  "shows": [ { "id": "…", "...": "GameSummary fields" } ],
  "pagination": { "page": 1, "limit": 10, "total": 3, "total_pages": 1 }
}
```

### Error responses

| HTTP | `error` | Cause |
|------|---------|-------|
| `404` | `host_not_found` | No visible host with that `id`. |
| `500` | `internal_server_error` | Database query failure or unexpected error |

---

## `GET /public-hosts/:id/history`

The host's past `completed` shows, most-recent-first, paginated.

### Path parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | UUID | The host's `id`. |

### Query parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | integer | `1` | 1-based page number. |
| `limit` | integer | `20` | Results per page. Min `1`, max `50`. |

### Success response — `200 OK`

```json
{
  "shows": [ { "id": "…", "...": "GameSummary fields" } ],
  "pagination": { "page": 1, "limit": 20, "total": 58, "total_pages": 3 }
}
```

### Error responses

| HTTP | `error` | Cause |
|------|---------|-------|
| `404` | `host_not_found` | No visible host with that `id`. |
| `500` | `internal_server_error` | Database query failure or unexpected error |
