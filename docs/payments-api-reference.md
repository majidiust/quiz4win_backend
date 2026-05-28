# Payments API — Reference

**Base URL:** `https://api.quiz4win.com`
**Authentication:** Required for initiate/status (`Authorization: Bearer <user_jwt>`). No auth for verify (internal use).
**Monetary Units:** All `*_cents` fields are **integer cents** (e.g. `500` = $5.00) per R-02.

---

## Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/payments` | JWT | Initiate a top-up payment |
| `GET` | `/payments/:id` | JWT | Get payment status |
| `POST` | `/payments/:id/verify` | None | Verify with gateway and credit wallet |

---

## POST /payments

Initiates a top-up payment.

### Request Body (JSON)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `method` | string | ✅ | `mastercard`, `apple`, `crypto` |
| `amount_cents` | integer | ✅ | Amount in cents (must be > 0) |
| `currency` | string | — | ISO-4217 code (default `EUR`) |
| `productName` | string | — | Display name for the gateway (default `Wallet Top-up`) |
| `desc` | string | — | Description (default `Top-up for <email>`) |
| `extData` | object | — | Arbitrary metadata |

### Success Response — `201 Created`

```json
{
  "payment_id": "uuid",
  "redirect_url": "https://buy.stripe.com/..."
}
```

### Error Responses

| HTTP | `error` | Meaning |
|------|---------|---------|
| `400` | `invalid_method` | Unsupported payment method |
| `400` | `invalid_amount` | Amount missing or invalid |
| `401` | `unauthorized` | Missing or invalid JWT |
| `501` | `apple_not_implemented` | Method not yet supported |
| `502` | `gateway_error` | External gateway rejected the request |
| `503` | `payment_gateway_not_configured` | Missing gateway credentials in env |

---

## GET /payments/:id

Check the status of a payment.

### Success Response — `200 OK`

```json
{
  "id": "uuid",
  "status": "pending",
  "amount_cents": 500,
  "currency": "EUR",
  "method": "mastercard",
  "transaction_id": null,
  "completed_at": null
}
```

### Payment Statuses

| Status | Meaning |
|--------|---------|
| `init` | Initialized |
| `pending` | Payment link generated, awaiting user action |
| `succeeded` | Verified and wallet credited |
| `failed` | Payment failed at gateway |
| `cancelled` | User cancelled |
| `expired` | Payment link expired |

---

## POST /payments/:id/verify

Internal endpoint called by the `/pay/return` landing page. Verifies the status with the external gateway and atomically credits the user's wallet if successful.

### Success Response — `200 OK`

```json
{
  "status": "succeeded",
  "transaction_id": "uuid"
}
```

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `REMITATION_ACCESS_KEY` | ✅ | Remitation API Access Key |
| `REMITATION_SECRET_KEY` | ✅ | Remitation API Secret Key |
| `REMITATION_BASE_URL` | — | Defaults to Remitation production gateway |
| `APP_URL` | ✅ | Base URL of the app container (for redirect URL) |

---

## Static Redirect Page

The gateway redirects the user to:  
`https://app.quiz4win.com/pay/return?id=<local_payment_id>`

This page:
1. Calls `/payments/:id/verify`.
2. Shows success/failure UI.
3. Deep-links back to the app: `quiz4win://payment/return?id=<id>&status=<status>`.
