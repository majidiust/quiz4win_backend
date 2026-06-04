# Quiz4Win — Financial Model & API Reference

**Base URL:** `https://api.quiz4win.com`  
**Auth:** `Authorization: Bearer <access-token>` on every endpoint.  
**Content-Type:** `application/json`  
**Amounts:** All money values are `NUMERIC(12,2)` decimal strings (e.g. `"12.50"`). Score values are integers.

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

## 3. API Endpoints

### 3.1 GET /profile — User profile with all balances

**Auth:** JWT required.

**Response 200**
```json
{
  "data": {
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
}
```

**Errors**

| HTTP | `error` | Meaning |
|------|---------|---------|
| `401` | `unauthorized` | Missing or invalid JWT |
| `404` | `profile_not_found` | Profile row missing and lazy-create failed |

---

### 3.2 POST /wallet/transfer — Transfer earnings to wallet

Moves money from `earnings_balance` → `wallet_balance` atomically. Inserts a `transactions` row (`type='earnings_transfer'`).

**Auth:** JWT required.

**Request body**
```json
{ "amount": "50.00" }
```

**Response 200**
```json
{
  "data": {
    "wallet_balance": "75.00",
    "earnings_balance": "100.00",
    "transaction_id": "uuid"
  }
}
```

**Errors**

| HTTP | `error` | Meaning |
|------|---------|---------|
| `400` | `invalid_amount` | Amount missing, zero, negative, or non-numeric |
| `400` | `insufficient_earnings` | `earnings_balance < amount` |
| `401` | `unauthorized` | Missing or invalid JWT |
| `500` | `transfer_failed` | DB transaction failed |

---

### 3.3 POST /wallet/withdraw — Request a withdrawal

Debits `earnings_balance`. For amounts > 1,000 EUR, requires `kyc_status = 'verified'`.

**Auth:** JWT required.

**Request body**
```json
{
  "amount": "200.00",
  "method": "bank_transfer",
  "account_details": {
    "iban": "DE89...",
    "account_holder": "Full Name"
  }
}
```

**Response 201**
```json
{
  "data": {
    "withdrawal_id": "uuid",
    "status": "pending",
    "amount": "200.00",
    "earnings_balance": "0.00"
  }
}
```

**Errors**

| HTTP | `error` | Meaning |
|------|---------|---------|
| `400` | `invalid_amount` | Amount missing, zero, or negative |
| `400` | `invalid_method` | Unknown withdrawal method |
| `400` | `insufficient_earnings` | `earnings_balance < amount` |
| `403` | `kyc_required` | Amount > 1,000 EUR and `kyc_status ≠ 'verified'` |
| `401` | `unauthorized` | Missing or invalid JWT |
| `500` | `withdrawal_failed` | DB error |

---

### 3.4 GET /wallet/score-history — Score event ledger

Returns the append-only log of score awards for the authenticated user.

**Auth:** JWT required.  
**Query params:** `page` (default 1), `limit` (default 20, max 50).

**Response 200**
```json
{
  "data": {
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
}
```

**Errors**

| HTTP | `error` | Meaning |
|------|---------|---------|
| `401` | `unauthorized` | Missing or invalid JWT |

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

### 5.2 Gaps — not yet in admin panel ⚠️

| Gap | Impact | Recommended addition |
|-----|--------|---------------------|
| `earnings_balance` not shown on user detail page | Finance team cannot see earnings | Add stat card beside Wallet balance |
| `score_balance` not shown on user detail page | Support cannot answer leaderboard queries | Add stat card |
| Wallet adjustment only targets `wallet_balance` | No way to correct earnings balance | Add "target" selector (wallet / earnings) to Adjust Wallet dialog |
| `score_events` not viewable | No audit trail for score awards | Add Score History tab on user detail page |
| Withdrawal list shows no balance source label | Unclear that withdrawal debits earnings, not wallet | Add "Source: Earnings" badge on withdrawal rows |
| `earnings_transfer` transaction type not labelled | Shows as raw string in Recent Transactions | Already renders via `t.type.replace(/_/g, " ")` — works automatically ✅ |
| KYC threshold not visible | Finance team cannot tell why a withdrawal was allowed without KYC | Add "KYC bypassed (≤ €1,000)" note on withdrawal detail |

---

## 6. Migration & Deployment Notes

All schema changes are applied exclusively via the `db-maintainer` container (R-12):

```bash
docker compose up -d --force-recreate db-maintainer
```

Migration file: `supabase/migrations/20260607000000_three_bucket_financial_model.sql` *(to be created)*

**Backward compatibility:** existing `wallet_balance` data is untouched. New columns default to `0.00` / `0`. No data migration required — the split applies only to future game outcomes.
