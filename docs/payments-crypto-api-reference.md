# Quiz4Win — Crypto Payment API Reference

**Base URL:** `https://api.quiz4win.com`  
**Auth:** `Authorization: Bearer <user-jwt>` + `apikey: <supabase-anon-key>` on every request.  
**Content-Type:** `application/json`  
**Gateway:** Remitation (`https://api.merchant.remitation.com/api/plugin`)

> **Response envelope:** All edge functions return the **raw JSON object** — there is **no** top-level `data` wrapper.
> Access fields directly: `response.payment_id`, `response.crypto.address`, etc.

---

## Endpoints

| # | Method & Path | Auth | Purpose |
|---|---------------|------|---------|
| 1 | `POST /payments` | JWT | Initiate a crypto payment |
| 2 | `GET /payments/:id` | JWT | Poll payment status |
| 3 | `POST /payments/:id/verify` | None | Force re-query gateway + credit wallet |
| 4 | `POST /payments/webhook/crypto` | None | Remitation settlement callback (server→server) |

---

## 1. POST /payments — Initiate a Crypto Payment

**Request**
```json
{
  "method": "crypto",
  "amount_cents": 3000,
  "currency": "USD",
  "crypto": "USDTTRC20"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `method` | string | YES | Must be `"crypto"` |
| `amount_cents` | integer | YES | Amount in cents — must be > 0 (e.g. 3000 = $30.00) |
| `currency` | string | no | ISO-4217 fiat code. Default `"USD"` |
| `crypto` | string | no | Coin identifier. Default `"USDTTRC20"` |

**Response `201`** — raw object, no `data` wrapper.
```json
{
  "payment_id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  "method": "crypto",
  "redirect_url": "https://app.quiz4win.com/pay/return?id=3fa85f64-...",
  "crypto": {
    "address":       "TFZkADUw9F4B4hLikd8R7bAN2U7Va4vp4L",
    "amount":        "29.997164",
    "currency":      "usdttrc20",
    "network":       "trx",
    "qr_url":        "https://api.qrserver.com/v1/create-qr-code/?data=TFZk...",
    "expires_at":    "2026-06-04T12:30:00.000Z",
    "fiat_amount":   30,
    "fiat_currency": "usd"
  }
}
```

**Client action:** Display `crypto.address` and `crypto.qr_url` to the user. The user sends exactly `crypto.amount` of `crypto.currency` from their external wallet before `crypto.expires_at`.

---

## 2. GET /payments/:payment_id — Poll Payment Status

Poll every **10–15 seconds** while the user is on the payment screen.

**Response `200`**
```json
{
  "id":          "3fa85f64-...",
  "status":      "pending",
  "amount_cents": 3000,
  "currency":    "USD",
  "method":      "crypto",
  "pay_address": "TFZkADUw9F4B4hLikd8R7bAN2U7Va4vp4L",
  "pay_amount":  "29.997164",
  "pay_currency":"usdttrc20",
  "expires_at":  "2026-06-04T12:30:00.000Z",
  "created_at":  "2026-06-04T12:00:00.000Z"
}
```

`status` ∈ `pending` · `succeeded` · `failed` · `expired` · `cancelled`

**Client action:** When `status === "succeeded"` → credit confirmed, navigate to success screen.

---

## 3. POST /payments/:payment_id/verify — Force Verify (No Auth)

Triggers a live re-query to Remitation. Use if the webhook was missed and `GET /payments/:id` still shows `pending`.

**Response:** same shape as `GET /payments/:id`, with updated `status`.

---

## 4. POST /payments/webhook/crypto — Settlement Callback

Called automatically by Remitation when the on-chain transaction confirms. **Do not call this from the client.** On success, the user's `wallet_balance` is credited atomically.

---

## Error Codes

| HTTP | `error` | Meaning |
|------|---------|---------|
| `400` | `invalid_method` | `method` is not `"crypto"`, `"mastercard"`, or `"apple"` |
| `400` | `invalid_amount` | `amount_cents` missing, zero, negative, or non-integer |
| `401` | `unauthorized` | JWT missing or expired |
| `404` | `not_found` | Payment ID does not exist or belongs to another user |
| `502` | `gateway_error` | Remitation returned an error or unexpected response |
| `503` | `crypto_gateway_not_configured` | `REMITATION_ACCESS_KEY` / `REMITATION_SECRET_KEY` not set in server env |

---

## Integration Checklist

- **No `data` wrapper** — read `response.payment_id`, `response.crypto.address` directly.
- **Parse amounts defensively** — `crypto.amount` is a string from the gateway; always `Number(response.crypto.amount)` for display.
- **Do not hardcode the address** — always re-read it from `GET /payments/:id` if the user navigates away.
- **Respect `expires_at`** — show a countdown; if expired, prompt the user to start a new payment.
- **Poll, don't hang** — maximum 15-minute window before an address expires; stop polling on `succeeded`, `failed`, or `expired`.
- **Webhook is the primary** settlement path; polling is a fallback for missed webhooks.
