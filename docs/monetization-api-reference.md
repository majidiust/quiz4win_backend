# Monetization Mode — Frontend Integration & Store-Compliance Guide

**Audience:** iOS, Android, and web client developers.
**Base URL:** `https://api.quiz4win.com`
**Status:** Required reading before building any wallet, earnings, or withdrawal screen.

> ⚠️ **This is a store-review-critical feature.** The monetization mode determines
> whether the app exposes real-money cash-out. Getting the UI wrong can cause an
> **App Store / Google Play rejection** or a policy takedown. Read §6 (Compliance)
> in full and implement the gating exactly as described.

---

## 1. What this feature is

The backend has a single, admin-controlled, **server-driven** switch called
`monetization_mode`. It has three states. The client **must not hardcode** any
mode — it reads the current mode from `GET /config/app` on every cold start and
adapts its UI accordingly.

| Mode | Cash-out (withdrawals) | What the user sees | Primary use |
|------|------------------------|--------------------|-------------|
| `none` | **Blocked** (`403`) | No withdraw button, no balances framed as money | App-review builds & restricted regions — no real-world monetary value |
| `coin` | Allowed, **entered/shown in coins** | A branded virtual currency (e.g. "Coins / C") | Soft monetization / regions where coins are presented instead of fiat |
| `usd`  | Allowed, in USD | Real money (USD) | Default — fully enabled real-money operation |

**Architectural note (important for the client):** the server ledger is *always*
stored in canonical USD. `coin` mode is a **presentation + policy layer only** —
it changes how amounts are entered and displayed and applies an FX rate; it never
re-denominates the stored balance. This means your conversion math must match the
server's (see §5) so the number the user sees equals the number the server charges.

---

## 2. The contract: `GET /config/app`

**Auth:** none. **Call timing:** on every app launch / resume; cache for the session.

### Response — all modes

```json
{
  "config": {
    "monetization_mode": "usd",
    "maintenance_mode": false,
    "feature_host_applications": true,
    "livekit_server_url": "wss://quiz4win-xxx.livekit.cloud"
  }
}
```

`monetization_mode` is **always present** (defaults to `"usd"` if the server cannot
read its config). Treat any unknown/missing value as `"usd"` is **NOT** correct for
safety — see the defensive rule in §4.

### Response — `coin` mode only

When (and only when) the mode is `coin`, a nested `coin` object is added:

```json
{
  "config": {
    "monetization_mode": "coin",
    "coin": {
      "name": "Coins",
      "symbol": "C",
      "usd_rate_micros": 10000,
      "usd_rate": "0.010000"
    }
  }
}
```

| Field | Type | Meaning |
|-------|------|---------|
| `name` | string | Display name of the currency (plural label), e.g. `"Coins"`. |
| `symbol` | string | Short symbol/prefix, e.g. `"C"`. Use for compact display (`C 1,500`). |
| `usd_rate_micros` | integer | **Micro-USD per 1 coin.** `1 USD = 1,000,000 micros`. This is the authoritative rate — use it for math. |
| `usd_rate` | string | The same rate as a decimal string (6 dp), e.g. `"0.010000"` = $0.01 per coin. For display only. |

> In `none` and `usd` modes the `coin` object is **absent**. Never assume it exists
> without first checking `monetization_mode === "coin"`.

---

## 3. Decision flow the client must implement

```
On launch → GET /config/app → read monetization_mode

switch (monetization_mode) {
  case "none":
    • Hide every "Withdraw" / "Cash out" entry point.
    • Do NOT present balances as money. Show neutral "Score" / "Points"
      framing or hide monetary balances entirely.
    • Do NOT show fiat symbols ($, €) next to earnings.
    • (Withdrawal API will return 403 monetization_disabled if called anyway.)
    break;

  case "coin":
    • Show balances and all withdrawal amounts in COINS using config.coin.
    • Convert between coins and USD with the rate in config.coin (see §5).
    • Withdrawal input field accepts COINS; send the coin amount as `amount`.
    break;

  case "usd":
    • Current behaviour. Amounts in USD. Withdraw enabled normally.
    break;
}
```

---

## 4. Defensive rules (do not skip)

1. **Re-fetch on resume.** An admin can flip the mode at any time. If a user has a
   withdraw screen open and the mode changes to `none`, the API will reject the
   request with `403 monetization_disabled`; handle that gracefully (toast + pop
   back to wallet, re-read config).
2. **Unknown mode → treat as `none` (fail safe).** If you receive a value other than
   `none` / `coin` / `usd` (future modes), **hide cash-out**. Never expose
   withdrawals for a mode you don't recognise.
3. **`coin` object missing while mode is `coin`?** Fall back to a safe default
   (`name: "Coins"`, `symbol: "C"`) but **disable withdrawals** until a valid rate
   is present, because you cannot compute the conversion safely.
4. **Never cache the mode across app versions** in a way that survives a forced
   config refresh. Config is the single source of truth.

---

## 5. Coin ⇄ USD conversion (must match the server exactly)

The rate is **`usd_rate_micros` = micro-USD per 1 coin**, where `1 USD = 1,000,000
micros`. Always do the math with the **integer** `usd_rate_micros`, never with the
rounded `usd_rate` string.

```
coinsToUsd(coins)  =  round( coins * usd_rate_micros / 10000 ) / 100   // → USD (2 dp)
usdToCoins(usd)    =  round( usd * 1_000_000 / usd_rate_micros * 100 ) / 100  // → coins (2 dp)
```

- Rounding is **round-half-up to the nearest cent** for `coinsToUsd` (this mirrors
  the backend; the server is authoritative on the final USD charged).
- `coinsToUsd` is what the **server** runs on the `amount` you submit in `coin` mode.
  Compute it client-side too so the user sees the exact USD equivalent before
  confirming.

### Worked example (default rate)

`usd_rate_micros = 10000` → `usd_rate = "0.010000"` → **1 coin = $0.01 → 100 coins = $1.00**

| User enters | USD the server charges | Notes |
|-------------|------------------------|-------|
| `1000` coins | `$10.00` | Equals the $10 minimum — allowed |
| `999` coins  | `$9.99`  | Below $10 minimum → rejected (`minimum_withdrawal_10`) |
| `100000` coins | `$1000.00` | KYC required above this (see §6 of withdrawals doc) |

### Displaying thresholds in coins

Withdrawal limits are enforced in **canonical USD** on the server (`MIN = $10`,
`MAX = $10,000`, `KYC threshold = $1,000`). In `coin` mode you must convert these to
coins for the UI so the user understands the limits in the currency they're using:

```
minCoins = usdToCoins(10)     // e.g. 1,000 coins at the default rate
maxCoins = usdToCoins(10000)  // e.g. 1,000,000 coins
```

Display the user's `earnings_balance` (returned in USD by the profile/wallet APIs)
as coins via `usdToCoins(earnings_balance)`.

---

## 6. Withdrawals API behaviour per mode

Endpoint: `POST /withdrawals/request` (auth required). Full flow in
`withdrawals-crypto-api-reference.md`. The `amount` field is interpreted by mode:

| Mode | `amount` you send | Server behaviour |
|------|-------------------|------------------|
| `none` | — | Always rejected: **`403 { "error": "monetization_disabled" }`**. Do not call. |
| `coin` | the amount **in coins** | Server converts coins → USD at the locked rate, validates USD thresholds, stores both the coin amount and the rate for audit. |
| `usd`  | the amount **in USD** | 1:1, current behaviour. |

### Request (coin mode example)

```json
POST /withdrawals/request
{
  "amount": 1500,                // 1,500 COINS (= $15.00 at default rate)
  "method": "paypal",
  "account_details": { "email": "user@example.com" }
}
```

### Success — `201 Created`

```json
{
  "withdrawal": { "id": "…", "amount": 15.00, "method": "paypal", "status": "awaiting_confirmation", "…": "…" },
  "requires_confirmation": true,
  "confirmation_expires_at": "2026-06-19T12:00:00Z",
  "earnings_balance": 120.00,
  "kyc_bypassed": true,
  "monetization_mode": "coin"
}
```

> Note: `withdrawal.amount` and `earnings_balance` in the response are **canonical
> USD**. In `coin` mode, convert them back to coins for display with `usdToCoins`.
> The OTP confirmation email currently shows the USD amount.

### Error codes to handle

| HTTP | `error` | When | Client action |
|------|---------|------|---------------|
| `403` | `monetization_disabled` | Mode is `none` | Hide/disable withdraw; re-fetch config |
| `400` | `invalid_amount` | Amount ≤ 0 / not a number | Inline validation |
| `400` | `minimum_withdrawal_10` | USD-equivalent < $10 | Show min in coins (`minCoins`) |
| `400` | `maximum_withdrawal_10000` | USD-equivalent > $10,000 | Show max in coins (`maxCoins`) |
| `403` | `kyc_required` | USD-equivalent > $1,000 and KYC not verified | Route to KYC flow |
| `400` | `insufficient_earnings` | Amount > balance | Show available balance in coins |
| `400` | `method_and_account_details_required` | Missing fields | Inline validation |

---

## 7. App Store & Google Play compliance — why this exists

The monetization switch exists so the app can be **submitted, reviewed, and
operated within the policies of both stores**. The client UI is part of that
compliance surface: a withdraw button shown to a reviewer in the wrong context is
itself a violation. This section explains the policy basis so the frontend choices
are understood, not guessed.

> This is a summary of public policy for engineering context, **not legal advice**.
> Final mode selection per build/region is decided by the business + legal team.

### 7.1 Apple App Store

| Guideline | What it says (paraphrased) | How our modes satisfy it |
|-----------|----------------------------|--------------------------|
| **3.1.1 — In-App Purchase** | In-app *currencies* and unlocks must use Apple IAP; apps may not use their own mechanisms for purchasing in-app currency. | We **never sell coins** through an external mechanism in the app. Coins are *earned*, not bought outside IAP. Top-ups are out of scope of this feature. |
| **3.1.1 — cash-out** | Apple has repeatedly rejected apps that let users cash tips/coins out to a bank account inside the app. | Cash-out is **server-gated**. In review/restricted builds we use **`none`** so no cash-out path is visible or callable. |
| **5.3.3** | Apps may **not** use IAP to buy credit/currency for use in **real-money gaming**. | We do not couple IAP top-ups to wagering. `coin` mode keeps play decoupled from any IAP purchase of stake. |
| **5.3.4** | Real-money gaming/lottery apps need **licensing**, must be **geo-restricted** to licensed regions, and must be **free**. | When real-money play is not licensed for a region, ship that region in **`none`** (no real-world monetary value → not "real money gaming"). Enable `usd` only where licensed + geo-restricted. |

**Practical client rule for Apple review:** builds submitted for review should be
configured **`none`** (or `coin` with no real-money framing) unless real-money
operation is licensed and geo-gated for the review locale. In `none` mode the client
must present balances as non-monetary (score/points) and expose **no** cash-out.

### 7.2 Google Play

| Policy | What it says (paraphrased) | How our modes satisfy it |
|--------|----------------------------|--------------------------|
| **Real-Money Gambling, Games & Contests** | Outside licensed pilots/regions, apps may not let users wager/stake real money (incl. items bought with money) to win a prize of **real-world monetary value**. | **`none`** removes the cash-out / real-world value element entirely, so the app is a skill/entertainment game, not real-money gambling, in non-licensed regions. |
| **Geo-gating requirement** | Real-money gambling functionality must be blocked in regions not covered by the developer's licence (new sign-ups + existing accounts). | Mode is server-driven and can be set per the licensed footprint; the client must respect `none` and not surface cash-out. |
| **Payments policy** | **Earned/awarded** points may be issued and exchanged **in-app without Play Billing**. But if virtual currency is **sold**, Play Billing is mandatory. Play Billing must **not** be used for peer-to-peer payments or gambling. | Our coins are **earned/awarded**, not sold via this feature — so coin balances and withdrawals do not require Play Billing. Do **not** wire withdrawals through Play Billing. |

**Practical client rule for Google Play:** the same as Apple — withdrawal UI must be
fully hidden in `none`, and real-money (`usd`) framing must only appear where the
business has confirmed licensing/geo-gating.

---

## 8. Frontend implementation checklist

- [ ] Read `monetization_mode` from `GET /config/app` on every cold start and resume.
- [ ] Unknown/unrecognised mode → **fail safe to no-cash-out** (treat like `none`).
- [ ] `none`: hide all withdraw entry points; present balances as non-monetary; no `$`/`€`.
- [ ] `coin`: render balances/inputs in coins using `config.coin`; convert with the
      exact integer math in §5; show USD equivalent on the confirm step.
- [ ] `coin`: convert server USD thresholds/errors back to coins for display.
- [ ] `usd`: existing real-money behaviour.
- [ ] Handle `403 monetization_disabled` everywhere a withdrawal can be triggered.
- [ ] Never sell coins through a non-IAP mechanism; never route withdrawals through
      Apple IAP / Google Play Billing.
- [ ] Confirm with product/legal which mode each store build & region ships in.

---

## 9. Related docs

- `withdrawals-crypto-api-reference.md` — full withdrawal flow, OTP, methods.
- `payments-api-reference.md` — top-ups / wallet.
- `public-api-reference.md` — `GET /config/app` reference (all flags).
- `project-brain/Domain_Knowledge.md` — financial model & monetary invariants.
