# Quiz4Win Backend — AI Agent Change Log

Last updated: 2026-05-22
Owner: A-02 (Project Memory Guardian)

> **APPEND-ONLY.** Never edit or delete existing entries.
> Format: `[YYYY-MM-DD] [AGENT-ID] [PREFIX] Description`
> Newest entries go at the TOP of this file.

---

[2026-05-23] [A-01] [FIX] **Compatibility fix for Nginx http2 directive.** Modified `deploy/nginx/panel.quiz4win.com.conf` and `deploy/nginx/api.quiz4win.com.conf` to move `http2` into the `listen` line (e.g., `listen 443 ssl http2;`). This resolves the `unknown directive "http2"` error on Nginx versions older than 1.25.1 where `http2 on;` is not supported as a standalone directive.


[2026-05-23] [A-01] [BUILD] **Nginx deploy configs and Let's Encrypt setup script.** Created `deploy/nginx/` folder with: `panel.quiz4win.com.conf` (HTTP→HTTPS redirect + TLS proxy to 127.0.0.1:5800, security headers, streaming support), `api.quiz4win.com.conf` (same pattern proxying to 127.0.0.1:5802, CORS OPTIONS fast-path, 50 MB body limit, `/health` passthrough), and `setup.sh` — a root-level bash script that installs bootstrap HTTP configs, runs `certbot certonly --webroot` for each domain, installs the final TLS configs, reloads nginx, and registers a daily cron for auto-renewal. Script is idempotent (skips cert issuance if certs already exist, skips cron if already registered).

[2026-05-23] [A-01] [BUILD] **Dockerized admin panel and edge-functions API.** Added `admin/Dockerfile` (multi-stage Next.js standalone, node:22-alpine), `admin/.dockerignore`, and enabled `output: "standalone"` in `admin/next.config.ts`. Added `supabase/functions/_server.ts` — a Deno entrypoint that shims `Deno.serve` to capture each function's handler, dynamically imports every `<name>/index.ts` under `supabase/functions/` (skipping `_*` dirs), then runs a single dispatcher that routes `/admin/<x>/...` → handler `admin-<x>` and `/<x>/...` → handler `<x>`. Added `supabase/functions/Dockerfile` (denoland/deno:alpine, port 8000) and `.dockerignore`. Created root `docker-compose.yml` binding admin to `127.0.0.1:5800` and api to `127.0.0.1:5802` (host nginx terminates TLS for panel.quiz4win.com and api.quiz4win.com). Env wiring: `NEXT_PUBLIC_*` passed as build args + runtime env; API service maps `NEXT_PUBLIC_SUPABASE_URL` → `SUPABASE_URL` for the edge-function client. Created `.env.docker.example` and root `.dockerignore`. No new function code or schema changes.

[2026-05-22] [A-01] [BUILD] **Drizzle ORM scaffolding complete.** Installed `drizzle-orm@^0.45.2`, `postgres@^3.4.9` (runtime) and `drizzle-kit@^0.31.10`, `dotenv`, `tsx` (dev). Created `drizzle.config.ts` (reads DB URL from `.env`, targets Supavisor pooler). Ran `drizzle-kit pull` against the live DB to generate type-safe schema — output moved to `supabase/drizzle/` (schema.ts 934 lines, relations.ts 401 lines, 0000_eminent_dorian_gray.sql). Created Deno import map at `supabase/functions/deno.json`. Created `supabase/functions/_shared/db/client.ts` (Drizzle + postgres.js connection, max 1 conn, prepare=false for Supavisor) and `supabase/functions/_shared/db/index.ts` (barrel re-exporting db client + all 31 table definitions + relations). Edge Functions can now import via `import { db, profiles, games } from "../_shared/db/index.ts"`.

[2026-05-22] [A-01] [BUILD] **Initial schema migration APPLIED to remote Supabase Postgres** (project `xcvzagyszaxnnjojnlep`, region eu-west-1, PostgreSQL 17.6). 31 tables created in `public` schema, all with `ROW LEVEL SECURITY ENABLED`. Direct connection (`db.<ref>.supabase.co`) failed due to IPv6-only resolution from local network; fell back to Supavisor session-mode pooler (`aws-0-eu-west-1.pooler.supabase.com:5432`, user `postgres.<ref>`). Migration committed in a single transaction. Used temporary script `.tmp_apply_migration.py` (gitignored, reads URL from `.env`, no secrets embedded). Note: actual table count is 31, not 30 — earlier docs undercounted by one; doc updates pending.

[2026-05-22] [A-02] [RULE] R-01 VIOLATION FLAGGED: `.tmp_run.py` in repo root contains a hardcoded Google service-account private key. This file must be deleted immediately and must not be committed to git. `.gitignore` created to prevent accidental commit. Action required: run `rm .tmp_run.py .tmp_fetch.py .tmp_read_sheet.py .tmp_sheet_result.txt` and verify `git status` shows no sensitive files staged.

[2026-05-22] [A-01] [BUILD] Created `.gitignore` covering: `.env`, `.env.*`, `.tmp_*.py`, `.tmp_*.txt`, `.tmp_*.json`, Supabase temp dirs, Deno cache, Node modules, macOS/IDE artifacts.

[2026-05-22] [HUMAN] [BUILD] Supabase project credentials added to `.env` in repo root. P0 blocker "Confirm Supabase project credentials" resolved. Reminder: `.env` must be listed in `.gitignore` before any git commit (R-01 — secrets must never be committed to version control).

[2026-05-22] [A-01] [AUDIT] Synced all project-brain/ and agents/ documentation with the completed 30-table initial schema. Changes: Architecture_Map.md §2 (repo structure with actual files), §4 (full 30-table canonical list replacing placeholder 10-table list), §5 (3 new architectural decisions); Domain_Knowledge.md §2 (corrected wallet model — balance in profiles, no separate wallets table; added show hosts §2.6, vouchers §2.9; updated all game mode/status values); Domain_Knowledge.md §3 (INV-01–10 updated with correct column names; added INV-11 KYC attempt limit, INV-12 AML threshold, INV-13 voucher fraud); Coding_Standards.md (money-field conflict notice, database.types.ts import guidance, updated column conventions); Rules.md R-04 (added note on current RLS policy gap); agents/architecture_agent.md (existing 30-table list, updated checklists); agents/augment_code_agent_integration.md (added responsibility 7 for types sync, added current schema state table); agents/domain_validation_agent.md (INV count updated to 13, corrected table references, expanded red flags); agents/project_memory_guardian.md (noted known R-02 and R-04 gaps).

[2026-05-22] [A-01] [BUILD] Created supabase/functions/_shared/database.types.ts with TypeScript interfaces for all 30 tables, including string-union enum types for all CHECK-constrained columns, plus an aggregate `Database` type compatible with the Supabase client. Money fields typed as `number` to match underlying NUMERIC columns (pending R-02 conflict resolution).

[2026-05-22] [A-01] [RULE] Conflict flagged between Data Schema (Google Sheet) and Rule R-02: the sheet defines monetary columns as NUMERIC(10,2) / NUMERIC(12,2) (decimal dollars), while R-02 mandates integer cents. Initial migration follows the sheet as the immediate source of truth; final decision deferred to human + A-05 (Domain Validation). Logged as a P0 blocker in Open_Tasks_AI.md.

[2026-05-22] [A-01] [BUILD] Created supabase/migrations/20260522120000_initial_schema.sql (~746 lines, 30 tables) covering identity, admin, games/content, finance, referrals, vouchers, communications, and content/config. Every table has primary keys, FKs, CHECK constraints, indexes, and ROW LEVEL SECURITY ENABLED. RLS policies themselves are deferred to a follow-up migration.

[2026-05-22] [A-01] [ARCH] Created supabase/migrations/ and supabase/functions/_shared/ directories per Architecture_Map.md §1. No structural deviation from canonical layout.

[2026-05-22] [A-01] [BUILD] Created /agents/ directory with five agent definition files: augment_code_agent_integration.md, project_memory_guardian.md, architecture_agent.md, refactor_agent.md, domain_validation_agent.md.

[2026-05-22] [A-03] [ARCH] Created project-brain/Architecture_Map.md defining repository structure, module boundaries, import directions, canonical table list, and initial architectural decisions log.

[2026-05-22] [A-05] [DOMAIN] Created project-brain/Domain_Knowledge.md capturing 10 business invariants (INV-01 through INV-10), game lifecycle, domain concepts, and regulatory placeholders. Human input required for INV-06, INV-07, INV-08, and compliance jurisdiction.

[2026-05-22] [A-02] [RULE] Created project-brain/Rules.md with R-01 through R-10 covering secrets safety, integer cents, JWT validation, RLS enforcement, append-only transactions, import boundaries, change logging, KYC gating, atomic wallet+join, and agent authority.

[2026-05-22] [A-01] [BUILD] Created project-brain/Coding_Standards.md covering TypeScript/Deno style, Edge Function template, DB migration conventions, RLS template, error handling, security patterns, testing conventions, and version control rules.

[2026-05-22] [A-02] [BUILD] Created project-brain/Collaboration_Protocol.md defining message format, prefix semantics, handoff flows, blocking/escalation protocol, and session start/end procedures.

[2026-05-22] [A-02] [BUILD] Created project-brain/Open_Tasks_AI.md with initial priority task queue derived from framework setup, domain placeholders, and pending backend implementation work.

[2026-05-22] [A-02] [AUDIT] Multi-agent coordination framework bootstrapped for Quiz4Win backend repository. All /project-brain/ files created. All /agents/ definition files created. agents.md root registry created. Fourteen placeholders marked <<TBD by Human>> require human input before implementation can proceed. See Open_Tasks_AI.md for prioritised task list.
