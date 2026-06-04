# Quiz4Win Backend — Universal Rules

Last updated: 2026-06-05 (rev 3)
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
