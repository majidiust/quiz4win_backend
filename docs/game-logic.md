# Quiz4Win — Game Logic & Event Timing Reference

**Audience:** Backend engineers, AI agents, QA.  
**Sources of truth:** `deploy/game-orchestrator/orchestrator.ts`, `supabase/functions/_shared/redis_scripts.ts`, `docs/livekit-events.md`.

---

## 1. Game Status Lifecycle

```
upcoming ──► open (join window) ──► live (running) ──► completed
                                                    └──► cancelled (full refund)
```

| Status | Meaning |
|--------|---------|
| `upcoming` | Scheduled, not yet accepting joins |
| `open` | Join window open; `entry_fee` deducted atomically on join (R-09) |
| `live` | Orchestrator has started the Redis game hash; questions are running |
| `completed` | All questions done; prizes distributed; `games.ended_at` set |
| `cancelled` | Aborted before going live; all entry fees refunded (INV-09) |

`entry_fee` and `prize_pool` are **immutable** once `status = live` (INV-03).

---

## 2. Run Modes

| Mode | Who advances questions | `QUESTION_PREPARED` emitted? |
|------|------------------------|------------------------------|
| `auto` | Orchestrator timer (fully automatic) | No |
| `presenter` | Explicit RabbitMQ commands (`PrepareQuestion`, `StartQuestion`, `CloseQuestion`) | Yes — private unicast to presenter identity |

---

## 3. Auto Mode — Full Event Timeline

> Default values: `PREGAME_WARMUP_MS = 120 000 ms`, `time_per_question = 10 s`, `grace_period_ms = 400 ms`, inter-question delay = 3 000 ms.

```
T+0 ms       GAME_STARTED broadcast
             → Redis game hash initialised (gameStatus=running)
             → games.status → live, games.first_question_starts_at set
             → Question pre-generation (prefillQueue, 3 questions) runs in background

T+0 .. T+120 000 ms   PREGAME WARMUP
             → Clients render "Get ready" countdown to firstQuestionStartsAt
             → OpenAI generates question queue behind the countdown

────── Question loop (repeats for each question index 0 … N-1) ──────

T+120 000 ms QUESTION_STARTED (Q0)
             → Redis: currentQuestionStatus = active
             → startsAt = T+120 000, endsAt = T+120 000 + timeLimitSeconds*1000
             → Answer buttons enabled on client

T+120 000 .. T+130 000 ms   ANSWER WINDOW (10 s default)
             → SUBMIT_ANSWER accepted while now ≤ endsAt + gracePeriodMs
             → Late submissions (now > endsAt + gracePeriodMs) → rejected "late"
             → PLAYER_WRONG_ANSWER emitted immediately on wrong submission
             → PLAYER_ELIMINATED emitted immediately if lives exhausted

T+130 000 ms   endsAt reached (client disables answer buttons)

T+130 400 ms   grace period ends (400 ms)
               + 50 ms buffer → closeQuestion() fires

T+130 450 ms QUESTION_CLOSED broadcast
             → correctOptionId revealed
             → No-answer sweep: SDIFF(participants, questionAnswered) → charges wrong/eliminated
             → Ghost-participant sweep (§7): DB-only players charged
             → PLAYER_WRONG_ANSWER / PLAYER_ELIMINATED emitted per no-answer player
             → Stats: eliminatedCount, activeSurvivorCount, projectedPrizePerSurvivor

T+133 450 ms   3 000 ms inter-question pause ends

T+133 450 ms QUESTION_STARTED (Q1)    [loop continues…]

────── After last question (index N-1) ──────

GAME_ENDED broadcast
             → games.status → completed, games.ended_at set
             → distribute_prizes RPC called (idempotent)

GAME_RESULT broadcast  (immediately after distribute_prizes succeeds)
             → totalWinners, sharePerWinner, winners[], distributedAt
             → games.result_summary persisted (REST fallback for clients who miss the event)

Redis game hash TTL reduced to 1 hour (was 24 h).
```

### Auto-mode timing formula

| Moment | Formula |
|--------|---------|
| `firstQuestionStartsAt` | `T_start + PREGAME_WARMUP_MS` |
| `endsAt` (per question) | `startsAt + timeLimitSeconds × 1000` |
| Answer deadline | `endsAt + gracePeriodMs` |
| Close timer fires | `timeLimitSeconds × 1000 + gracePeriodMs + 50 ms` after `startsAt` |
| Next `QUESTION_STARTED` | `closedAt + 3 000 ms` |

---

## 4. Presenter Mode — Full Event Timeline

```
RabbitMQ: StartGame
  → GAME_STARTED broadcast (firstQuestionStartsAt = null)
  → prefillQueue runs in background

RabbitMQ: PrepareQuestion
  → Question dequeued / generated
  → Stored in Redis staged hash (NOT yet active)
  → QUESTION_PREPARED → private unicast to presenterIdentity
    (carries correctOptionId — never broadcast to players)

RabbitMQ: StartQuestion
  → ACTIVATE_Q_SCRIPT: staged → active question state
  → QUESTION_STARTED → public broadcast (no correctOptionId)
  → Auto-close timer armed at timeLimitSeconds + gracePeriodMs + 50 ms

  [answer window — identical to auto mode]

RabbitMQ: CloseQuestion  (OR auto-close timer fires)
  → QUESTION_CLOSED broadcast
  → No-answer sweep (same as auto mode)
  → Orchestrator WAITS for next PrepareQuestion command

RabbitMQ: AdvanceQuestion  (alias — triggers PrepareQuestion + StartQuestion in sequence)

After maxQuestions:
  → GAME_ENDED + GAME_RESULT  (same as auto mode)
```

---

## 5. Answer Window — Submission Rules & Scoring

**Acceptance criteria (all must pass — atomic Lua `SUBMIT_ANSWER_SCRIPT`):**

| Check | Rejection reason |
|-------|-----------------|
| User has Redis state | `not_joined` |
| `userStatus == "participant"` | `<status>_cannot_answer` |
| `gameStatus == "running"` | `game_not_running` |
| `questionId` matches active question | `question_not_active` |
| `currentQuestionStatus == "active"` | `question_closed` |
| `now ≤ endsAt + gracePeriodMs` | `late` |
| Not a duplicate submission | `duplicate` |

**Scoring formula (correct answers only):**
```
points = max(10, 100 − floor(responseTimeMs / 100))
```
| Response time | Points |
|---------------|--------|
| 0 ms | 100 |
| 500 ms | 95 |
| 5 000 ms | 50 |
| 9 000 ms | 10 (floor) |

Wrong answers: 0 points, `wrongCount + 1`, `remainingLives − 1`.  
Idempotency: accepted result cached in Redis for **300 s** (`SET … EX 300`).

---

## 6. Wrong Answer & Elimination Rules (INV-14)

A player is eliminated when **either** condition is met:
- `remainingLives` reaches **0** (life-based mode)
- `wrongCount > maxWrongAnswers` (count-based mode)

Both conditions are evaluated atomically in Lua. `maxWrongAnswers = null` means no elimination by wrong answers.

**Elimination triggers:**

| Trigger | When | LiveKit events emitted |
|---------|------|----------------------|
| Wrong submission | Immediately after `SUBMIT_ANSWER` | `PLAYER_WRONG_ANSWER` + (if eliminated) `PLAYER_ELIMINATED` + `USER_ELIMINATED` (legacy) |
| No answer at close | During `closeQuestion` no-answer loop | Same |
| Ghost-participant sweep | During `closeQuestion` (§7) | Same |
| Late-join demotion | At `/join` time | `PLAYER_ELIMINATED` with `lateJoin:true` |

On elimination:
1. `sRem(participants, userId)` — excluded from future no-answer SDIFF
2. DB PATCH: `participant_role=eliminated`, `eliminated=true`, `eliminated_at`, `elimination_reason`
3. Broadcast `PLAYER_ELIMINATED` (+ legacy `USER_ELIMINATED`)

---

## 7. Ghost-Participant Sweep

Runs at every `QUESTION_CLOSED` after the Redis no-answer loop.

**Ghost** = has a `game_participants` DB row (`role=player`, `eliminated=false`, `participant_role NOT IN (spectator,eliminated)`) but is absent from the Redis `participants ∪ spectators` sets.

Algorithm:
1. `SMEMBERS(participants) ∪ SMEMBERS(spectators)` → Redis-known set
2. DB query → all active players for the game
3. Difference → ghost users
4. For each ghost: `wrongCount+1`, `remainingLives−1`; eliminate if limit reached
5. DB-updates + `PLAYER_WRONG_ANSWER` / `PLAYER_ELIMINATED` broadcasts

---

## 8. Late-Join Logic (`first_question_only` policy)

```
missed = currentQuestionIndex + 1
  (in-progress question counts — it started before player arrived)

if missed < maxWrongAnswers:
  → join as participant, remainingLives = maxWrongAnswers − missed
  → in-progress question blocked (SADD userAnswers currentQuestionId)
  → PLAYER_WRONG_ANSWER broadcast with reason=NO_ANSWER, wrongAnswersCount=missed

if missed ≥ maxWrongAnswers:
  → join as spectator, eliminated=true, elimination_reason=late_join_missed
  → PLAYER_ELIMINATED broadcast with lateJoin:true
```

`any_time` policy: no penalty for questions before join. `closed` policy: join rejected.

Ghost-sweep pre-charged path: when the ghost sweep already charged a player for
closed questions, `ARGV[6]/ARGV[7]` pre-load those values so the Lua script
only charges the currently-active question (`+1`), preventing double-counting.

---

## 9. State Recovery & Snapshot

### Orchestrator restart (`recoverRunningGames`)

On startup the orchestrator queries all `status=live` games and:
- Re-broadcasts `GAME_STARTED` with `recovered:true` so clients re-sync the countdown
- Re-arms the question loop from the current `currentQuestionIndex`
- Back-fills any static Redis fields that may be missing (e.g. from pre-deploy games)

### Client (re)connect snapshot

Both `POST /game-session/:id/join` and `GET /game-session/:id/state` return a `snapshot` field containing:

| Sub-object | Fields |
|-----------|--------|
| `game` | gameId, gameStatus, runMode, category, languages, questionsCount, title, prizePool, prizePoolCurrency, projectedPrizePerSurvivor, pregameDurationMs, firstQuestionStartsAt |
| `stats` | participantCount, spectatorCount, eliminatedCount, activeSurvivorCount |
| `currentQuestion` | questionId, questionIndex, status, startsAt, endsAt, remainingTimeMs, localized (no correctOptionId) — `null` between questions |
| `me` | userStatus, wrongCount, correctCount, remainingLives, eliminated, eliminationReason, canSubmitAnswer — `null` if no Redis state |

`snapshot` is `null` only before the orchestrator has initialized Redis for the game.

---

## 10. Prize Distribution Timing

```
GAME_ENDED → distribute_prizes RPC (Postgres, idempotent)
           → GAME_RESULT LiveKit event (if distributed=true)
           → games.result_summary JSON persisted

REST fallback (for clients that missed GAME_RESULT):
  GET /games/:id/result          → {result, summary}
  GET /public-games/:id/result   → {summary}
  GET /games/history             → list of past games with participation
```

`projectedPrizePerSurvivor` during the game:
- `null` — no prize pool configured
- `0` — prize pool exists but `activeSurvivorCount = 0`
- `prizePool / activeSurvivorCount` — rounded to 2 dp

---

## 11. Redis Key Lifecycle & TTLs

| Key | Set | Expires |
|-----|-----|---------|
| `q4w:game:{id}` (game hash) | `handleStartGame` | 24 h (86 400 s); **1 h after game ends** |
| `q4w:game:{id}:q:{idx}:state` (question hash) | `PREPARE_QUESTION_SCRIPT` | 24 h |
| `q4w:game:{id}:user:{uid}` (user hash) | `JOIN_GAME_SCRIPT` | — (inherits game key TTL pattern) |
| `q4w:attempt:{id}` (idempotency cache) | `SUBMIT_ANSWER_SCRIPT` | 300 s |

---

## 12. Configuration Reference

| Env / DB column | Default | Description |
|----------------|---------|-------------|
| `PREGAME_WARMUP_MS` | `120 000` | Ms between `GAME_STARTED` and first `QUESTION_STARTED` (auto mode) |
| `games.time_per_question` | `10` s | Answer window duration per question |
| `games.grace_period_ms` | `400` ms | Extra submission window after `endsAt`; also close-timer buffer |
| `games.allowed_wrong_answers` | `null` | Max wrong answers before elimination (`null` = unlimited) |
| `games.join_policy` | `first_question_only` | `first_question_only` \| `any_time` \| `closed` |
| `games.questions_count` | `10` | Total questions per game |
| `QUESTION_REASK_COOLDOWN_SECONDS` | `604 800` (7 days) | Platform-wide question dedup window |
| `QUESTION_DEDUP_MAX_RETRIES` | `5` | Re-generation attempts before accepting a collision |
| Inter-question pause (auto) | `3 000` ms | Hardcoded delay between `QUESTION_CLOSED` and next `QUESTION_STARTED` |

---

## 13. Clock Synchronization

`serverTime` in every LiveKit event is stamped **immediately before `SendData`** (after all DB/Redis work), so it reflects the true send instant.

**Client formula:**
```
clockOffset = serverTime − Date.now()              // compute on receipt
localTarget = absoluteTimestamp − clockOffset      // schedule countdown
```
Never derive countdowns from `serverTime + duration`. Use the absolute `startsAt`/`endsAt`/`firstQuestionStartsAt` fields — they are identical for every participant.

---

## 14. Question Generation (`generateQuestion`)

Questions are produced by the OpenAI generator in `orchestrator.ts`. Generation
is driven **only** by:

| Input | Source column | Role |
|-------|---------------|------|
| `category` | `games.category` (← template) | **Primary** subject area — always honoured |
| `description` | `games.description` (← `game_templates.description`) | **Optional** focusing guidance; when empty the generator relies solely on `category` |
| `difficulty` | `games.difficulty` | Exact difficulty level |
| `targetLanguages` | `games.language` + `target_languages` | One faithful `localizedPayload` per language |

The game **title/name is NEVER an input** — `cleanTopic(games.title)` is used
only for the display `title` field in Redis, not for generation.

**Factual accuracy (mandatory):** the prompt requires exactly one verifiably
correct answer with three verifiably wrong distractors. The model must skip any
question it is not certain about rather than emit a debatable/incorrect answer.

**Answer-position randomization:** every generated question is passed through
`shuffleQuestionOptions()` (Fisher-Yates) before it is stored or broadcast. This
rewrites `correctOptionId` to the shuffled position and applies the same
permutation to all `localizedPayloads`, eliminating the LLM bias of always
placing the correct answer in option A. Option labels stay `A/B/C/D` and remain
identical across languages.

**LLM config cascade (`resolveLlmConfig`):** the `system_prompt`, `model`,
`temperature`, and `max_tokens` are resolved once at game start via a 3-tier
cascade, then threaded into every `generateQuestion` call for that game:

```
games.llm_template_id            (per-game override, highest priority)
  └─ game_templates.llm_template_id   (template override)
       └─ llm_prompt_templates.is_active = TRUE   (global default)
            └─ hardcoded DEFAULT_GEN_GUIDANCE + OPENAI_MODEL  (safety net)
```

Templates are edited in the admin panel (**LLM Templates**); no API key is ever
stored (R-01). The editable prompt is only the **guidance** half — a
non-negotiable contract is always appended by the orchestrator, so an edited
prompt can never break the subject-matching, the response parsing, or the
multi-language contract. That contract enforces: a **quality bar** (meaningful,
self-contained questions with exactly one verifiable answer and plausible
distractors), strict **category** compliance, precise **difficulty** calibration
(easy = common knowledge, medium = real familiarity, hard = expert detail), a
strong **no-repeat** rule (a genuinely different fact from every entry in the
avoid-list, not a reworded variant), and **native-quality translations** of both
the question and all options for every code in `targetLanguages` (no machine
word-for-word output, no English placeholders, option IDs identical across
languages).

**Per-game no-repeat dedup (Redis-backed):** within a single game a question is
never repeated. Asked questions are tracked in two Redis sets, replacing the old
in-memory maps so dedup survives an orchestrator restart and is shared across
replicas:

| Key | Contents |
|-----|----------|
| `q4w:game:{id}:asked_ids` | canonical `claim_question` ids already asked |
| `q4w:game:{id}:asked_hashes` | normalized question texts (fed into the generator avoid-list) |

Both sets carry a 24 h safety TTL (`ASKED_SET_TTL_SECONDS`) and are dropped to a
1 h TTL when the game ends. On collision the colliding text is added to the
avoid-list and the question is regenerated (temperature climbing per attempt) up
to `QUESTION_DEDUP_MAX_RETRIES`. A Redis outage degrades to "no within-game
dedup" rather than stalling the game — the platform-wide `claim_question`
cooldown still applies.

---

*Last updated: 2026-06-07. Owner: A-01 (Primary Builder). See also: `docs/livekit-events.md`, `docs/player-integration.md`.*
