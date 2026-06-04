# Crypto Withdrawals API Reference

**Base URL:** `https://api.quiz4win.com`
**Auth:** All endpoints require `Authorization: Bearer <user-jwt>` + `apikey: <supabase-anon-key>`
**Response envelope:** Raw JSON — no `data` wrapper.

---

## Withdrawal Flow Overview

Submitting a crypto withdrawal is a **two-step process**:

```
1. POST /withdrawals/request
      └─► status: awaiting_confirmation
          OTP emailed to user (valid 10 min)
          ⚠ earnings_balance NOT debited yet

2. POST /withdrawals/:id/confirm   { "code": "123456" }
      └─► OTP verified
          earnings_balance debited
          status: pending  (enters finance review queue)

3. Admin processes payout
      └─► status: processing → completed  (TX hash recorded)
                             → rejected   (earnings refunded)
```

If the code expires, the user can request a fresh one via `POST /withdrawals/:id/resend-otp`.

---

## Supported Coins & Networks

| Coin | Networks |
|------|----------|
| `USDT` | `TRC20`, `ERC20`, `BEP20`, `SOL`, `MATIC` |
| `USDC` | `ERC20`, `SOL`, `MATIC`, `BEP20` |

Retrieve this list dynamically at runtime:

```
GET /withdrawals/supported-crypto
```

**Response `200`:**
```json
{
  "coins": ["USDT", "USDC"],
  "networks": {
    "USDT": ["TRC20", "ERC20", "BEP20", "SOL", "MATIC"],
    "USDC": ["ERC20", "SOL", "MATIC", "BEP20"]
  }
}
```

---

## 1. Submit a Crypto Withdrawal Request

```
POST /withdrawals/request
```

Validates the request, creates a withdrawal record in `awaiting_confirmation` status, and emails a 6-digit OTP to the user. **The balance is not debited at this stage.**

**Request body:**
```json
{
  "amount": 50.00,
  "method": "crypto",
  "account_details": {
    "coin": "USDT",
    "network": "TRC20",
    "address": "TFZkADUw9F4B4hLikd8R7bAN2U7Va4vp4L"
  }
}
```

| Field | Type | Rules |
|-------|------|-------|
| `amount` | number | Min €10, max €10,000 |
| `method` | string | `"crypto"` \| `"bank_transfer"` \| `"paypal"` |
| `account_details.coin` | string | `USDT` or `USDC` (case-insensitive) |
| `account_details.network` | string | Must be valid for the chosen coin |
| `account_details.address` | string | 10–200 characters |

**Response `201`:**
```json
{
  "withdrawal": {
    "id": "uuid",
    "amount": 50.00,
    "method": "crypto",
    "status": "awaiting_confirmation",
    "requested_at": "2026-06-04T10:00:00Z",
    "crypto_coin": "USDT",
    "crypto_network": "TRC20"
  },
  "requires_confirmation": true,
  "confirmation_expires_at": "2026-06-04T10:10:00Z",
  "earnings_balance": 200.00,
  "kyc_bypassed": true
}
```

| Response field | Description |
|----------------|-------------|
| `requires_confirmation` | Always `true` — user must call `/confirm` before the request enters review |
| `confirmation_expires_at` | ISO timestamp — the OTP code is invalid after this time |
| `earnings_balance` | Pre-debit balance (the amount is **not yet subtracted**) |
| `kyc_bypassed` | `true` when `amount ≤ €1,000` — KYC required only above this threshold (INV-05) |

---

## 2. Confirm the Withdrawal (OTP Verification)

```
POST /withdrawals/:id/confirm
```

Verifies the emailed OTP. On success: debits `earnings_balance`, moves status to `pending`, and enters the finance review queue.

**Request body:**
```json
{
  "code": "123456"
}
```

**Response `200`:**
```json
{
  "withdrawal": {
    "id": "uuid",
    "amount": 50.00,
    "method": "crypto",
    "status": "pending",
    "requested_at": "2026-06-04T10:00:00Z",
    "confirmed_at": "2026-06-04T10:03:22Z",
    "crypto_coin": "USDT",
    "crypto_network": "TRC20"
  },
  "earnings_balance": 150.00
}
```

> **Note:** After confirmation `earnings_balance` reflects the debited balance.

**Attempt limits:** Up to **5 wrong codes** are allowed. After 5 failures the code is locked — the user must resend a new OTP.

---

## 3. Resend OTP

```
POST /withdrawals/:id/resend-otp
```

Generates and emails a new 6-digit code, resetting the attempt counter. Only valid while status is `awaiting_confirmation`.

**Request body:** *(empty)*

**Response `200`:**
```json
{
  "message": "Code sent",
  "confirmation_expires_at": "2026-06-04T10:20:00Z"
}
```

---

## 4. Get Withdrawal Status

```
GET /withdrawals/:withdrawal_id
```

**Response `200`:**
```json
{
  "withdrawal": {
    "id": "uuid",
    "amount": 50.00,
    "method": "crypto",
    "status": "completed",
    "requested_at": "2026-06-04T10:00:00Z",
    "confirmed_at": "2026-06-04T10:03:22Z",
    "completed_at": "2026-06-04T12:30:00Z",
    "confirmation_expires_at": null,
    "rejection_reason": null,
    "transaction_reference": "a1b2c3...tx_hash",
    "crypto_coin": "USDT",
    "crypto_network": "TRC20",
    "crypto_address": "TFZkADUw9F4B4hLikd8R7bAN2U7Va4vp4L",
    "account_details": { "coin": "USDT", "network": "TRC20", "address": "TFZk..." }
  }
}
```

`transaction_reference` holds the blockchain TX hash once the admin marks the withdrawal completed.
`confirmation_expires_at` is non-null only while status is `awaiting_confirmation`.

---

## 5. List My Withdrawals

```
GET /withdrawals
```

**Query parameters:**

| Param | Type | Description |
|-------|------|-------------|
| `page` | integer | Page number (default: `1`) |
| `limit` | integer | Results per page (max `100`, default: `20`) |
| `status` | string | Filter: `awaiting_confirmation`, `pending`, `processing`, `completed`, `rejected` |
| `method` | string | Filter: `crypto`, `bank_transfer`, `paypal` |

**Response `200`:**
```json
{
  "withdrawals": [
    {
      "id": "uuid",
      "amount": 50.00,
      "method": "crypto",
      "status": "awaiting_confirmation",
      "requested_at": "2026-06-04T10:00:00Z",
      "confirmed_at": null,
      "completed_at": null,
      "rejection_reason": null,
      "transaction_reference": null,
      "crypto_coin": "USDT",
      "crypto_network": "TRC20",
      "crypto_address": "TFZkADUw9F4B4hLikd8R7bAN2U7Va4vp4L"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 3,
    "total_pages": 1
  }
}
```

---

## Withdrawal Lifecycle

```
                    ┌─ awaiting_confirmation ─┐
                    │   (OTP emailed; no debit)│
POST /request ──────┘                          │
                                               │ POST /confirm (OTP valid)
                                               ▼
                    pending ──► processing ──► completed
                                         ↘
                                          rejected  (earnings_balance refunded)
```

| Status | Who sets it | Meaning |
|--------|-------------|---------|
| `awaiting_confirmation` | System | Created; waiting for user's OTP confirmation |
| `pending` | System (on confirm) | Confirmed; in finance review queue |
| `processing` | Admin | Payout approved and being executed |
| `completed` | Admin | TX hash recorded; funds sent on-chain |
| `rejected` | Admin | Denied; full amount returned to `earnings_balance` |

---

## Error Codes

### Submission (`POST /withdrawals/request`)

| Status | Error | Description |
|--------|-------|-------------|
| `400` | `minimum_withdrawal_10` | Amount is below €10 |
| `400` | `maximum_withdrawal_10000` | Amount exceeds €10,000 |
| `400` | `method_and_account_details_required` | Missing `method` or `account_details` |
| `400` | `unsupported_method:…` | Invalid method value |
| `400` | `unsupported_coin:…_supported:USDT\|USDC` | Unknown coin |
| `400` | `unsupported_network:…_supported:…` | Network not valid for that coin |
| `400` | `invalid_crypto_address` | Address missing or wrong length (10–200 chars) |
| `400` | `insufficient_earnings` | `earnings_balance` is too low |
| `400` | `account_missing_email` | User account has no email address on file |
| `401` | `unauthorized` | JWT missing or expired |
| `403` | `kyc_required` | Amount > €1,000 and KYC not verified |
| `404` | `profile_not_found` | User profile not found |

### Confirmation (`POST /withdrawals/:id/confirm`)

| Status | Error | Description |
|--------|-------|-------------|
| `400` | `code_required` | `code` field missing from request body |
| `400` | `code_expired` | OTP code has expired (>10 min since issued) |
| `400` | `code_invalid` | Wrong code; attempt counter incremented |
| `400` | `insufficient_earnings` | Balance changed since request; now insufficient |
| `400` | `code_not_requested` | No active OTP exists for this withdrawal |
| `404` | `withdrawal_not_found` | ID not found or not owned by caller |
| `409` | `withdrawal_not_awaiting_confirmation` | Already confirmed or in another terminal state |
| `409` | `confirmation_failed` | Concurrent confirm race — retry once |
| `429` | `code_locked` | 5 wrong attempts; use resend-otp to get a new code |

### Resend OTP (`POST /withdrawals/:id/resend-otp`)

| Status | Error | Description |
|--------|-------|-------------|
| `400` | `account_missing_email` | User account has no email address |
| `404` | `withdrawal_not_found` | ID not found or not owned by caller |
| `409` | `withdrawal_not_awaiting_confirmation` | Cannot resend for a confirmed or closed withdrawal |

### Status / List

| Status | Error | Description |
|--------|-------|-------------|
| `401` | `unauthorized` | JWT missing or expired |
| `404` | `withdrawal_not_found` | ID not found or not owned by caller |

---

## Integration Checklist

1. **Fetch supported coins/networks** on app load via `GET /withdrawals/supported-crypto` — do not hard-code the list.
2. **Show earnings balance** as the source (not wallet balance). Fetch from `GET /profile` (`earnings_balance` field) or `GET /wallet/balance`.
3. **KYC gate**: show a KYC prompt only when `amount > 1000`. Do not block ≤ €1,000 withdrawals.
4. **OTP confirmation screen**: after `POST /withdrawals/request` returns `requires_confirmation: true`, navigate to a screen where the user enters the emailed code. Display a countdown based on `confirmation_expires_at`.
5. **Resend button**: show a "Resend code" button after 60 s inactivity, or when the countdown reaches zero. Call `POST /withdrawals/:id/resend-otp` and refresh the new expiry.
6. **Handle `code_locked` (429)**: display "Too many attempts — a new code has been sent" and trigger `resend-otp` automatically.
7. **Poll for status** using `GET /withdrawals/:id` every 30 s while status is `pending` or `processing`.
8. **Display TX hash** (`transaction_reference`) to the user once status is `completed`.
9. **Rejection refund**: inform the user that a rejected withdrawal automatically returns funds to their earnings balance — no manual action required.
