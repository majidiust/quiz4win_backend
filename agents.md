# Quiz4Win Backend — Agent Registry & Coordination Framework

Last updated: 2026-05-22

---

## 1. Agent Registry

| ID  | Agent File | Role | Authority |
|-----|-----------|------|-----------|
| A-01 | `agents/augment_code_agent_integration.md` | Primary Builder | Write code, create/edit files, run tests, install packages |
| A-02 | `agents/project_memory_guardian.md` | Rules & Audit | Enforce rules, maintain `Change_Log_AI.md`, flag violations |
| A-03 | `agents/architecture_agent.md` | Structure | Own `Architecture_Map.md`, approve new modules/directories |
| A-04 | `agents/refactor_agent.md` | Quality | Identify tech-debt, propose and apply refactors |
| A-05 | `agents/domain_validation_agent.md` | Compliance | Enforce business invariants (INV-*), approve financial logic |

---

## 2. Global Memory — `/project-brain/` Map

| File | Owner | Purpose |
|------|-------|---------|
| `project-brain/Rules.md` | A-02 | Universal, non-negotiable rules (R-01 to R-10) |
| `project-brain/Architecture_Map.md` | A-03 | System topology, module boundaries, import directions |
| `project-brain/Domain_Knowledge.md` | A-05 | Business logic, invariants (INV-*), game/finance rules |
| `project-brain/Coding_Standards.md` | A-01 | TypeScript/Deno style, security patterns, test conventions |
| `project-brain/Collaboration_Protocol.md` | A-02 | Message prefixes, handoff flows, conflict escalation |
| `project-brain/Change_Log_AI.md` | A-02 | Append-only chronological audit trail |
| `project-brain/Open_Tasks_AI.md` | A-01 | Priority queue (P0–P3) of outstanding work |

> **All agents MUST read every file in `/project-brain/` before starting any task.**
> Agents touching game flow, orchestrator, or game-session code MUST also read **`docs/game-logic.md`** (event timing, scoring formula, elimination rules, Redis TTLs).

---

## 3. Shared Rules (Summary — see `Rules.md` for full text)

| ID | Rule |
|----|------|
| R-01 | Never expose secrets or PII in logs, responses, or comments |
| R-02 | All monetary values stored as **integer cents** — no floats |
| R-03 | Every Edge Function validates the Supabase JWT before any DB write |
| R-04 | RLS policies are mandatory — no `service_role` bypass in app code |
| R-05 | Financial transactions are **append-only** — never UPDATE or DELETE |
| R-06 | No cross-module reverse imports (see Architecture_Map.md) |
| R-07 | Every PR/change logged in `Change_Log_AI.md` before merging |
| R-08 | KYC must be `verified` before withdrawal is processed |
| R-09 | Wallet balance debit and game join are a single atomic DB transaction |
| R-10 | No agent may override another agent's authority domain without escalation |
| R-11 | Locked-down auth & Redis wiring — `getPublicClient()` on `/auth/v1/*`, flat `${REDIS_PASSWORD}` expansion in `docker-compose.yml`, CRLF-free `.env`; changes require `[BLOCKED]` task + human approval |
| R-12 | Migrations applied exclusively by `db-maintainer` container — never `supabase db push`, `psql -f`, or any manual SQL; deploy with `docker compose up -d --force-recreate db-maintainer` |
| R-13 | `supabase` CLI is banned from all instructions, scripts, and docs — use Docker Compose equivalents only |
| R-14 | No Supabase SDK (`createClient`) in Docker-deployed backend services — all DB access via `dbSelect` / `dbInsert` / `dbUpdate` / `dbRpc` PostgREST helpers |


---

## 4. Task Assignment Logic

```
New task arrives
  ├─ Financial / game logic change? → A-05 reviews first, then A-01 implements
  ├─ New directory / module? → A-03 approves structure, A-01 implements
  ├─ Refactor / cleanup? → A-04 proposes, A-01 implements
  ├─ Rule or audit concern? → A-02 flags, all agents pause until resolved
  └─ Default implementation task → A-01 leads
```

---

## 5. Communication Protocol — `Change_Log_AI.md`

- **Format:** `[YYYY-MM-DD] [AGENT-ID] [PREFIX] Message`
- **Prefixes:**
  - `[BUILD]` — new feature or implementation
  - `[FIX]` — bug fix
  - `[REFACTOR]` — code quality improvement (no behaviour change)
  - `[RULE]` — rule enforcement or violation flagged
  - `[ARCH]` — architectural decision
  - `[DOMAIN]` — business invariant enforced or updated
  - `[AUDIT]` — audit trail entry
  - `[TASK]` — task queue update

---

## 6. Conflict Resolution

1. **Rule conflict:** A-02 (Rules Guardian) has final say; escalate to human if unresolved in 1 round.
2. **Architecture conflict:** A-03 mediates; documents decision in `Architecture_Map.md`.
3. **Domain/business conflict:** A-05 mediates; documents in `Domain_Knowledge.md`.
4. **Tie-breaker:** Human developer has absolute veto on all conflicts.
5. **Blocked tasks:** Mark as `[BLOCKED]` in `Open_Tasks_AI.md` with reason; do not proceed.

---

## 7. Agent Onboarding Checklist

Every agent session MUST complete this checklist before touching any file:

- [ ] 1. Read `project-brain/Rules.md` in full
- [ ] 2. Read `project-brain/Architecture_Map.md`
- [ ] 3. Read `project-brain/Domain_Knowledge.md`
- [ ] 3a. Read `docs/game-logic.md` (game flow, event timing, scoring, Redis TTLs — required for any orchestrator or game-session task)
- [ ] 4. Read `project-brain/Coding_Standards.md`
- [ ] 5. Read `project-brain/Collaboration_Protocol.md`
- [ ] 6. Read last 10 entries in `project-brain/Change_Log_AI.md`
- [ ] 7. Check `project-brain/Open_Tasks_AI.md` for your assigned work
- [ ] 8. Confirm your agent role and authority in this file (§1)
- [ ] 9. Identify if task requires cross-agent coordination (§4)
- [ ] 10. Log session start in `Change_Log_AI.md` with `[AUDIT]` prefix

---

## 8. Live API Testing — Test Account

When an agent needs to verify a developed API endpoint against the **production** deployment at `https://api.quiz4win.com`, it MUST use the dedicated test account stored in `.env`:

| Variable | Purpose |
|----------|---------|
| `TEST_USER_EMAIL` | Email for the shared test account |
| `TEST_USER_PASSWORD` | Password for the shared test account |

**Rules:**
- Read both values from `.env` at runtime — **never hardcode** them in scripts or source files (R-01).
- Use `scripts/test-login.py` as the reference smoke-test; it reads credentials from `.env`, calls `POST /auth/signin`, and prints only metadata (HTTP status, token presence, user ID) — never the secret values.
- If `POST /auth/signin` returns `401 invalid_credentials`, run the R-11.3 diagnostic **before** assuming wrong credentials:
  1. Probe GoTrue directly: `python3 scripts/test-login.py` output will distinguish a stale container key from a bad password.
  2. If GoTrue accepts the key and the credentials directly but the app returns 401 → run `bash scripts/deploy-api.sh` on the production server to force-recreate the `api` container.
- **Never share or print** `TEST_USER_PASSWORD` in logs, comments, `Change_Log_AI.md` entries, or agent responses.
