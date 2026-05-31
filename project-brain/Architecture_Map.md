# Quiz4Win Backend — Architecture Map

Last updated: 2026-05-30 (rev 3 — Game Template Engine v1)
Owner: A-03 (Architecture Agent)

---

## 1. System Overview

Quiz4Win is a **real-money quiz gaming platform**. The backend infrastructure consists of:

- **PostgreSQL** — primary data store (users, games, questions, wallets, transactions)
- **Authentication service** — user identity and access token issuance
- **Edge Functions** — Deno/TypeScript serverless functions (business logic, external API calls)
- **Realtime broadcast service** — live game state broadcast to connected mobile clients
- **S3-compatible Object Storage** (DigitalOcean Spaces, region `fra1`, bucket `wingobingo`) — all file uploads: KYC documents (private, presigned GET), profile avatars (public-read), and any future attachments. Shared by both the edge functions (`supabase/functions/_shared/s3.ts`) and the admin panel (`admin/src/lib/s3.ts`). Supabase Storage is no longer used.
- **External APIs** — payment gateways (top-up/withdrawal), reCAPTCHA (fraud prevention), Brevo (transactional email)

### Public hostnames

| Host | Port | Container | Purpose |
|------|------|-----------|---------|
| `panel.quiz4win.com` | 5800 → 3000 | `quiz4win-admin` (Next.js)        | Admin panel (staff) |
| `app.quiz4win.com`   | 5801 → 8080 | `quiz4win-app` (nginx:alpine)     | Customer Universal Link host: AASA + assetlinks manifests, password-reset web fallback, landing page |
| `api.quiz4win.com`   | 5802 → 8000 | `quiz4win-api` (Deno edge functions)    | All customer + admin REST/Edge endpoints |

Host nginx terminates TLS for all three subdomains and proxies to the loopback ports above. See `deploy/nginx/*.conf` and `docker-compose.yml`.

---

## 2. Repository Structure

```
backend/
├── agents.md                       # Agent Registry & Coordination Framework
├── agents/                         # Individual agent definition files
│   ├── augment_code_agent_integration.md
│   ├── project_memory_guardian.md
│   ├── architecture_agent.md
│   ├── refactor_agent.md
│   └── domain_validation_agent.md
├── project-brain/                  # Shared AI agent memory
│   ├── Rules.md
│   ├── Architecture_Map.md
│   ├── Domain_Knowledge.md
│   ├── Coding_Standards.md
│   ├── Collaboration_Protocol.md
│   ├── Change_Log_AI.md
│   └── Open_Tasks_AI.md
├── deploy/                         # Deployment manifests and Docker services
│   ├── game-orchestrator/          # ✅ CREATED — RabbitMQ consumer (Deno)
│   ├── db-maintainer/              # ✅ CREATED — Database lifecycle (Postgres)
│   └── ...
└── supabase/
    ├── config.toml                 # Supabase project configuration (<<TBD>>)
    ├── seed.sql                    # Dev/test seed data (<<TBD>>)
    ├── migrations/                 # Ordered SQL migration files
    │   └── 20260522120000_initial_schema.sql   # ✅ CREATED — 30 tables
    └── functions/                  # Edge Functions (Deno/TypeScript)
        ├── _shared/                # Shared utilities imported by all functions
        │   ├── cors.ts             # (<<TBD>> — to be created)
        │   ├── auth.ts             # JWT validation helper (<<TBD>>)
        │   ├── errors.ts           # Standardised error responses (<<TBD>>)
        │   └── database.types.ts   # ✅ CREATED — TypeScript interfaces for all 30 tables
        ├── recaptcha/              # reCAPTCHA verification (existing)
        │   └── index.ts
        ├── game-join/              # Atomic wallet debit + game join (<<TBD>>)
        │   └── index.ts
        ├── game-result/            # Record outcome, distribute prizes (<<TBD>>)
        │   └── index.ts
        ├── wallet-topup/           # Payment gateway integration (<<TBD>>)
        │   └── index.ts
        ├── wallet-withdraw/        # Withdrawal with KYC check (<<TBD>>)
        │   └── index.ts
        ├── kyc-submit/             # KYC document upload & status update (<<TBD>>)
        │   └── index.ts
        └── admin-*/                # Admin-only functions (<<TBD>>)
```

> **Legend:** `✅ CREATED` — file exists on disk. `<<TBD>>` — planned but not yet created.

---

## 3. Module Boundaries & Import Directions

```
┌─────────────────────┐
│   Mobile App        │  (QuizForWin/ — separate repo)
│   Expo + React Native│
└──────────┬──────────┘
           │  HTTPS / Supabase client SDK
           ▼
┌─────────────────────┐     ┌──────────────────────┐
│  Edge Functions     │────▶│   External APIs       │
│  (Deno/TypeScript)  │     │  - Payment gateway    │
└──────────┬──────────┘     │  - reCAPTCHA          │
           │  SQL / RPC      │  - Push notifications │
           ▼                 └──────────────────────┘
┌─────────────────────┐
│  Supabase Database  │
│  PostgreSQL + RLS   │
│  + Auth + Storage   │
│  + Realtime         │
└─────────────────────┘
```

**Allowed import directions:**
- Mobile App → Edge Functions (via public API)
- Edge Functions → Database (via internal connection)
- Edge Functions → External APIs (via `fetch`)
- Edge Functions → `_shared/` utilities

**Forbidden:**
- Edge Functions → Mobile App code
- DB triggers → Edge Functions (use pg_net only with A-03 approval)
- One Edge Function importing another Edge Function's internal modules

---

## 4. Database Schema (Canonical Table List)

> All 30 tables are defined in `supabase/migrations/20260522120000_initial_schema.sql`.
> RLS is **enabled** on all tables. RLS **policies** are pending (follow-up migration `20260522130000_rls_policies.sql`).
> Adding a new table requires **A-03 + A-05 approval**.

### Identity & User

| Table | Description | RLS Policy Status |
|-------|-------------|-------------------|
| `profiles` | Extended user data: name, avatar, `wallet_balance` (NUMERIC — see R-02 conflict), `kyc_status`, `referral_code`, fraud flags, stats | Enabled, policy pending |
| `user_settings` | Per-user UI preferences: theme, sound, haptics | Enabled, policy pending |
| `push_tokens` | FCM/APNS push notification tokens per device | Enabled, policy pending |
| `notification_preferences` | Per-channel notification opt-in flags | Enabled, policy pending |

### Admin

| Table | Description | RLS Policy Status |
|-------|-------------|-------------------|
| `admin_users` | Platform admins: role (`super_admin`, `admin`, `moderator`, `finance`, `support`), MFA | Enabled, policy pending |
| `admin_audit_log` | Immutable audit trail of all admin actions | Enabled, policy pending |

### Games & Content

| Table | Description | RLS Policy Status |
|-------|-------------|-------------------|
| `questions` | Question bank: text, choices[4], correct_index, category, difficulty, language | Enabled, policy pending |
| `show_hosts` | Live-show hosts: bio, avatar, liveKit identity, rating stats | Enabled, policy pending |
| `games` | Game lobby: mode, title, entry_fee, prize_pool, status, scheduled_at, livekit_room, `template_id` FK | Enabled, policy pending |
| `game_templates` | Recurring game spec: cron_expression (UTC), all game config fields, AI presenter fields, question filter criteria, lifecycle tracking (`current_game_id`, `last_completed_game_id`, `last_generated_at`, `total_games_generated`) | Service-role only (RLS strict) |
| `game_questions` | Ordered question list for each game | Enabled, policy pending |
| `game_participants` | Users joined to a game: score, rank, answers, entry_fee_paid, prize_earned | Enabled, policy pending |
| `game_answers` | Per-question answer record with correctness and timing | Enabled, policy pending |
| `show_host_ratings` | User ratings (1–5) for show hosts per game | Enabled, policy pending |

### Finance

| Table | Description | RLS Policy Status |
|-------|-------------|-------------------|
| `transactions` | **Append-only** financial ledger: topup, withdrawal, game_entry_fee, prize, referral_bonus, refund, admin_adjustment | Enabled, policy pending |
| `withdrawals` | Withdrawal requests with method, status, AML flag, review trail | Enabled, policy pending |
| `kyc_requests` | KYC document submission: doc_type, image URLs, status, attempt_number (max 3) | Enabled, policy pending |
| `aml_flags` | AML flag records for users with suspicious withdrawal patterns | Enabled, policy pending |

### Referrals

| Table | Description | RLS Policy Status |
|-------|-------------|-------------------|
| `referral_codes` | Referral codes: owner, type (user/promo/campaign), bonus_amount, expiry | Enabled, policy pending |
| `referral_uses` | Records of each referral code use, linking referrer and referred user | Enabled, policy pending |

### Vouchers

| Table | Description | RLS Policy Status |
|-------|-------------|-------------------|
| `vouchers` | Platform and affiliate vouchers: reward type, usage limits, validity window, rate limiting | Enabled, policy pending |
| `voucher_announcements` | In-game voucher announcements with show timer and redemption count | Enabled, policy pending |
| `voucher_redemptions` | Per-user redemption records with reward applied flag and transaction reference | Enabled, policy pending |
| `voucher_attempt_log` | All voucher entry attempts (success and failure) for fraud/abuse detection | Enabled, policy pending |

### Communications

| Table | Description | RLS Policy Status |
|-------|-------------|-------------------|
| `notification_broadcasts` | Admin-sent bulk notifications with segment filter and delivery stats | Enabled, policy pending |
| `notifications` | Per-user in-app notifications: type, read status, push delivery flag | Enabled, policy pending |
| `support_tickets` | User support tickets with category, status, assignment | Enabled, policy pending |
| `support_ticket_messages` | Thread messages on support tickets from user or admin | Enabled, policy pending |

### Content & Config

| Table | Description | RLS Policy Status |
|-------|-------------|-------------------|
| `app_config` | Key-value platform configuration (string/number/boolean/json typed) | Enabled, policy pending |
| `help_articles` | Multi-language help centre articles with publish flag | Enabled, policy pending |
| `tos_versions` | Terms of Service and Privacy Policy versions with multi-language content | Enabled, policy pending |
| `tos_acceptances` | Per-user TOS acceptance records | Enabled, policy pending |

---

## 5. Architectural Decisions Log

| Date | Decision | Rationale | Approved By |
|------|----------|-----------|-------------|
| 2026-05-22 | Use Supabase Edge Functions (Deno) for all business logic | Colocation with DB, JWT auth built-in, no separate server to manage | A-03 |
| 2026-05-22 | All money in integer cents (R-02) | Avoid floating-point rounding errors in financial calculations | A-05 |
| 2026-05-22 | Atomic game join via PostgreSQL RPC | Guarantee consistency between wallet debit and participant insert | A-05 |
| 2026-05-22 | KYC documents stored in Supabase Storage (not DB) | Avoid bloating DB with binary data; Storage has fine-grained access policies | A-03 |
| 2026-05-22 | **[OPEN CONFLICT]** Initial schema uses `NUMERIC(12,2)` for money columns, matching the Data Schema Google Sheet, despite R-02 mandating integer cents | Sheet is the immediate source of truth; R-02 conflict requires human + A-05 resolution. Two options: (a) amend R-02 to allow NUMERIC(12,2) or (b) refactor to BIGINT cents columns. Tracked as P0 blocker in Open_Tasks_AI.md | Pending |
| 2026-05-22 | Wallet balance embedded in `profiles.wallet_balance` (not a separate `wallets` table) | Data Schema sheet defines balance as a column in profiles; no separate wallets table in the schema | A-03 |
| 2026-05-22 | `database.types.ts` is the canonical TypeScript type file (replaces planned `types.ts`) | Naming aligns with Supabase codegen conventions and clearly identifies the file's purpose | A-03 |
| 2026-05-31 | Use native Deno AMQP client (`deno.land/x/amqp`) for Game Orchestrator | Resolves TLS handshake issues found with Node-compat `amqplib`. Native `Deno.connectTls` correctly handles CloudAMQP SNI requirements. Transitive dependency `BufReader` from `jsr:@std/io` is pinned to `0.224.9` via `deno.json` import map | A-03 |

| 2026-05-30 | Game Template Engine v1 added as a new top-level module | Recurring/scheduled games with cron-based generation, filter-based question selection, and AI presenter integration. Spans schema (`game_templates`), Edge Functions (`admin-game-templates`, `admin-liveavatar`), shared helper (`_shared/rabbitmq.ts`), Docker service (`deploy/template-generator`), and admin UI (`admin/src/app/(app)/templates/`) | A-03 |
| 2026-05-30 | Cron loop runs in a dedicated Docker service (`template-generator`) rather than `pg_cron` | Keeps the database free of background scheduling concerns; the Deno loop polls `cron_tick_templates()` RPC every 60 s and is independently restartable. Import direction: `template-generator` → Postgres RPCs only (no Edge Function dependency) | A-03 |
| 2026-05-30 | AI presenter dispatch uses RabbitMQ Management HTTP API (`_shared/rabbitmq.ts`) as a best-effort publish | Avoids hard-coupling the game lifecycle to broker availability — failure is logged in `admin_audit_log` but never rolls back the start transition. `admin-games` → `_shared/rabbitmq.ts` is allowed; reverse direction is forbidden | A-03 |
| 2026-05-30 | Templated games are constrained to `mode=live` and start in `status=upcoming` | Matches product decision: only live, AI-hosted shows are auto-generated; manual lobby-style games remain admin-created. Enforced inside `generate_game_from_template` RPC | A-05 |
