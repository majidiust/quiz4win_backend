# Quiz4Win — Financial Model & API Reference

**Base URL:** `https://api.quiz4win.com`
**Auth:** `Authorization: Bearer <access-token>` on every endpoint.
**Content-Type:** `application/json`
**Amounts:** All money values are `NUMERIC(12,2)` EUR (cents precision). Score values are integers (`BIGINT`).

> **Response envelope — read this first.** Edge functions return the **raw JSON
> object** on success (there is **no** top-level `data` wrapper) and
> `{ "error": "<code>" }` on failure. So a profile read is
> `{ "user": { … } }`, a balance read is `{ "wallet_balance": …, … }`, etc.
> The HTTP status code carries success/failure; the `error` string is a stable,
> client-switchable code (never a raw DB message — R-01 / `sanitizeError`).
>
> **Amount serialisation differs per endpoint** (this is intentional and
> documented inline below):
> - Values read **straight from a NUMERIC column** (`GET /profile`,
>   `withdrawal.amount`, `GET /wallet/transactions[].amount`) arrive as
>   **decimal strings** (`"25.00"`) — PostgREST serialises `NUMERIC` as text to
>   avoid float rounding.
> - Values the function **computes and returns** (`GET /wallet/balance`,
>   `POST /wallet/transfer`, the `earnings_balance` echo on withdrawal) are
>   coerced with `Number(...)` and arrive as **JSON numbers** (`25`, `75.5`).
> - Clients should parse with `Number(value)` defensively in both cases.

---

## 1. Three-Bucket Model Overview

Every user has three separate, non-interchangeable balances:

| Bucket | Column | Type | Purpose |
|--------|--------|------|---------|
| **Wallet** | `wallet_balance` | `NUMERIC(12,2)` | Play money — entry fees paid from here; funded by top-ups, refunds, and transfers from earnings |
| **Earnings** | `earnings_balance` | `NUMERIC(12,2)` | Game winnings (money prizes) — withdrawable or transferable to wallet |
| **Score** | `score_balance` | `BIGINT` | Leaderboard points — non-monetary today; convertible to money in future |

### Flow rules
```
Top-up payment          → wallet_balance +=
Game entry fee          → wallet_balance -=          (R-09 atomic)
Win money prize         → earnings_balance +=         (not wallet!)
Win score points        → score_balance +=
Transfer earnings       → earnings_balance -=, wallet_balance +=  (atomic RPC)
Withdrawal              → earnings_balance -=         (KYC if > 1,000 EUR)
Rejected withdrawal     → earnings_balance +=  (refund back to earnings)
Admin adjustment        → wallet_balance OR earnings_balance (explicit target)
```

> **INV-15 — Earnings isolation:** earnings can never be spent directly on entry fees.
> They must first be transferred to `wallet_balance` via the transfer endpoint.
>
> **INV-16 — Winnings lock:** once earnings are transferred to wallet they become
> play-money and cannot be withdrawn again. This is the AML anti-replay control.
>
> **INV-05 (updated) — KYC threshold:** KYC (`kyc_status = 'verified'`) is required
> only for withdrawal requests with `amount > 1000.00` EUR. Requests ≤ 1,000 EUR
> are processed without a verified KYC status.

---

## 2. Database Schema Changes

### 2.1 `profiles` — new columns

```sql
ALTER TABLE public.profiles
  ADD COLUMN earnings_balance NUMERIC(12,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN score_balance    BIGINT        NOT NULL DEFAULT 0;
```

Existing `wallet_balance` is unchanged. Historical winnings already in `wallet_balance` stay there — the split applies only to future game outcomes.

### 2.2 `score_events` — new append-only table

```sql
CREATE TABLE public.score_events (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID        NOT NULL REFERENCES public.profiles(id),
    game_id    UUID        NOT NULL REFERENCES public.games(id),
    points     BIGINT      NOT NULL,
    reason     TEXT        NOT NULL,  -- e.g. 'game_winner', 'survivor', 'top3'
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### 2.3 `transactions.type` — new value

```sql
-- Existing CHECK updated to add 'earnings_transfer'
-- 'topup' | 'withdrawal' | 'game_entry_fee' | 'prize' |
-- 'referral_bonus' | 'refund' | 'admin_adjustment' | 'earnings_transfer'
```

### 2.4 RPCs

| RPC | Description |
|-----|-------------|
| `distribute_prizes(game_id)` | Updated: credits `earnings_balance` (not `wallet_balance`), inserts `score_events` row |
| `transfer_earnings_to_wallet(user_id, amount)` | New: atomic debit earnings + credit wallet + ledger row |

---

## 3. Customer App API

All endpoints require `Authorization: Bearer <access-token>` and return
`401 { "error": "unauthorized" }` if the JWT is missing or invalid (omitted
from the per-endpoint error tables below). Responses are the **raw** JSON object
shown — there is no `data` wrapper (see the envelope note at the top).

| # | Method & path | Purpose |
|---|---------------|---------|
| 3.1 | `GET /profile` | Profile incl. all three balances |
| 3.2 | `GET /wallet/balance` | Three balances only (lightweight) |
| 3.3 | `GET /wallet/transactions` | Paginated money ledger |
| 3.4 | `POST /wallet/transfer` | Earnings → wallet (atomic, INV-15/16) |
| 3.5 | `GET /wallet/score-history` | Paginated score-event ledger |
| 3.6 | `POST /withdrawals/request` | Request a cash-out from earnings |
| 3.7 | `GET /withdrawals/:id` | Single withdrawal status |
| 3.8 | `GET /withdrawals` | Paginated withdrawal history |

---

### 3.1 GET /profile — User profile with all balances

**Response 200** — balances are **decimal strings** (read straight from NUMERIC),
`score_balance` is an integer. `name`/`nationality` are aliases for the
`full_name`/`country` columns.
```json
{
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "name": "Full Name",
    "avatar_url": null,
    "language": "en",
    "kyc_status": "pending",
    "status": "active",
    "wallet_balance": "25.00",
    "earnings_balance": "150.00",
    "score_balance": 4200,
    "referral_code": "ABC123",
    "created_at": "2026-01-01T00:00:00.000Z",
    "nationality": "IR"
  }
}
```

**Logic:** read with the anon (RLS) client; on an RLS-empty result, re-read with
the admin client **scoped to `id = user.id`** (never another user — R-04 spirit);
if still missing, lazy-create the profile row from the JWT, then `404` only if
that fails.

| HTTP | `error` | Meaning |
|------|---------|---------|
| `404` | `profile_not_found` | Profile row missing and lazy-create failed |

---

### 3.2 GET /wallet/balance — All three balances (lightweight)

Cheaper than `GET /profile` for screens that only show balances. Values are
**JSON numbers** here (`Number(...)`-coerced).

**Response 200**
```json
{
  "wallet_balance": 25,
  "earnings_balance": 150,
  "score_balance": 4200,
  "balance": 25,
  "currency": "EUR",
  "formatted": "25.00"
}
```
`balance`/`currency`/`formatted` are **legacy** fields (mirror `wallet_balance`)
kept for older client builds — new clients should use `wallet_balance`.

| HTTP | `error` | Meaning |
|------|---------|---------|
| `404` | `wallet_not_found` | Profile row not found for the JWT subject |

---

### 3.3 GET /wallet/transactions — Money ledger (paginated)

Append-only money history for the authenticated user.

**Query params:** `page` (default 1), `limit` (default 20, **max 100**),
`type` (optional filter; pipe-separated for multiple, e.g.
`type=prize|withdrawal`).

**Response 200** — `amount` is a **decimal string** (from NUMERIC);
`reference_id` is the source row (e.g. the withdrawal id for a `withdrawal` tx).
```json
{
  "transactions": [
    {
      "id": "uuid",
      "type": "earnings_transfer",
      "amount": "50.00",
      "status": "completed",
      "description": "Transfer from earnings to wallet",
      "reference_id": "uuid",
      "created_at": "2026-06-04T12:00:00.000Z"
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 12, "total_pages": 1 }
}
```
`type` ∈ `topup` · `withdrawal` · `game_entry_fee` · `prize` ·
`referral_bonus` · `refund` · `admin_adjustment` · `earnings_transfer`.

| HTTP | `error` | Meaning |
|------|---------|---------|
| `500` | `Failed to fetch transactions` | DB read error |

---

### 3.4 POST /wallet/transfer — Transfer earnings to wallet

Moves money from `earnings_balance` → `wallet_balance` atomically via the
`transfer_earnings_to_wallet` RPC, which also writes a `transactions` row
(`type='earnings_transfer'`). **This is the only way earnings become playable**
(INV-15). Once transferred, the money is play-money and is **no longer
withdrawable** (INV-16 — AML anti-replay).

**Request body** — `amount` accepts a number or a numeric string.
```json
{ "amount": 50 }
```

**Response 200** — balances are **JSON numbers**.
```json
{
  "wallet_balance": 75,
  "earnings_balance": 100,
  "transaction_id": "uuid"
}
```

**Logic:** validate `amount > 0`; call the RPC (runs the debit + credit + ledger
insert in a single DB transaction — R-09); the RPC raises
`insufficient_earnings` / `amount_must_be_positive`, mapped to `400` below.

| HTTP | `error` | Meaning |
|------|---------|---------|
| `400` | `invalid_amount` | Amount missing, zero, negative, or non-numeric |
| `400` | `insufficient_earnings` | `earnings_balance < amount` (raised by RPC) |
| `500` | `transfer_failed` | RPC / DB transaction failed |

---

### 3.5 GET /wallet/score-history — Score event ledger (paginated)

Append-only log of leaderboard-point awards for the authenticated user.

**Query params:** `page` (default 1), `limit` (default 20, **max 50**).

**Response 200**
```json
{
  "score_balance": 4200,
  "events": [
    {
      "id": "uuid",
      "game_id": "uuid",
      "points": 350,
      "reason": "game_winner",
      "created_at": "2026-06-04T12:00:00.000Z"
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 5, "total_pages": 1 }
}
```
`reason` ∈ `game_winner` · `top3` · `prize_winner` · `participant`.

| HTTP | `error` | Meaning |
|------|---------|---------|
| `500` | `Failed to fetch score history` | DB read error |

---

### 3.6 POST /withdrawals/request — Request a cash-out

Debits `earnings_balance` (INV-15 — never `wallet_balance`) and creates a
`pending` withdrawal for finance review. Limits: **min €10, max €10,000**.
KYC (`kyc_status = 'verified'`) is enforced **only** when `amount > €1,000`
(INV-05).

**Request body**
```json
{
  "amount": 200,
  "method": "bank_transfer",
  "account_details": { "iban": "DE89...", "account_holder": "Full Name" }
}
```

**Response 201** — `withdrawal.amount` is a **decimal string**;
`earnings_balance` is a **JSON number**; `kyc_bypassed` is `true` when the
amount was ≤ €1,000 (i.e. processed without a KYC check).
```json
{
  "withdrawal": {
    "id": "uuid",
    "amount": "200.00",
    "status": "pending",
    "requested_at": "2026-06-04T12:00:00.000Z"
  },
  "earnings_balance": 0,
  "kyc_bypassed": true
}
```

**Logic order:** validate amount range → require `method` + `account_details` →
load `kyc_status` + `earnings_balance` → KYC gate (only if `amount > €1,000`) →
sufficient-funds check → insert withdrawal (`pending`) → debit
`earnings_balance` → append a `withdrawal` `transactions` row (`pending`).

| HTTP | `error` | Meaning |
|------|---------|---------|
| `400` | `minimum_withdrawal_10` | Amount missing, non-numeric, or `< €10` |
| `400` | `maximum_withdrawal_10000` | Amount `> €10,000` |
| `400` | `method_and_account_details_required` | `method` or `account_details` missing |
| `400` | `insufficient_earnings` | `earnings_balance < amount` |
| `403` | `kyc_required` | `amount > €1,000` and `kyc_status ≠ 'verified'` |
| `404` | `profile_not_found` | Profile row missing |
| `500` | (sanitized message) | DB error on insert |

---

### 3.7 GET /withdrawals/:withdrawal_id — Single withdrawal status

Returns one withdrawal owned by the caller.

**Response 200**
```json
{
  "withdrawal": {
    "id": "uuid",
    "amount": "200.00",
    "method": "bank_transfer",
    "status": "pending",
    "requested_at": "2026-06-04T12:00:00.000Z",
    "completed_at": null,
    "rejection_reason": null
  }
}
```
`status` ∈ `pending` · `processing` · `completed` · `rejected`. On rejection the
amount is refunded to `earnings_balance` (see §4) and `rejection_reason` is set.

| HTTP | `error` | Meaning |
|------|---------|---------|
| `404` | `withdrawal_not_found` | No withdrawal with that id owned by the caller |

---

### 3.8 GET /withdrawals — Withdrawal history (paginated)

**Query params:** `page` (default 1), `limit` (default 20, **max 100**),
`status` (optional filter; pipe-separated, e.g. `status=pending|processing`).

**Response 200**
```json
{
  "withdrawals": [
    {
      "id": "uuid",
      "amount": "200.00",
      "method": "bank_transfer",
      "status": "completed",
      "requested_at": "2026-06-01T10:00:00.000Z",
      "completed_at": "2026-06-02T09:00:00.000Z",
      "rejection_reason": null
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 3, "total_pages": 1 }
}
```

| HTTP | `error` | Meaning |
|------|---------|---------|
| `500` | `Failed to fetch withdrawals` | DB read error |

---

### 3.9 Customer App — end-to-end logic

The client only ever spends from **wallet**, only ever withdraws from
**earnings**, and treats **score** as read-only leaderboard data:

```
1. Top up           → POST /payments…            → wallet_balance +=
2. Play a game      → entry fee debits wallet     → wallet_balance -=   (R-09 atomic)
3. Win              → distribute_prizes           → earnings_balance += , score_balance +=
4. Cash out winnings:
   a. Withdraw directly        → POST /withdrawals/request   (earnings_balance -=)
   b. OR re-play winnings      → POST /wallet/transfer        (earnings → wallet)
                                 then play (step 2)            ⚠ INV-16: now un-withdrawable
5. Track score      → GET /wallet/score-history   (display only; convertible to money later)
```

**Client display guidance**
- Show all three balances distinctly; never sum wallet + earnings into one number.
- "Withdraw" actions read from **earnings**; "Play / entry-fee" actions read from **wallet**.
- Before a withdrawal of `> €1,000`, surface a KYC prompt if `kyc_status ≠ 'verified'`
  to avoid a `403 kyc_required` round-trip; ≤ €1,000 needs no KYC.
- After a successful `POST /wallet/transfer`, warn that transferred funds are
  play-money and can no longer be withdrawn (INV-16).
- Parse every amount with `Number(value)` — strings on reads, numbers on computed responses.

---

## 4. Prize Distribution — Updated Behaviour

When `distribute_prizes(game_id)` runs at game end:

| Winner tier | Money | Score |
|-------------|-------|-------|
| 1st place | `earnings_balance += prize_breakdown[0]` | `score_balance += final_score` |
| 2nd place | `earnings_balance += prize_breakdown[1]` | `score_balance += final_score` |
| … | … | … |
| All survivors | No money | `score_balance += final_score` |

Each award:
- Inserts a `transactions` row `(type='prize', status='completed')` for money
- Inserts a `score_events` row for points
- Stamps `game_participants.prize_earned` (money amount, unchanged column)

---

## 5. Admin Panel — Coverage & Gaps

### 5.1 Currently covered ✅
| Feature | Admin page |
|---------|-----------|
| Withdrawal list & approve/reject/complete | `/finance/withdrawals` |
| Transaction ledger | `/finance/transactions` |
| Payment list & detail | `/finance/payments` |
| AML flag review | `/finance/aml` |
| User wallet adjustment | `/users/:id` → Adjust Wallet button |
| User game history & prizes earned | `/users/:id` |

### 5.2 Admin panel — implemented ✅

| Item | Where | Status |
|------|-------|--------|
| `earnings_balance` shown on user detail page | `/users/:id` → "Earnings balance" stat card | ✅ |
| `score_balance` shown on user detail page | `/users/:id` → "Score balance" stat card | ✅ |
| Balance adjustment can target `wallet` or `earnings` | `/users/:id` → Adjust balance dialog (Target selector) | ✅ |
| `score_events` viewable | `/users/:id` → Score history table | ✅ |
| Withdrawal source labelled | `/finance/withdrawals/:id` → "Source: Earnings" badge | ✅ |
| `earnings_transfer` transaction type labelled | Renders via `t.type.replace(/_/g, " ")` | ✅ |
| KYC threshold visible | `/finance/withdrawals/:id` → "KYC not required (≤ €1,000)" note when applicable | ✅ |
| Rejected withdrawal refunds to `earnings_balance` | `rejectWithdrawal` action | ✅ |

---

## 6. Migration & Deployment Notes

All schema changes are applied exclusively via the `db-maintainer` container (R-12):

```bash
docker compose up -d --force-recreate db-maintainer
```

Migration file: `supabase/migrations/20260607000000_three_bucket_financial_model.sql` *(committed — apply via `db-maintainer`)*

**Backward compatibility:** existing `wallet_balance` data is untouched. New columns default to `0.00` / `0`. No data migration required — the split applies only to future game outcomes.
