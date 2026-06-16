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

> **Full event-timing reference** — question loop timing, answer window rules, scoring formula, elimination flow, Redis TTLs, and clock-sync recipe: **`docs/game-logic.md`** (required reading for any orchestrator or game-session task).

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

### INV-14 — Any Unanswered Question = Missed/Wrong Answer (Unified Rule)
**Any question that ends without a valid submission from a participant is counted as a missed (wrong) answer.** This rule applies deterministically across all player states:

| Player state | Mechanism |
|---|---|
| **Joined Redis, did not answer** | `CLOSE_Q_SCRIPT` → `SDIFF(participants, questionAnswered)` → orchestrator notAnswered loop charges wrong, broadcasts event |
| **Late join (first_question_only)** | `JOIN_GAME_SCRIPT` charges `missed = currentQuestionIndex + 1`; surviving late joiners are blocked on the in-progress question |
| **Ghost participant** (paid, never called `/game-session/join`) | §10.3 orchestrator ghost sweep queries DB for players absent from Redis; increments `wrong_count`/`lives_remaining` in DB, broadcasts `PLAYER_WRONG_ANSWER` or `PLAYER_ELIMINATED` at each question close |
| **Disconnected / Redis-expired** | If user re-establishes Redis state after disconnect, the existing `userState` hash is detected on reconnect; if the hash expired, they re-enter via the ghost-sweep pre-charged join path |
| **any_time join policy** | No penalty for questions before join time; rule only starts from the question after they join |

**Late-join detail** (`first_question_only`):
- `missed = currentQuestionIndex + 1` (in-progress question counts because it started before they arrived)
- `missed < allowed_wrong_answers` → join as **participant**, `lives_remaining = allowed_wrong_answers − missed`; in-progress question blocked (cannot double-answer)
- `missed ≥ allowed_wrong_answers` → join **demoted to spectator**, `eliminated = true`, `elimination_reason = 'late_join_missed'`

**Ghost-sweep pre-charged join path**: When a ghost player eventually calls `/game-session/join`, the edge function reads their DB `wrong_count`/`lives_remaining` (pre-charged by previous ghost sweeps) and passes them as `ARGV[6]`/`ARGV[7]` to `JOIN_GAME_SCRIPT`. The Lua script then only charges the currently-active question (+1) rather than recomputing from `currentQuestionIndex`, preventing double-counting. `LATE_JOIN_RECONCILE` is only published for this single new charge (not for already-broadcast ghost-sweep events).

Games with no `allowed_wrong_answers` limit never eliminate on missed questions. State is authoritative in `game_participants` (DB) and mirrored to Redis user hashes; the orchestrator is the sole LiveKit broadcaster.

### INV-15 — Survivor Eligibility for Prize Ranking (Option A)

A participant MUST have submitted **at least one real answer** (correct or wrong) to be eligible for a prize rank. A player who registered and paid but never connected to the game session ("pure no-show") MUST receive `rank = NULL` and be excluded from all prize tiers.

**Enforcement mechanism:**
- `game_participants.wrong_answers` is incremented **only** on real wrong submissions (`handlePersistAnswer`). The ghost-sweep no-answer path only increments `wrong_count`.
- A pure no-show therefore always has `correct_answers = 0 AND wrong_answers = 0`.
- `compute_game_ranks` filters survivors with `AND (correct_answers > 0 OR wrong_answers > 0)`. Players failing this check receive `rank = NULL` / `status = 'disqualified'`.

This invariant applies **across all game types** including unlimited-lives games (`allowed_wrong_answers = NULL`) where the ghost sweep never fires an elimination. The entry fee is NOT refunded for a no-show — they paid to play and chose not to participate.

### INV-16 — Host Earnings Reservation Pattern (R-05 preserved)

Host earnings MUST follow a two-stage reservation pattern that preserves the append-only nature of `public.transactions` (R-05):

1. **Pending stage** — On game completion, an admin-reviewed `host_earnings` row is created with `status = 'pending'`, `amount_cents`, `host_id`, `game_id`, and **no** `transaction_id`. No money has moved.
2. **Approved stage** — When an admin approves the earning, a SINGLE atomic DB transaction:
   - INSERTs a `transactions` row with `type = 'host_earning'`
   - Credits `profiles.wallet_balance` by `amount_cents`
   - UPDATEs the `host_earnings` row to `status = 'approved'` and sets `transaction_id` to the new transaction's id and `approved_at = now()`.

`host_earnings` is the lifecycle/state surface; `transactions` is the immutable ledger. Once a `host_earning` transaction row exists, it can never be UPDATEd or DELETEd. Cancellation of a still-pending earning is allowed (it has no transaction row yet); cancellation of an approved earning requires a compensating `admin_adjustment` transaction with `reversal_of` reference, never a delete.

Payouts (the host actually receiving the money externally) flow through the existing `withdrawals` table — host wallet balance is just normal wallet balance, R-08 (KYC required for withdrawal) applies equally to hosts.

### INV-17 — No Overlapping Host Assignments

A host MUST NOT be confirmed for two games whose live windows overlap. The live window of a game is `[scheduled_at, scheduled_at + estimated_duration_minutes)` (when `estimated_duration_minutes` is null, a 90-minute default is assumed).

Two assignment events trigger the check:
- Admin approving a `host_game_request` → reject if any other request/invitation/assignment for the same host overlaps.
- Host accepting a `host_invitation` → reject the accept with HTTP 409 if any overlap exists.

The check runs server-side in the Edge Function using a `SECURITY DEFINER` SQL helper (`check_host_schedule_conflict(host_id, game_id)`). Frontend hints are advisory only.

### INV-18 — Host Application & Status Gates

Two flags on `show_hosts` gate every host action:
- `application_status ∈ {'pending','approved','rejected','suspended'}` — onboarding/lifecycle.
- `status ∈ {'active','inactive'}` — operational visibility (existing column, used by `public-featured-host`).

| Action | Required state |
|---|---|
| Sign in to `host.quiz4win.com` | `auth.users.email_confirmed_at IS NOT NULL` (Supabase GoTrue) |
| Apply to be a host | `auth_user_id` exists, no `show_hosts` row yet, or `application_status = 'rejected'` |
| Edit own profile / upload files / request games | `application_status = 'approved'` AND `status != 'suspended'` |
| Receive invitations | same as above |
| Start a stream session | same as above, AND host is the assigned host on the game |
| Receive earnings | same as above; `application_status = 'suspended'` freezes new earnings but preserves already-approved ones |

A `suspended` host cannot perform any new write action; reading own historic data remains allowed. `rejected` is a terminal state for that application — the user may re-apply (a new `application_status = 'pending'` cycle).

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
