# Quiz4Win Backend — Open Task Queue

Last updated: 2026-05-22
Owner: A-01 (Augment Code Agent)

> Update this file whenever tasks are added, completed, re-prioritised, or blocked.
> Format: `[PRIORITY] [STATUS] [OWNER] Task title — Description`
> Priorities: **P0** (blocker), **P1** (critical), **P2** (important), **P3** (nice-to-have)
> Statuses: `TODO` | `IN_PROGRESS` | `DONE` | `BLOCKED`

---

## P0 — Blockers (Must resolve before implementation begins)

- [P0] [BLOCKED] [HUMAN + A-05] **Resolve monetary-storage conflict (R-02 vs. Data Schema)** — Google Sheet "Data Schema" defines money columns as `NUMERIC(10,2)` / `NUMERIC(12,2)` (decimal dollars), but Rule R-02 mandates **integer cents**. Decision needed: (a) amend R-02 to allow `NUMERIC(12,2)` with documented rationale, OR (b) refactor migration `20260522120000_initial_schema.sql` to use `BIGINT` cents columns (`wallet_balance_cents`, `amount_cents`, `entry_fee_cents`, `prize_pool_cents`, `prize_earned_cents`, `entry_fee_paid_cents`, `bonus_amount_cents`, `reward_value_cents`, `reward_value_applied_cents`, `min_wallet_balance_cents`, `total_24h_usd_cents`, `total_deposited_cents`, `total_withdrawn_cents`, `total_prizes_won_cents`) and update `database.types.ts`. Affects: profiles, games, game_participants, transactions, withdrawals, aml_flags, referral_codes, vouchers, voucher_redemptions.

- [P0] [TODO] [HUMAN] **Define withdrawal limits** — Specify minimum withdrawal, maximum single withdrawal, and daily withdrawal limit per user. Required by INV-06 in Domain_Knowledge.md.

- [P0] [TODO] [HUMAN] **Define platform cut percentage** — Specify the percentage of prize pool retained by the platform per game. Required by INV-07 in Domain_Knowledge.md.

- [P0] [DONE] [A-01] **Define referral bonus amount** — Implemented dual-sided referral bonuses (referrer + referee), admin-adjustable globally and per-user. Defaults: referrer $10.00, referee $5.00. INV-08 wired. — 2026-06-19

- [P0] [TODO] [HUMAN] **Define regulatory jurisdiction** — Specify the country/state jurisdiction for gambling/gaming compliance. Required before any real-money features can go live. See Domain_Knowledge.md §4.

- [P0] [TODO] [HUMAN] **Define tie-breaking rules** — Specify how ties are broken in `timed` mode (e.g., fastest correct answers, random, split prize). Required by Domain_Knowledge.md §5.

- [P0] [TODO] [HUMAN] **Choose payment gateway** — Select the payment provider for top-up and withdrawal (e.g., Stripe, Paystack, Flutterwave). Architecture depends on this choice.

- [P0] [DONE] [HUMAN] **Confirm Supabase project credentials** — Supabase credentials added to `.env` in repo root. Variable names follow the Supabase convention (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, and related keys). `.env` must be in `.gitignore` — see P1 task below. — 2026-05-22

---

## P1 — Critical Implementation Tasks

- [P1] [DONE] [A-01] **Add `.gitignore` and verify `.env` is excluded** — `.gitignore` created covering `.env`, `.env.*`, `.tmp_*.py/txt/json`, Supabase temp dirs, Deno, Node, macOS artifacts. — 2026-05-22

- [P0] [DONE] [A-01] **🚨 R-01 VIOLATION — Delete temp scripts with embedded secrets** — Deleted .tmp_run.py, .tmp_fetch.py, .tmp_read_sheet.py, .tmp_sheet_result.txt and other .tmp_* files to ensure no secrets are exposed. — 2026-06-17

- [P1] [TODO] [A-01] **Initialise Supabase project** — Run `supabase init` and create `supabase/config.toml`. Set up local development environment. Supabase URL and anon key are now available in `.env`.

- [P1] [DONE] [A-01] **Create initial DB migration** — `supabase/migrations/20260522120000_initial_schema.sql` created with all **31 tables** from the Data Schema sheet, indexes, FKs, CHECK constraints, and RLS *enabled*. RLS *policies* still pending (see P1 follow-up below). — 2026-05-22

- [P0] [DONE] [A-01] **Apply initial schema migration to remote Supabase DB** — Migration committed against project `xcvzagyszaxnnjojnlep` (eu-west-1, Postgres 17.6) via Supavisor pooler session mode. All 31 tables exist in `public` schema with RLS enabled (verified via `pg_tables`). — 2026-05-22

- [P1] [TODO] [A-01 + A-05] **Author RLS policies for all tables** — Initial migration enables RLS but defines no policies, which means all reads/writes are blocked except via service-role. Add a follow-up migration `20260522130000_rls_policies.sql` with per-table policies (e.g., `profiles`: user can SELECT/UPDATE own row; `transactions`: user can SELECT own rows, no UPDATE/DELETE per R-05; `withdrawals`: user can INSERT/SELECT own; `admin_users`: admin role only; etc.). Requires A-05 review per R-04.

- [P1] [DONE] [A-01] **Generate TypeScript database types** — `supabase/functions/_shared/database.types.ts` created with interfaces for all 30 tables plus aggregate `Database` type. — 2026-05-22

- [P1] [DONE] [A-01] **Set up Drizzle ORM** — Installed drizzle-orm + postgres (runtime), drizzle-kit + tsx (dev). Introspected live DB with `drizzle-kit pull`; artifacts in `supabase/drizzle/` (schema.ts, relations.ts). Created Deno import map `supabase/functions/deno.json`. Created shared DB client `supabase/functions/_shared/db/client.ts` and barrel `supabase/functions/_shared/db/index.ts`. Edge Functions import via `import { db, <table> } from "../_shared/db/index.ts"`. — 2026-05-22

- [P1] [DONE] [A-01] **Build `_shared/auth.ts` helper** — JWT validation utility reused by all Edge Functions (per R-03 and Coding_Standards.md §3). Pass JWT explicitly to `getUser(token)`. — 2026-05-24

- [P1] [TODO] [A-01] **Build `_shared/errors.ts` helper** — Standardised `errorResponse` and `successResponse` helpers.

- [P1] [TODO] [A-01] **Implement `game-join` Edge Function** — Atomic wallet debit + game participant insert via PostgreSQL RPC (INV-02, R-09).

- [P1] [TODO] [A-01] **Implement `wallet-topup` Edge Function** — Payment gateway webhook handler; credits wallet on successful payment.

- [P1] [TODO] [A-01] **Implement `wallet-withdraw` Edge Function** — KYC check + withdrawal initiation (INV-05, R-08). Blocked on P0 payment gateway choice.

- [P1] [TODO] [A-01] **Implement `game-result` Edge Function** — Record game outcome, calculate prize distribution (INV-07), insert `prize` transactions.

---

## P1 — Host Platform (multi-phase build)

> Decisions logged 2026-06-09 in `Change_Log_AI.md` (D-1..D-6, human-approved). Architecture surface in `Architecture_Map.md` §6 (new `host.quiz4win.com` subsystem). Invariants in `Domain_Knowledge.md` INV-16/17/18.

- [P1] [DONE]        [A-01] **Host Platform — Phase 0: project-brain & decisions** — 2026-06-09.
- [P1] [DONE]        [A-01] **Host Platform — Phase 1: DB schema migration** — `20260609000000_host_platform_phase1_schema.sql` written. **HUMAN deploy:** `docker compose up -d --force-recreate db-maintainer`.
- [P1] [DONE]        [A-01] **Host Platform — Phase 1b: RLS policies migration** — `20260609000100_host_platform_rls_policies.sql` (owner-self via auth_user_id; admin via service-role bypass).
- [P1] [DONE]        [A-01] **Host Platform — Phase 2: Host application & profile API** — `supabase/functions/host/` + `supabase/functions/admin-hosts/`.
- [P1] [DONE]        [A-01] **Host Platform — Phase 3: Game discovery & requests** — INV-17 enforced via `check_host_schedule_conflict` RPC.
- [P1] [DONE]        [A-01] **Host Platform — Phase 4: Invitations** — Admin send/cancel; host accept/reject with conflict check.
- [P1] [DONE]        [A-01] **Host Platform — Phase 5: Stream readiness session** — State machine + HS256 LiveKit token mint (pure Web Crypto, no SDK).
- [P1] [DONE]        [A-01 + A-05] **Host Platform — Phase 6: Earnings, payouts, payment methods** — INV-16 atomic approve; payment-method CRUD + admin verify; payouts ride existing `withdrawals` flow.
- [P2] [DONE]        [A-01] **Host Platform — Phase 7: Notifications, files, audit** — Files DONE; audit DONE; notification side-effects DONE (migration `20260609000200_host_platform_notification_types.sql` extends `notifications.type` CHECK + `_shared/host_notifications.ts` helper used from `admin-hosts` and `admin/src/lib/actions/hosts.ts`).
- [P1] [IN_PROGRESS] [A-01] **Host Platform — Phase 8: `host-app/` Next.js mobile-first frontend** — Scaffold + 16 screens DONE. Real-data wiring polish remains.
- [P1] [DONE]        [A-01] **Host Platform — Phase 9: Admin panel host management pages** — `/hosts` list + `/hosts/[id]` detail with tabbed actions DONE; built on `admin/src/lib/actions/hosts.ts` (setHostStatus, reviewHostFile, reviewHostRequest, sendHostInvitation, cancelHostInvitation, createHostEarning, approveHostEarning, cancelHostEarning, reviewHostPaymentMethod).
- [P0] [DONE]        [A-01] **Host Platform — Phase 10: Audit-driven fixes** — Migration `20260609000300_host_platform_followup_fixes.sql` renames `admin_audit_log.entity_*` → `target_*` (so the entire repo's audit INSERTs finally succeed), adds SECURITY DEFINER `approve_host_earning_atomic` RPC for the INV-16 flow, and installs `trg_close_stale_host_offers_on_assign` to auto-close losing requests/invitations on game assignment. Code-side: race fix (`WHERE host_id IS NULL`) on both invitation-accept and request-approve, stream-live game-status guard + session upsert, avatar file approval syncs `show_hosts.avatar_url`. **HUMAN deploy:** `docker compose up -d --force-recreate db-maintainer && docker compose up -d --build --force-recreate api admin`.
- [P2] [DONE]        [A-01] **Host Platform — Phase 11: Tests** — Deno test for `signAccessToken` (`supabase/functions/_shared/livekit.test.ts`), Python production smoke test (`scripts/host-platform-smoke-test.py`, validated end-to-end against api.quiz4win.com), SQL fixture test for `check_host_schedule_conflict` + stale-state trigger (`scripts/host-platform-sql-tests.sql`).

---

## P2 — Important Tasks

- [P2] [TODO] [A-01] **Implement `kyc-submit` Edge Function** — Accept KYC document upload reference; update `kyc_status` to `pending`; store metadata.

- [P2] [TODO] [A-01] **Implement `recaptcha` Edge Function improvements** — The existing function needs JWT validation added and integration tests written.

- [P2] [TODO] [A-01] **Write integration tests for all Edge Functions** — Cover happy path, auth failure, business rule violations (per Coding_Standards.md §7).

- [P2] [TODO] [A-03] **Design Realtime channel schema** — Define which Supabase Realtime channels broadcast game state updates and their payload shapes.

- [P2] [TODO] [A-05] **Review and approve all RLS policies** — Audit every table's RLS policy against domain invariants before any production deployment.

- [P2] [TODO] [A-01] **Create `seed.sql`** — Dev/test seed data for games, questions, and a test user with wallet balance.

---

## P3 — Nice-to-Have

- [P3] [TODO] [A-04] **Establish migration linting CI** — Add CI step that checks migration files follow naming conventions and include RLS policies.

- [P3] [TODO] [A-01] **Implement admin Edge Functions** — Restricted functions for game creation, question bank management, and KYC approval (admin role required).

- [P3] [TODO] [A-01] **Implement referral bonus logic** — Credit referrer on referred user's first paid game completion (INV-08). Blocked on P0 referral bonus amount.

- [P3] [PARTIAL] [A-01] **Push notification integration** — Game-start reminders (T-60/T-10/T-1) implemented in deploy/template-generator (2026-05-31). Still pending: result/withdrawal notifications.

- [P3] [TODO] [A-04] **Document all PostgreSQL RPC functions** — Add inline SQL comments to every `CREATE FUNCTION` with purpose, parameters, return type, and invariants enforced.

---

## Pending Deployment / Mobile Coordination

- [P1] [TODO] [HUMAN-MOBILE] **Fill iOS Universal Link manifest placeholders** — Edit `app/public/.well-known/apple-app-site-association` and replace `TEAMID.com.quiz4win.app` with the real Apple Team ID once provisioning is finalised. Then rebuild + redeploy: `docker compose build app && docker compose up -d app`.

- [P1] [TODO] [HUMAN-MOBILE] **Fill Android App Link manifest placeholder** — Edit `app/public/.well-known/assetlinks.json` and replace `REPLACE_WITH_SHA256_FROM_eas_credentials` with the SHA-256 cert fingerprint from `eas credentials` (Android → production). Then rebuild + redeploy as above.

- [P1] [TODO] [HUMAN-OPS] **Deploy quiz4win-app container to production host** — Pull latest, then `docker compose build app && docker compose up -d app` on the production VM. Also re-run `sudo bash deploy/nginx/setup.sh` only if the cert for `app.quiz4win.com` is not yet issued (the script is idempotent). Fixes the 502 on the recovery-link web fallback.

---

## Completed Tasks
- [P0] [DONE] [A-01] **Fix GAME_RESULT zeroed prize payload** — `distribute_prizes` (three-bucket migration `20260607000000`) had dropped the rich return shape + `games.result_summary` persistence, so GAME_RESULT and the `/…/result` endpoints showed `totalPrize/prizePool/sharePerWinner=0` and empty winner arrays despite winners being paid. New migration `20260608100000_fix_distribute_prizes_result_payload.sql` restores the full payload + `result_summary` (keeping three-bucket earnings/score crediting) and back-fills the summary on idempotent replay. Deploy via `db-maintainer`. — 2026-06-08
- [P2] [DONE] [A-01] **Decrease template generator interval to 10s** — Updated `deploy/template-generator/generator.ts` `INTERVAL_MS` to 10s default. — 2026-06-08
- [P2] [DONE] [A-01] **Cap inter-question gap at 5s** — Updated `deploy/game-orchestrator/orchestrator.ts` to cap the random inter-question delay at 5000 ms (range 3000–5000 ms) instead of the previous 5000–10000 ms default. — 2026-06-08
- [P1] [DONE] [A-01] **Pre-resolved question buffer (depth 5)** — Reworked `orchestrator.ts` so `prefillQueue` buffers fully-resolved (generated + claimed + dedup-checked) questions and the inter-question hot path only pops + broadcasts, eliminating the lag between questions. Added `QUESTION_BUFFER_TARGET` env (default 5). Removed the 3 000 ms trailing pause after the final question (finalizes immediately). Docs + changelog synced. — 2026-06-08

- [P2] [DONE] [A-01] **Added 'loser' sound usage** — Updated `SoundUsage` type and constants in admin panel, added slot to Edge Function validation, and applied migration to update the DB check constraint. — 2026-06-08
- [P1] [DONE] [A-01] **Producer/consumer question buffer (depth 2)** — Refactored `orchestrator.ts` from fire-and-forget `prefillQueue` into an explicit per-game producer loop (`startProducer`/`produceOneQuestion`, fills `questionQueue` to `QUESTION_BUFFER_TARGET`=2, idles when full) + LIFO consumer (`takeQuestion`, `queue.pop()`, waits only for one question so the game starts on first-ready). Lifecycle wired into start/recovery/finalize. Deploy: rebuild `game-orchestrator`. — 2026-06-08
- [P1] [DONE] [A-01] **Repeated-question fix — Phase 1: creative facet rotation** — In `orchestrator.ts`: every generation now steers into a random self-expanding **facet** (sub-topic, enumerated per category + cached in Redis `q4w:facets:{category}`, static fallback) + **angle**, with an "avoid the obvious fact" contract clause; base sampling raised to `QUESTION_GEN_TEMPERATURE`=0.9 + `top_p`=0.95; each dedup retry re-rolls a fresh facet/angle. New env: `QUESTION_GEN_TEMPERATURE`, `QUESTION_GEN_TOP_P`, `FACET_CACHE_TTL_SECONDS`, `FACET_COUNT`. No migration/new infra. Deploy: rebuild `game-orchestrator`. — 2026-06-08
- [P1] [DONE] [A-01] **No-show participant excluded from prize ranking (Option A)** — `handlePersistAnswer` now increments `wrong_answers` on real wrong submissions (ghost-sweep no-answers only touch `wrong_count`); migration `20260608300000_compute_game_ranks_exclude_noshows.sql` adds `AND (correct_answers > 0 OR wrong_answers > 0)` filter to survivor CTE + mirrors it to disqualified-update block. Pure no-shows → `rank=NULL` in all game types. Deploy: db-maintainer + rebuild `game-orchestrator`. — 2026-06-08
- [P2] [TODO] [A-01 + A-03 + A-05] **Repeated-question fix — Phase 2: dedicated `question-generator` service** — Pending design approval (see plan handed to human). New always-on Docker worker pre-generates each upcoming game's full question set (facet rotation + `claim_question` dedup) ahead of `scheduled_at`, stored reserved per game; orchestrator consumes with zero latency, live generation only as fallback. Touches `docker-compose.yml` (R-11) + likely a migration (R-12) → needs A-03/A-05 sign-off before build. — 2026-06-08


- [P1] [DONE] [A-01] **Restore Game Orchestrator AMQP Consumer** — Fixed the crash due to missing `BufReader` and the TLS handshake issues with `amqplib` by switching to native `deno.land/x/amqp@v0.24.0` with a pinned `jsr:@std/io@0.224.9` import map. Replaced HTTP polling with robust real-time AMQP consumption. — 2026-05-31

- [P1] [DONE] [A-01] **LiveAvatar Admin UI Integration** — Enhanced template editor with Avatar/Voice pickers and audio previews. — 2026-05-30
- [P2] [DONE] [A-01] **Payments detail enhancements** — Expanded payment details with identifiers, crypto cards, and universal verify button. — 2026-05-30

- [P1] [DONE] [A-01] **Admin API Keys management** — Migration `20260528000000_api_keys.sql` (RLS, service-role only), `validateAdminAccess` helper in `_shared/auth.ts` supporting `X-API-Key: key_id.secret`, server actions + `/api-keys` UI page with create/revoke + one-time secret reveal, nav + ROUTE_ROLES entry for super_admin. — 2026-05-28
- [P1] [DONE] [A-01] **Dedicated Game Edit Page** — Converted `EditGameDialog` modal to a full-screen internal page; added `questions_count` field support. — 2026-05-26


- [P1] [DONE] [A-01] **Add quiz4win-app static container for app.quiz4win.com** — Created `app/` module (Dockerfile + nginx.conf + public/) serving Universal Link manifests + password-reset web fallback; wired into `docker-compose.yml` on port 5801; simplified host nginx config + setup script. Resolves 502 on Supabase recovery links opened in browser. — 2026-05-24
- [P1] [DONE] [A-01] **Extend Admin Panel game styling & asset uploads** — Added color pickers, gradient builder, and S3-backed asset upload (Icon/Thumbnail/Host Avatar) to Create Game dialog and Game Detail page; updated grid layout. — 2026-05-25
- [P1] [DONE] [A-01] **Fix db-maintainer Postgres version mismatch** — Updated Dockerfile to `postgres:17-alpine` to support `pg_dump` against Supabase Postgres 17. — 2026-05-25
- [P1] [DONE] [A-01] **API Reference Documentation** — Created `docs/api-reference.md` with complete customer & admin game-related API specs. — 2026-05-25

- [P1] [TODO] [A-01] **CRITICAL: Harden referral bonuses to first-paid-game gate (Option A)** — Currently: referee gets bonus at signup, referrer on referee's first paid game (Option B). Future: gate BOTH bonuses on the referee's first paid game to prevent fake-account farming. Move `pay_referee_bonus` call from `auth/index.ts` (signup) into `pay_referrer_bonus` RPC (first paid game join). Requires: (1) new migration extending `pay_referrer_bonus` to credit both parties atomically; (2) removing the `pay_referee_bonus` call from auth; (3) marking `referee_bonus_paid` FALSE until first paid game. Pair with KYC / device-fingerprint checks for maximum fraud resistance. — Requested 2026-06-19

- [P0] [DONE] [HUMAN] Supabase project credentials added to `.env`. — 2026-05-22
- [P0] [DONE] [A-02] Bootstrap multi-agent coordination framework — Created agents.md, /project-brain/ (7 files), /agents/ (5 files). — 2026-05-22
