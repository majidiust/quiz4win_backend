# Quiz4Win Backend — Universal Rules

Last updated: 2026-06-17 (rev 6)
Owner: A-02 (Project Memory Guardian)

> These rules are **non-negotiable**. No agent may override them. Any violation must be flagged immediately in `Change_Log_AI.md` with the `[RULE]` prefix, and all work on the affected area must halt until resolved.

---

## R-01 — Secret & PII Safety

Never expose secrets (API keys, JWT secrets, service-role keys, signing secrets, DB passwords) or personally identifiable information (email addresses, phone numbers, KYC documents, real names) in:
- Source code or configuration files committed to git
- Log statements or console output
- API response bodies to untrusted callers
- Agent messages, comments, or documentation

**Action:** Use environment variables exclusively. Reference variable names only, never values.

---

## R-02 — Integer Cents for All Money

All monetary amounts (entry fees, prize pools, wallet balances, withdrawals, top-ups) MUST be stored and processed as **integer cents** (e.g., $5.00 → `500`).

- No floating-point arithmetic on money
- No `DECIMAL` columns without explicit cent-scaled intent
- Frontend display conversion (÷100) happens only at render time

**Action:** Any new column or variable holding money must be named `*_cents` and typed `INT` (PostgreSQL) / `number` (TS, always integer-valued).

---

## R-03 — JWT Validation Before Every DB Write

Every Supabase Edge Function that performs a database write (INSERT, UPDATE, DELETE, RPC) MUST:
1. Extract the `Authorization: Bearer <token>` header
2. Validate the JWT using `supabase.auth.getUser(token)` or equivalent
3. Reject with HTTP 401 if the token is missing, expired, or invalid
4. Use the validated `user.id` — never trust a user-supplied `user_id` body field

**Action:** No exceptions. Read-only public endpoints may skip auth only with explicit A-02 sign-off.

---

## R-04 — RLS Policies Are Mandatory

Row Level Security (RLS) must be **enabled on every table** in the public schema. No table may be accessed without an active RLS policy.

- No `service_role` key usage in application/Edge Function code
- The `anon` role must only read rows that are intentionally public
- Any RLS policy granting write access must be reviewed by A-05

**Current status (2026-05-22):** All 30 tables in `20260522120000_initial_schema.sql` have `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`. RLS **policies** have not yet been written — this is a known temporary state tracked as a P1 task in `Open_Tasks_AI.md`. No production traffic may hit the DB until policies exist.

**Action:** Creating a table without a corresponding RLS policy in the same (or immediately following) migration is a violation.

---

## R-05 — Financial Transactions Are Append-Only

The `transactions` table (and any equivalent financial ledger) is **immutable**:
- No `UPDATE` or `DELETE` on completed transaction rows
- Corrections are made by inserting compensating entries with a `reversal_of` reference
- Soft-delete (`is_deleted`) is also forbidden for financial rows

**Action:** A-05 must approve any migration or function that touches existing transaction rows.

---

## R-06 — No Cross-Module Reverse Imports

Import direction is strictly:

```
mobile-app  →  edge-functions  →  supabase-db
                              →  external-apis
```

- Edge Functions may NOT import from mobile app code
- DB triggers/functions may NOT call Edge Functions directly
- Shared types live in `supabase/functions/_shared/` only

**Action:** A-03 reviews any new import path that crosses module boundaries.

---

## R-07 — Every Change Logged Before Merging

Before any branch is merged or any significant file change is committed:
1. An entry is appended to `project-brain/Change_Log_AI.md`
2. Entry format: `[YYYY-MM-DD] [AGENT-ID] [PREFIX] Message`
3. The log is **append-only** — existing entries are never edited or deleted

**Action:** A-02 audits the log on every session start. Missing entries are a P0 violation.

---

## R-08 — KYC Required for Withdrawals

No withdrawal may be processed unless the requesting user's `kyc_status` is `verified` in the database:
1. Check `kyc_status = 'verified'` **inside the Edge Function** (server-side), not just in the app
2. Return HTTP 403 with a user-friendly message if KYC is not verified
3. Do not rely solely on frontend gating

**Action:** The withdrawal Edge Function must always re-verify KYC server-side.

---

## R-09 — Atomic Wallet Debit + Game Join

Deducting the entry fee from a user's wallet and recording their game participation MUST happen in a single atomic database transaction (PostgreSQL transaction / RPC function):
- If the debit fails (e.g., insufficient funds), the join does not happen
- If the join insert fails, the debit is rolled back
- No partial state is acceptable

**Action:** Implement using a PostgreSQL `FUNCTION` called via Supabase RPC — never two separate API calls.

---

## R-10 — Agent Authority Boundaries

No agent may take actions that belong to another agent's authority domain without explicit approval:
- A-01 may not approve architectural changes (A-03 domain)
- A-01 may not approve financial logic changes (A-05 domain)
- A-04 may not introduce behaviour changes under the guise of refactoring
- Violations are escalated to the human developer immediately

**Action:** When in doubt, post a `[BLOCKED]` entry in `Open_Tasks_AI.md` and wait for the owning agent's sign-off.

---

## R-11 — Locked-Down Auth & Redis Wiring (DO NOT MODIFY)

The following code/config patterns have been debugged and fixed multiple times. They are now **frozen**. Any agent that wants to change them MUST first post a `[BLOCKED]` entry in `Open_Tasks_AI.md` with the full diagnostic from edge-function logs and wait for explicit human approval. Touching these files without approval is a rule violation and must be reverted immediately.

### R-11.1 — `getPublicClient()` for all `/auth/v1/*` calls

- `supabase/functions/_shared/supabase.ts` — the `getPublicClient()` function and its docstring (lines 27–63) are frozen.
- `supabase/functions/_shared/auth.ts` — `validateJWT` MUST call `getPublicClient()` (not `getAnonClient(req)`) before `supabase.auth.getUser(token)` (lines 53–65 with explanatory comment). The token MUST be passed explicitly to `getUser(token)`.
- `supabase/functions/auth/index.ts` — `signin`, `signup`, `token-refresh`, `verify-otp`, and the current-password check inside `update-password` MUST use `getPublicClient()`.
- Forbidden pattern (causes `Invalid API key` from GoTrue): calling `supabase.auth.*` on a client created via `getAnonClient(req)`, because `getAnonClient(req)` forwards the user's `Authorization: Bearer <jwt>` into `supabase-js` `global.headers`, overriding the SDK's default `Bearer <ANON_KEY>` on `/auth/v1/*` calls.
- Reference commits (history, do not revert past): `408cd35`, `d7754d9`, `983ea01`, `535baf6`. Audit entry: top of `Change_Log_AI.md`.

### R-11.2 — Flat `REDIS_URL` interpolation in `docker-compose.yml`

- Both the `api` service (line ~183) and the `game-orchestrator` service (line ~281) MUST use a single, flat expansion:
  ```yaml
  REDIS_URL: redis://:${REDIS_PASSWORD}@redis:6379
  ```
- Forbidden pattern (causes orchestrator `TypeError: Invalid URL: 'redis://:${REDIS_PASSWORD@redis:6379}'`): nested `${...}` inside a `${VAR:-default}`, e.g. `${REDIS_URL:-redis://:${REDIS_PASSWORD}@redis:6379}`. Docker Compose's interpolator is single-pass and mangles nested braces.
- To point at an external Redis, edit the line directly. Adding `REDIS_URL` to `.env` does NOT override service-level `environment:` and is forbidden as a workaround.
- Reference commit: `6ea4d9a`.

### R-11.3 — `.env` byte hygiene (no CRLF, no trailing whitespace)

- `.env` MUST be saved as LF-only with no trailing whitespace on any line. JWT values (e.g. `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) are signature-verified byte-exactly; a single stray `\r` or space causes GoTrue to reject with the generic `Invalid API key` — indistinguishable in the log from the code-side cause in R-11.1.
- Diagnostic before any auth code change: `docker compose exec api sh -c 'echo ${#SUPABASE_ANON_KEY}'` vs `awk -F= '/^SUPABASE_ANON_KEY=/{print length($2)}' .env` — any mismatch is the bug; do NOT touch source code.
- Repair (host-side, never in repo): `sed -i '' $'s/\r$//' .env` (macOS) / `sed -i 's/\r$//' .env` (Linux), then `docker compose up -d --force-recreate api`.
- Reference audit entry: top of `Change_Log_AI.md` (`[2026-06-05] [A-01] [AUDIT] Invalid API key — 4th documented cause`).

**Action:** Before editing any file touched by R-11.1 / R-11.2 / R-11.3, an agent MUST (a) re-read the linked commit(s) and audit entries, (b) post a `[BLOCKED]` task with the failing log line and the exact line(s) it intends to change, (c) wait for human approval. A diff that re-introduces any of the forbidden patterns above is an automatic revert target for A-02.

---

## R-12 — Database Migrations Are Applied by `db-maintainer` — Never Manually

The `db-maintainer` container is the **sole, authoritative mechanism** for applying SQL migrations to the database. No agent, script, or human operator may apply migrations by any other means.

### How it works

- `./supabase/migrations/` (host) is mounted read-only at `/migrations` inside the container.
- On every container startup, `deploy/db-maintainer/migrate.sh` scans `*.sql` files sorted by filename, checks `public.schema_migrations` for each version, and runs any unapplied file inside a single `BEGIN … COMMIT` transaction.
- A successful run writes `/tmp/db-maintainer-ready`, which unblocks the `api`, `game-orchestrator`, and `template-generator` containers (all declare `depends_on: db-maintainer: condition: service_healthy`).

### Rules

1. **All migrations go in `supabase/migrations/`** — name them `YYYYMMDDHHMMSS_description.sql`. The timestamp prefix is the sort key; order is deterministic.
2. **Never run `supabase db push`, `psql -f`, or any ad-hoc SQL** against the production database to apply a migration. Use the container.
3. **Never hardcode migration SQL in application code**, Edge Functions, or scripts outside `supabase/migrations/`.
4. **To apply new migrations**, restart the container:
   ```bash
   docker compose up -d --force-recreate db-maintainer
   ```
   All dependent services restart automatically once the healthcheck passes.
5. **Full-stack deploy** (new migration + app code change):
   ```bash
   docker compose up -d --build --force-recreate db-maintainer game-orchestrator admin api
   ```
6. **Never skip the `db-maintainer` healthcheck** by adding `--no-deps` or removing the `depends_on` condition. That guard exists so app containers never start against a stale schema.

**Action:** Any instruction, script, or changelog entry that tells an agent or developer to apply a migration manually (via `supabase db push`, `psql`, Supabase Studio SQL editor, etc.) is a rule violation. Correct it immediately and log a `[RULE]` entry in `Change_Log_AI.md`.

---

## R-13 — No Supabase CLI in Any Instruction or Script

The `supabase` CLI is **banned** from all deploy instructions, agent responses, scripts, and documentation. Every operation that the Supabase CLI might perform must be replaced with the Docker Compose equivalent:

| Banned command | Replacement |
|---|---|
| `supabase db push` | `docker compose up -d --force-recreate db-maintainer` |
| `supabase functions deploy <fn>` | Edge functions are deployed via the project's existing deploy script / CI pipeline — never via the CLI |
| `supabase start` / `supabase stop` | `docker compose up -d` / `docker compose down` |
| Any other `supabase …` sub-command | Ask the human developer for the Docker-native equivalent before proceeding |

**Action:** Any agent response or documentation that includes a `supabase …` command is a rule violation. Remove it, replace with the Docker equivalent, and log a `[RULE]` entry in `Change_Log_AI.md`.

---

## R-14 — No Supabase SDK/Client in Backend Code (Orchestrator & Workers)

All backend services that run outside the Supabase Edge Function runtime (i.e. the `game-orchestrator`, `template-generator`, and any future Docker-deployed worker) **must not** import or use the Supabase JS/TS client (`@supabase/supabase-js` or `createClient`). All database access from these services must go through the **direct PostgREST REST helpers** already established in the codebase:

- `dbSelect(table, querystring)` — SELECT
- `dbInsert(table, row)` — INSERT
- `dbUpdate(table, match, patch)` — PATCH
- `dbRpc(fn, args)` — RPC

New helpers following the same pattern may be added; importing the Supabase SDK is forbidden.

Supabase Edge Functions (inside `supabase/functions/`) are exempt because they run inside Supabase's managed runtime and receive the client via the platform injection — but even there, no new `createClient` call should be added unless strictly necessary.

**Action:** Any PR or commit that adds `@supabase/supabase-js` as a dependency to a Docker-deployed service, or calls `createClient` outside an Edge Function, is a rule violation and must be reverted.

---

## R-15 — All User File Uploads Go Through the S3 Helper

Every user-supplied file (avatars, KYC documents, host intro videos, screenshots, support attachments, and any future media) MUST be stored in the S3-compatible object store (DigitalOcean Spaces) exclusively via the shared helper at `supabase/functions/_shared/s3.ts` (`uploadObject` / `presignGet` / `deleteObject` / `buildPublicUrl`). Direct `@aws-sdk/client-s3` usage, base64-in-DB blobs, or storing files on the container filesystem are forbidden.

### R-15.1 — Server-side validation (never trust the client)

Inside the Edge Function — before calling `uploadObject` — the handler MUST:
1. Verify the JWT (R-03) and resolve the caller's identity.
2. Enforce a **maximum size** (current ceiling: `25 MB` = `MAX_FILE_BYTES`). Reject oversize with HTTP 413.
3. Validate the **MIME type** against an explicit allow-list (`ALLOWED_FILE_MIME`). Reject others with HTTP 415. Never derive trust from the file extension alone.
4. Validate the logical **file type / category** against an allow-list (e.g. `FILE_TYPES`).

### R-15.2 — Key naming convention

Object keys are server-generated, never client-supplied. Use a stable, owner-scoped, collision-proof key:

```
hosts/<host_id>/<file_type>/<timestamp>-<uuid>.<ext>     # host files (show_hosts.id)
avatars/<auth_user_id>/<timestamp>-<uuid>.<ext>          # pre-apply / onboarding avatars (no host row yet)
kyc/<user_id>/<doc_type>.<ext>                           # KYC documents
```

The extension is sanitised (lower-cased, length-capped) and the random `uuid` prevents enumeration/overwrite.

### R-15.3 — Visibility tiers

- **`public-read`** — only for content meant to be shown unauthenticated in apps: **avatars / host profile pictures**. Persist the public URL.
- **`private`** (default) — everything that is sensitive or under review: **KYC documents, host intro videos, screenshots, support attachments**. Serve these only via short-lived presigned URLs (`presignGet`); never persist a long-lived public URL for them.

When in doubt, default to `private`.

### R-15.4 — Persist the key, mint URLs on read

Always store the S3 **object key** (`s3_key`) in the database as the source of truth. For private objects, generate presigned URLs at read time. Deleting a DB row that references an object SHOULD also `deleteObject` the key (cleanup path).

**Action:** Any upload path that bypasses `uploadObject`, skips size/MIME validation, accepts a client-supplied object key, or marks sensitive content `public-read` is a rule violation. Flag it with `[RULE]` in `Change_Log_AI.md` and halt the affected upload path until corrected.

---

## R-16 — Features Must Be End-to-End Complete & Backward-Compatible

Any new feature implemented in one section of the system MUST be carried through **every** affected subdomain/layer, and MUST remain compatible with existing behaviour. A feature is not "done" when it works in a single place — it is done only when every surface that touches it is consistent.

### R-16.1 — Propagate across all subs

When a feature (a new field, status, endpoint, business rule, or capability) is introduced, the implementing agent MUST check and update **all** of these where applicable:
- **Database** — schema/migration, RLS policy, and any RPC that reads/writes the data.
- **Edge Functions / API** — every endpoint that exposes or consumes the data (customer `games`, `host`, `admin-*`, `public-*`, etc.).
- **Frontends** — every client that renders or sends it: `admin/` panel, `host-app/`, and the mobile/customer app.
- **Orchestrator / workers** — `game-orchestrator`, `template-generator`, and any consumer of the changed data.
- **Shared types & docs** — `_shared/database.types.ts`, `docs/*`, and the relevant `project-brain/` files (`Architecture_Map.md`, `Domain_Knowledge.md`).

A feature that exists in one sub (e.g. admin) but is missing in its mirror sub (e.g. host-app, or the public read endpoint) is an **incomplete feature** and is treated as a bug. (Example precedent: `usage=loser` added to admin + DB constraint but missed in `public-sounds` — logged 2026-06-08.)

### R-16.2 — Backward compatibility is mandatory

- New columns/fields are **additive** with safe defaults; never break an existing reader. Existing API response shapes and request contracts must keep working (additive only) unless a versioned, human-approved migration of all callers is performed in the same change.
- New `CHECK`/enum values must be reflected in **every** validator and read path simultaneously (see R-16.1) so an older sub never rejects a value a newer sub can produce.
- Removing or renaming a field/endpoint requires updating every caller in the same change set, plus a `[BLOCKED]` entry if any caller is outside this repo.

### R-16.3 — Completeness check before "done"

Before marking any feature complete, the agent MUST (per the Augment completeness workflow) search the codebase for **all** downstream call sites, mirror subs, and tests affected by the change, and update them — or explicitly list any deferred surface as a `[TODO]` task in `Open_Tasks_AI.md` with the reason.

**Action:** Shipping a feature in one sub while leaving a mirror sub, caller, or read path inconsistent is a rule violation. Flag it with `[RULE]` in `Change_Log_AI.md` and complete the missing surfaces (or file the explicit `[TODO]`) before the change is considered done.
