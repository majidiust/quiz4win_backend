# Quiz4Win Backend — Domain Knowledge

Last updated: 2026-05-22 (rev 2 — synced with 30-table initial schema)
Owner: A-05 (Domain Validation Agent)

---

## 1. Product Summary

**Quiz4Win** is a real-money quiz gaming platform. Players top-up a wallet, pay an entry fee to join a quiz game, answer 10 questions in a limited time, and receive prize payouts based on their performance. The platform supports multiple game modes and enforces strict financial integrity and regulatory compliance.

---

## 2. Core Domain Concepts

### 2.1 User & Profile
- A user is identified by a Supabase Auth UUID (`auth.users.id`)
- The `profiles` table extends auth data with: `full_name`, `avatar_url`, `kyc_status`, `referral_code`, fraud flags (`aml_flagged`, `fraud_suspected`), and cumulative stats (`total_games_played`, `total_prizes_won`, etc.)
- `kyc_status` values: `'pending'` | `'verified'` | `'rejected'` (no `'none'` — default is `'pending'` at signup)
- Supplementary tables: `user_settings` (theme/sound/haptics), `push_tokens` (FCM/APNS per device), `notification_preferences` (per-channel opt-ins)

### 2.2 Wallet
- Wallet balance lives in `profiles.wallet_balance` (a single `NUMERIC(12,2)` column — **⚠️ R-02 conflict pending resolution**)
- There is **no separate `wallets` table** in the schema
- Balance must always be ≥ 0 (enforced by server-side check inside Edge Function before debit)
- Top-up credits the balance; entry fee and withdrawal debit it
- All balance mutations go through Edge Functions — never direct client writes to `profiles`

### 2.3 Game Lifecycle
```
upcoming → open (accepting joins) → live (in progress) → completed
                                                       → cancelled (refunds all entry fees)
```
- `status` column CHECK constraint: `('upcoming','open','live','completed','cancelled')`
- Games have a `scheduled_at` timestamp; join window closes when status transitions to `live`
- `entry_fee` and `prize_pool` are set at game creation (by admin); both are immutable once status = `live` (INV-03)
- Prize pool may be seeded (guaranteed) or dynamic (sum of entry fees minus platform cut)

### 2.4 Game Modes
| Mode | Description |
|------|-------------|
| `timed` | Solo; fixed question set, time-limited; highest score wins |
| `battle` | 1v1 head-to-head; same question set simultaneously |
| `daily` | Free or low-cost daily challenge; prize from platform budget |
| `tournament` | Multi-round bracket; higher entry fees, larger prize pools |
| `live` | Hosted live show with a `show_host`; `livekit_room_name` required |

### 2.5 Question Bank
- Questions schema: `text TEXT`, `choices TEXT[]` (exactly 4), `correct_index INTEGER (0–3)`, `category TEXT`, `difficulty ('Easy'|'Medium'|'Hard')`, `language ('en'|'ar'|'fa'|'tr')`
- Questions are linked to a game via `game_questions` (ordered join table with `order_index` and `round_number`)
- `correct_index` is **never** exposed to the client — scoring happens server-side only (INV-04)
- `times_used` and `times_correct` track question performance for bank management

### 2.6 Show Hosts
- Live-mode games may have a `show_host` (row in `show_hosts` table)
- Hosts have a `livekit_identity` for the LiveKit room and a rating system (`rating_avg`, `rating_count`)
- Users submit 1–5 star ratings via `show_host_ratings` (unique per host + game + user)

### 2.7 Transactions
Every financial event creates an immutable row in `transactions` (append-only — R-05):
| `type` | Description |
|--------|-------------|
| `topup` | User wallet credit via payment gateway |
| `game_entry_fee` | Entry fee deducted when joining a game |
| `prize` | Prize payout after game completion |
| `withdrawal` | Withdrawal to external account |
| `referral_bonus` | Bonus credited to referrer on referred user's first paid game |
| `refund` | Full reversal if a game is cancelled (INV-09) |
| `admin_adjustment` | Manual correction by finance admin (requires A-05 + admin_id reference) |

### 2.8 KYC & AML
- KYC submissions tracked in `kyc_requests`: `doc_type`, front/back/selfie image URLs, `status`, `attempt_number` (max 3), reviewer reference
- AML monitoring via `aml_flags`: triggered when `total_24h_usd` exceeds threshold; status tracks review (`open` → `cleared` | `escalated`)
- Withdrawals link to `aml_flags` via `withdrawal_id` FK; `withdrawals.aml_flagged` boolean for quick filtering

### 2.9 Vouchers
- Two voucher types: `'platform'` (internal promos) and `'affiliate'` (partner redirects)
- Reward types: `topup_bonus_pct`, `topup_bonus_fixed`, `free_entry`, `wallet_credit`, `affiliate_redirect`
- Usage control: `per_user_limit`, `max_redemptions`, `valid_from`/`valid_until`, `eligible_countries`, `kyc_required`
- In-game announcements via `voucher_announcements` (time-boxed by `show_duration_sec` 10–120 s)
- All attempts (success + failure) logged in `voucher_attempt_log` for fraud detection

---

## 3. Business Invariants

### INV-01 — No Negative Balance
A user's `profiles.wallet_balance` MUST never go below zero. Any debit that would result in a negative balance MUST be rejected with an appropriate error **before** any DB write occurs. The check runs server-side inside Edge Functions.

### INV-02 — Entry Fee = Atomic Transaction
Deducting `entry_fee` from `profiles.wallet_balance` and inserting into `game_participants` MUST be a single PostgreSQL transaction (RPC). Partial success (fee deducted but join failed, or vice versa) is a critical data integrity violation.

### INV-03 — Prize Pool Immutable After Game Starts
Once a game's `status` transitions to `'live'`, its `prize_pool` and `entry_fee` MUST NOT change. Any admin edit attempt must be rejected with HTTP 409.

### INV-04 — Correct Answer Never Sent to Client
The `correct_index` field of any `questions` row must NEVER appear in any API response to the mobile client. Scoring and answer validation always happen inside Edge Functions. RLS policy must exclude this column from the `anon` and `authenticated` roles.

### INV-05 — KYC Required for Withdrawal
A withdrawal request MUST be rejected (HTTP 403) if the user's `profiles.kyc_status ≠ 'verified'`. This check happens server-side in the `wallet-withdraw` Edge Function, regardless of frontend state.

### INV-06 — Withdrawal Minimum & Maximum
- Minimum withdrawal: `<<TBD by Human>>` (specify in cents or decimal — pending R-02 conflict resolution)
- Maximum single withdrawal: `<<TBD by Human>>`
- Daily withdrawal limit per user: `<<TBD by Human>>`

### INV-07 — Platform Cut on Prize Pool
The platform retains a percentage of the prize pool before distributing winnings. Rate: `<<TBD by Human>>` %. This must be applied consistently in `game-result` Edge Function and recorded as an `admin_adjustment` transaction.

### INV-08 — Referral Bonus Rules
When a referred user completes their first paid game, the referrer receives a `referral_bonus` transaction. Amount defined in `referral_codes.bonus_amount`. Must not be triggered more than once per referred user — enforce via `referral_uses.bonus_paid` flag.

### INV-09 — Game Cancellation Refunds All Entry Fees
If a game is cancelled (status → `'cancelled'`) before going `live`, ALL `game_participants` with `entry_fee_paid > 0` must receive a full `refund` transaction in a single atomic DB transaction. No partial refunds.

### INV-10 — Duplicate Join Prevention
A user MUST NOT be able to join the same game more than once. Enforced via `UNIQUE (game_id, user_id)` in `game_participants` AND a server-side pre-check in the Edge Function before the RPC call.

### INV-11 — KYC Attempt Limit
A user may submit at most 3 KYC attempts (`kyc_requests.attempt_number` CHECK `BETWEEN 1 AND 3`). After 3 rejections, further submissions must be blocked server-side with an appropriate error.

### INV-12 — AML Threshold Monitoring
Withdrawals that cause a user's 24-hour total to exceed the AML threshold must create an `aml_flags` row with `status = 'open'` and set `withdrawals.aml_flagged = TRUE`. Threshold amount: `<<TBD by Human>>`.

### INV-13 — Voucher Fraud Prevention
All voucher redemption attempts (success and failure) must be logged in `voucher_attempt_log`. Rate limits (`rate_limit_per_ip`, `rate_limit_per_user`) must be enforced before any redemption logic runs.

---

## 4. Regulatory & Compliance Notes

- This platform handles real money and must comply with applicable gambling/gaming regulations (`<<TBD by Human>>` — specify jurisdiction)
- User age verification may be required (`<<TBD by Human>>` — specify minimum age and enforcement mechanism)
- Geographic restrictions may apply (`<<TBD by Human>>` — specify blocked regions)
- Tax reporting obligations for winners above threshold: `<<TBD by Human>>`

---

## 5. Edge Cases & Known Risk Areas

| Scenario | Mitigation |
|----------|-----------|
| Network failure mid-game-join | Idempotency key on game-join RPC; client retries safely |
| Duplicate webhook from payment gateway | Idempotency check on `external_reference` in transactions |
| User exploits answer timing | All answers validated server-side with submission timestamp |
| Simultaneous join depletes prize pool | Enforce `max_players` with DB-level SERIALIZABLE transaction |
| Score tie in `timed` mode | `<<TBD by Human>>` — define tie-breaking rules |
