# Quiz4Win Backend — Collaboration Protocol

Last updated: 2026-05-22
Owner: A-02 (Project Memory Guardian)

---

## 1. Message Format

All entries in `Change_Log_AI.md` and all agent-to-agent communications MUST follow:

```
[YYYY-MM-DD] [AGENT-ID] [PREFIX] Short description of action or decision
```

**Example:**
```
[2026-05-22] [A-01] [BUILD] Implemented game-join Edge Function with atomic wallet debit via RPC
[2026-05-22] [A-05] [DOMAIN] Confirmed INV-02 satisfied; atomic RPC approved
[2026-05-22] [A-03] [ARCH] Added game-join/ to Architecture_Map.md §2 directory tree
```

---

## 2. Prefix Semantics

| Prefix | Meaning | Who Uses It |
|--------|---------|-------------|
| `[BUILD]` | New feature, function, or file implemented | A-01 |
| `[FIX]` | Bug fix (behaviour was wrong, now correct) | A-01 |
| `[REFACTOR]` | Code quality improvement with no behaviour change | A-01, A-04 |
| `[RULE]` | Rule enforcement action or violation flagged | A-02 |
| `[ARCH]` | Architectural decision recorded or structure changed | A-03 |
| `[DOMAIN]` | Business invariant enforced, updated, or clarified | A-05 |
| `[AUDIT]` | Session start/end, review completion, compliance check | A-02 |
| `[TASK]` | Task queue updated (added, completed, re-prioritised) | Any |
| `[BLOCKED]` | Work halted pending resolution (include reason) | Any |

---

## 3. Handoff Flows

### 3.1 Standard Implementation Task
```
1. A-01 reads /project-brain/ files (onboarding checklist)
2. A-01 logs [AUDIT] session start
3. If task touches financial logic → A-05 reviews spec first → logs [DOMAIN] approval
4. If task creates new module/directory → A-03 approves → logs [ARCH] decision
5. A-01 implements → logs [BUILD] or [FIX]
6. A-01 marks task DONE in Open_Tasks_AI.md → logs [TASK]
7. A-02 audits Change_Log_AI.md on next session → logs [AUDIT] if compliant
```

### 3.2 Rule Violation Detected
```
1. Any agent detects violation
2. Agent logs [RULE] VIOLATION in Change_Log_AI.md immediately
3. All work on affected area halts
4. A-02 investigates and determines remediation
5. A-02 logs [RULE] RESOLVED with description of fix applied
6. Work resumes only after A-02 sign-off
```

### 3.3 Architectural Change Request
```
1. A-01 or A-04 identifies need for new module/table/directory
2. Agent posts [BLOCKED] in Open_Tasks_AI.md with description
3. A-03 reviews and either approves (logs [ARCH] APPROVED) or rejects (logs [ARCH] REJECTED + reason)
4. If approved, A-01 implements; A-03 updates Architecture_Map.md
```

### 3.4 Domain/Financial Logic Change
```
1. A-01 flags need in Open_Tasks_AI.md
2. A-05 reviews against Domain_Knowledge.md invariants
3. A-05 logs [DOMAIN] APPROVED or [DOMAIN] BLOCKED with reason
4. If approved, A-01 implements; A-05 updates Domain_Knowledge.md if invariants change
```

---

## 4. Blocking & Escalation

- Any agent may mark a task `[BLOCKED]` — include the blocking reason and the agent whose sign-off is needed
- Blocked tasks sit in `Open_Tasks_AI.md` with status `[BLOCKED]`
- If a blocking agent does not respond in the same session, escalate to **human developer**
- Human developer has absolute veto and final decision authority on all conflicts
- Human decisions are logged as `[2026-MM-DD] [HUMAN] [ARCH|DOMAIN|RULE] Decision text`

---

## 5. Session Start Protocol

Every agent session begins with:

```
1. Read all /project-brain/ files (in order listed in agents.md §7)
2. Write to Change_Log_AI.md:
   [YYYY-MM-DD] [A-XX] [AUDIT] Session started. Reviewing Open_Tasks_AI.md.
3. Check Open_Tasks_AI.md for assigned/priority tasks
4. Begin work on highest-priority non-blocked task
```

---

## 6. Session End Protocol

Before ending a session, every agent:

```
1. Ensures all actions taken are logged in Change_Log_AI.md
2. Updates Open_Tasks_AI.md (mark completed tasks, add new tasks discovered)
3. Writes to Change_Log_AI.md:
   [YYYY-MM-DD] [A-XX] [AUDIT] Session ended. Tasks completed: [list]. Remaining: [count].
```

---

## 7. Communication Tone & Scope

- Entries in `Change_Log_AI.md` are factual and concise (1–3 sentences max per entry)
- No speculative or "intent" entries — only log actions actually taken or decisions actually made
- Do not edit existing log entries — append only
- If an entry was wrong, add a correction entry: `[FIX] Correcting prior entry [YYYY-MM-DD]: ...`
