# Quiz4Win — Payments API Reference

**Base URL:** `https://api.quiz4win.com`
**Auth:** `Authorization: Bearer <user_jwt>` on every endpoint except `/payments/:id/verify`.
**Content-Type:** `application/json`
**Amounts:** All `amount_cents` values are **integer cents** — e.g. `3000` = $30.00.

---

## Endpoint overview

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET`  | `/payments` | JWT | List all payments (unified across all methods) |
| `POST` | `/payments` | JWT | Initiate a new payment |
| `GET`  | `/payments/:id` | JWT | Get a single payment — status and full details |
| `POST` | `/payments/:id/verify` | None | Re-query gateway, credit wallet if paid |

---

## Payment object (unified shape)

Every endpoint that returns payments uses this unified shape, regardless of method.

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Local payment ID |
| `method` | string | `mastercard`, `crypto`, `apple` |
| `status` | string | See status table below |
| `amount_cents` | integer | Amount in cents |
| `currency` | string | ISO-4217 fiat code |
| `payment_link` | string / null | MasterCard: URL to open in browser / WebView |
| `pay_address` | string / null | Crypto: wallet address to send funds to |
| `pay_amount` | number / null | Crypto: exact coin amount to send |
| `pay_currency` | string / null | Crypto: coin identifier e.g. `usdttrc20` |
| `qr_url` | string / null | Crypto: ready-to-display QR code image URL |
| `expires_at` | ISO-8601 / null | Crypto: when the payment window closes |
| `transaction_id` | UUID / null | Set after wallet is credited |
| `initiated_at` | ISO-8601 / null | When payment was created with the gateway |
| `completed_at` | ISO-8601 / null | When wallet was credited |
| `created_at` | ISO-8601 | Record creation time |

### Status values

| Status | Meaning |
|--------|---------|
| `pending` | Awaiting user action or crypto transfer |
| `succeeded` | Confirmed — wallet has been credited |
| `failed` | Gateway reported failure |
| `cancelled` | User or gateway cancelled |
| `expired` | Payment window closed before funds received |

---

## GET /payments — List payments

Returns all payments for the authenticated user, newest first, unified across all methods.

### Query parameters

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `page` | integer | `1` | Page number |
| `limit` | integer | `20` | Results per page (max `50`) |
| `status` | string | — | Filter: `pending`, `succeeded`, `failed`, `cancelled`, `expired` |
| `method` | string | — | Filter: `mastercard`, `crypto`, `apple` |

### Request

```http
GET /payments?page=1&limit=20
Authorization: Bearer <user_jwt>
```

### Response `200`

```json
{
  "data": {
    "payments": [
      {
        "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
        "method": "crypto",
        "status": "succeeded",
        "amount_cents": 3000,
        "currency": "USD",
        "pay_address": "TFZkADUw9F4B4hLikd8R7bAN2U7Va4vp4L",
        "pay_amount": 29.997164,
        "pay_currency": "usdttrc20",
        "qr_url": "https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=TFZk...",
        "expires_at": "2026-05-29T23:42:38.105Z",
        "payment_link": null,
        "transaction_id": "a1b2c3d4-...",
        "initiated_at": "2026-05-29T23:22:38.105Z",
        "completed_at": "2026-05-29T23:38:00.000Z",
        "created_at": "2026-05-29T23:22:38.105Z"
      },
      {
        "id": "8cde1234-...",
        "method": "mastercard",
        "status": "succeeded",
        "amount_cents": 1000,
        "currency": "EUR",
        "payment_link": "https://buy.stripe.com/...",
        "pay_address": null,
        "pay_amount": null,
        "pay_currency": null,
        "qr_url": null,
        "expires_at": null,
        "transaction_id": "b2c3d4e5-...",
        "initiated_at": "2026-05-28T10:00:00.000Z",
        "completed_at": "2026-05-28T10:03:45.000Z",
        "created_at": "2026-05-28T10:00:00.000Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 2,
      "total_pages": 1
    }
  }
}
```

---

## POST /payments — Initiate payment

### MasterCard

```http
POST /payments
Authorization: Bearer <user_jwt>
Content-Type: application/json
```

```json
{
  "method": "mastercard",
  "amount_cents": 3000,
  "currency": "EUR"
}
```

**Response `201`**

```json
{
  "data": {
    "payment_id": "3fa85f64-...",
    "method": "mastercard",
    "redirect_url": "https://buy.stripe.com/..."
  }
}
```

Open `redirect_url` in a WebView or the system browser. The gateway redirects the user back to `https://app.quiz4win.com/pay/return?id=<payment_id>` on completion — the web page verifies the payment and deep-links back to the app.

---

### Crypto

```http
POST /payments
Authorization: Bearer <user_jwt>
Content-Type: application/json
```

```json
{
  "method": "crypto",
  "amount_cents": 3000,
  "currency": "USD",
  "crypto": "USDTTRC20"
}
```

**Response `201`**

```json
{
  "data": {
    "payment_id": "3fa85f64-...",
    "method": "crypto",
    "redirect_url": "https://app.quiz4win.com/pay/return?id=3fa85f64-...",
    "crypto": {
      "address": "TFZkADUw9F4B4hLikd8R7bAN2U7Va4vp4L",
      "amount": 29.997164,
      "currency": "usdttrc20",
      "network": "trx",
      "qr_url": "https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=TFZk...",
      "expires_at": "2026-05-29T23:42:38.105Z",
      "fiat_amount": 30,
      "fiat_currency": "usd"
    }
  }
}
```

Display `crypto.address` and `crypto.qr_url` directly in the app. Poll `GET /payments/:id` every 10–15 s until `status` becomes `succeeded` or `failed`.

---

### Request fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `method` | string | YES | `mastercard` or `crypto` |
| `amount_cents` | integer | YES | Amount in cents — must be > 0 |
| `currency` | string | no | ISO-4217 fiat code. Default `EUR` (MasterCard) / `USD` (Crypto) |
| `crypto` | string | Crypto only | Coin identifier e.g. `USDTTRC20` |
| `productName` | string | no | Label shown on the gateway checkout page |
| `desc` | string | no | Payment description |

### Error responses (POST /payments)

| HTTP | `error` | Meaning |
|------|---------|---------|
| `400` | `invalid_method` | Unknown or unsupported method value |
| `400` | `invalid_amount` | `amount_cents` missing, zero, or negative |
| `401` | `unauthorized` | Missing or invalid JWT |
| `501` | `apple_not_implemented` | Apple Pay not yet live |
| `502` | `gateway_error` | Remitation rejected the request |
| `503` | `payment_gateway_not_configured` | Server is missing API keys |

---

## GET /payments/:id — Payment detail

```http
GET /payments/3fa85f64-5717-4562-b3fc-2c963f66afa6
Authorization: Bearer <user_jwt>
```

Returns the full unified Payment object. Scoped to the authenticated user — returns `404` if the ID belongs to another user.

**Response `200`** — see [Payment object](#payment-object-unified-shape) above.

Use this to **poll for crypto payment status** (recommended: every 10–15 s while `status === "pending"`).

---

## POST /payments/:id/verify — Verify and credit wallet

Called automatically by the `https://app.quiz4win.com/pay/return` web page after a MasterCard gateway redirect. **The mobile app does not call this directly.**

After the page verifies the payment it deep-links back to the app:

```
quiz4win://payment/return?id=<payment_id>&status=<succeeded|failed|pending>
```

Handle this deep-link to close the WebView, show the result screen, and refresh the wallet balance.

**Response `200`**

```json
{
  "data": {
    "status": "succeeded",
    "transaction_id": "a1b2c3d4-..."
  }
}
```

---

## Full flows

### MasterCard

```
1. App  →  POST /payments  { method: "mastercard", amount_cents: 3000, currency: "EUR" }
           ← 201 { payment_id, redirect_url }

2. App  →  Open redirect_url in WebView / system browser
           User fills in card details on Stripe/Remitation page
           Gateway → Redirects to https://app.quiz4win.com/pay/return?id=<payment_id>
           Web page → POST /payments/:id/verify  (automatic, no app involvement)
           Web page → Wallet credited atomically

3. Web  →  Deep-link  quiz4win://payment/return?id=...&status=succeeded

4. App  →  Handle deep-link → close WebView → show success → call GET /payments/:id
           to refresh and display the final status
```

### Crypto

```
1. App  →  POST /payments  { method: "crypto", amount_cents: 3000, crypto: "USDTTRC20" }
           ← 201 { payment_id, crypto: { address, qr_url, amount, expires_at, ... } }

2. App  →  Show crypto.address + crypto.qr_url to the user
           User sends exact crypto.amount from their external wallet

3. App  →  Poll GET /payments/:id every 10-15 s

4a. status === "succeeded"  →  wallet credited → show success → refresh balance
4b. status === "failed" / "expired"  →  show error → allow retry
```

---

## Common errors

```json
{ "error": "<error_code>" }
```

| HTTP | `error` | Meaning |
|------|---------|---------|
| `401` | `unauthorized` | Missing or expired JWT |
| `404` | `payment_not_found` | ID does not exist or belongs to another user |
| `500` | `internal_server_error` | Unexpected server error |
| `502` | `gateway_error` | Remitation unreachable or rejected the request |
| `502` | `gateway_verification_failed` | Could not verify status with gateway |

