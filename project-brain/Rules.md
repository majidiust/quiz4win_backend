# Quiz4Win Backend — Universal Rules

Last updated: 2026-05-22 (rev 2)
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
