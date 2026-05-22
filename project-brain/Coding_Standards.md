# Quiz4Win Backend — Coding Standards

Last updated: 2026-05-22 (rev 2 — synced with initial schema and database.types.ts)
Owner: A-01 (Augment Code Agent)

---

## 1. Language & Runtime

- **Edge Functions:** Deno + TypeScript (strict mode)
- **Database:** PostgreSQL 15+ (SQL migrations, PL/pgSQL functions)
- **TypeScript target:** ES2022; `"strict": true` always enabled
- **No CommonJS** — use ES module `import/export` syntax in all `.ts` files

---

## 2. TypeScript Style

### General
- Use `const` by default; `let` only when reassignment is required; never `var`
- Prefer explicit return types on all exported functions
- No `any` — use `unknown` and narrow with type guards
- No non-null assertion (`!`) on values that could legitimately be null
- Use `interface` for object shapes; `type` for unions, intersections, aliases

### Naming
| Kind | Convention | Example |
|------|------------|---------|
| Variables & functions | `camelCase` | `entryFeeCents` |
| Types & interfaces | `PascalCase` | `GameParticipant` |
| Constants | `UPPER_SNAKE_CASE` | `MAX_PLAYERS` |
| DB column references | `snake_case` strings | `"balance_cents"` |
| Edge Function files | `kebab-case/` directory + `index.ts` | `game-join/index.ts` |

### Money Fields
- **⚠️ ACTIVE CONFLICT (R-02 vs. Data Schema):** The DB schema currently uses `NUMERIC(12,2)` / `NUMERIC(10,2)` for all monetary columns (matching the Google Sheet Data Schema). Rule R-02 mandates `INT` cents. Pending human resolution — see `Open_Tasks_AI.md` P0 blocker.
- Until resolved: TypeScript money fields are typed as `number`; treat values as **decimal dollars** (e.g., `5.00`), not cents.
- Once resolved: if R-02 is upheld, rename columns to `*_cents` (e.g., `wallet_balance_cents`), change DB type to `BIGINT`, and update `database.types.ts`.
- **Never** perform floating-point arithmetic directly on money values — always use integer arithmetic or a decimal library.

---

## 3. Edge Function Structure

Every Edge Function MUST follow this template:

```typescript
import { corsHeaders } from '../_shared/cors.ts';           // <<TBD — to be created>>
import { validateJWT } from '../_shared/auth.ts';           // <<TBD — to be created>>
import { errorResponse, successResponse } from '../_shared/errors.ts'; // <<TBD — to be created>>
import type { Database } from '../_shared/database.types.ts'; // ✅ EXISTS

Deno.serve(async (req: Request) => {
  // 1. Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // 2. Validate JWT (required for all write operations)
  const { user, error: authError } = await validateJWT(req);
  if (authError) return errorResponse(authError, 401);

  try {
    // 3. Parse and validate request body
    const body = await req.json();
    // ... validate fields

    // 4. Execute business logic

    // 5. Return response
    return successResponse({ ... });
  } catch (err) {
    console.error('[function-name] error:', err);
    return errorResponse('Internal server error', 500);
  }
});
```

---

## 4. Database Conventions

### Migrations
- File naming: `YYYYMMDDHHMMSS_short_description.sql`
- Each migration is **idempotent** where possible (`CREATE TABLE IF NOT EXISTS`, `IF NOT EXISTS` on indexes)
- Every migration includes a comment block: author, date, description
- Never drop a column in production — use `is_deleted` or rename strategy after A-03 approval

### Column Conventions
| Convention | Example |
|------------|---------|
| Primary key | `id UUID PRIMARY KEY DEFAULT gen_random_uuid()` |
| Timestamps | `created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()` |
| Soft delete | `deleted_at TIMESTAMPTZ DEFAULT NULL` |
| Money (current — pending R-02 conflict) | `wallet_balance NUMERIC(12,2) NOT NULL DEFAULT 0.00` |
| Money (R-02 compliant — if adopted) | `wallet_balance_cents BIGINT NOT NULL DEFAULT 0 CHECK (wallet_balance_cents >= 0)` |
| Enums | Prefer `TEXT` with `CHECK` constraint over `CREATE TYPE` for migration flexibility |
| String arrays | `TEXT[]` (e.g., `choices TEXT[]` on `questions`, `eligible_countries TEXT[]` on `vouchers`) |
| JSONB | Used for `metadata`, `account_details`, `segment`, `data`, `attachments` — always validate shape in Edge Function |

### Shared Types
- The canonical TypeScript type file is `supabase/functions/_shared/database.types.ts` (✅ exists, 30 table interfaces)
- Import with: `import type { Database, Profile, Game, ... } from '../_shared/database.types.ts';`
- Do **not** re-define table row types inline in Edge Functions — always import from `database.types.ts`

### RLS Template
Every table gets:
```sql
ALTER TABLE public.my_table ENABLE ROW LEVEL SECURITY;

-- Users can only read/write their own rows
CREATE POLICY "user_own_rows" ON public.my_table
  FOR ALL USING (auth.uid() = user_id);
```

---

## 5. Error Handling

- All Edge Functions return JSON with consistent shape: `{ error: string }` or `{ data: T }`
- HTTP status codes: 200 success, 400 bad request, 401 unauthenticated, 403 forbidden, 409 conflict, 500 internal
- Never return raw PostgreSQL error messages to the client — map to user-safe messages
- Log full errors server-side with `console.error`

---

## 6. Security Patterns

- **Never** trust client-supplied `user_id` in request bodies — always derive from JWT
- **Always** use parameterised queries (Supabase client does this automatically)
- **Never** log or echo request headers that contain `Authorization`
- Secrets accessed via `Deno.env.get('VAR_NAME')` only — never hardcoded
- Validate all input with explicit type checks before any DB operation

---

## 7. Testing Conventions

- Test files live alongside their function: `game-join/index.test.ts`
- Use Deno's built-in test runner: `Deno.test(...)`
- Every Edge Function must have tests covering:
  - Happy path (valid JWT, valid payload)
  - Missing/invalid JWT → 401
  - Invalid payload → 400
  - Business rule violation (e.g., insufficient funds) → 409
- DB interactions in tests use a local Supabase instance (`supabase start`)
- No mocking of the DB layer — prefer integration-style tests against local DB

---

## 8. Version Control

- Branch naming: `feat/short-description`, `fix/short-description`, `refactor/short-description`
- Commit messages: `[PREFIX] Short description` matching `Change_Log_AI.md` prefixes
- No direct commits to `main` — all changes via PR
- PR description must reference the `Change_Log_AI.md` entry for the change
