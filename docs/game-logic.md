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

> Default values: `games.start_buffer_seconds = 120 s` (per-game, set on the template), `time_per_question = 10 s`, `grace_period_ms = 400 ms`, inter-question delay = a fresh random value in `[INTER_QUESTION_MIN_MS, INTER_QUESTION_MAX_MS]` (default 3 000–5 000 ms, hard-capped at 5 s, drawn per gap).
> Substitute `W = start_buffer_seconds × 1000` (ms) for the warmup duration, and `G` for the per-gap random inter-question delay, in the timeline below.

```
T+0 ms       GAME_STARTED broadcast
             → Redis game hash initialised (gameStatus=running)
             → games.status → live, games.first_question_starts_at set
             → Per-game question producer starts (fills the buffer to QUESTION_BUFFER_TARGET=2 fully-resolved questions in the background)

T+0 .. T+W ms   PREGAME WARMUP  (W = start_buffer_seconds × 1000)
             → Clients render "Get ready" countdown to firstQuestionStartsAt
             → OpenAI generates + claims + dedups questions into the buffer behind the countdown

────── Question loop (repeats for each question index 0 … N-1) ──────

T+W ms       QUESTION_STARTED (Q0)
             → Redis: currentQuestionStatus = active
             → startsAt = T+W, endsAt = T+W + timeLimitSeconds*1000
             → Answer buttons enabled on client

T+W .. T+W+10 000 ms   ANSWER WINDOW (10 s default)
             → SUBMIT_ANSWER accepted while now ≤ endsAt + gracePeriodMs
             → Late submissions (now > endsAt + gracePeriodMs) → rejected "late"
             → PLAYER_WRONG_ANSWER emitted immediately on wrong submission
             → PLAYER_ELIMINATED emitted immediately if lives exhausted

T+130 000 ms   endsAt reached (client disables answer buttons)

T+130 400 ms   grace period ends (400 ms)
               + 50 ms buffer → closeQuestion() fires

T+130 450 ms QUESTION_CLOSED broadcast
             → correctOptionId revealed
             → answerStats: per-option { optionId, count, percentage } + totalAnswers
             → nextQuestionInMs = G, nextQuestionStartsAt = closedAt + G (null after last Q)
             → No-answer sweep: SDIFF(participants, questionAnswered) → charges wrong/eliminated
             → Ghost-participant sweep (§7): DB-only players charged
             → PLAYER_WRONG_ANSWER / PLAYER_ELIMINATED emitted per no-answer player
             → Stats: eliminatedCount, activeSurvivorCount, projectedPrizePerSurvivor

T+130 450+G ms   random inter-question pause (G ∈ [3 000, 5 000] ms) ends

T+130 450+G ms QUESTION_STARTED (Q1)    [loop continues…]

────── After last question (index N-1) ──────
             → No inter-question pause after the last question (G = null);
               the game finalizes immediately after QUESTION_CLOSED.

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
| `firstQuestionStartsAt` | `T_start + start_buffer_seconds × 1000` |
| `endsAt` (per question) | `startsAt + timeLimitSeconds × 1000` |
| Answer deadline | `endsAt + gracePeriodMs` |
| Close timer fires | `timeLimitSeconds × 1000 + gracePeriodMs + 50 ms` after `startsAt` |
| Next `QUESTION_STARTED` | `closedAt + G` where `G` ∈ `[INTER_QUESTION_MIN_MS, INTER_QUESTION_MAX_MS]` (random per gap) |

---

## 4. Presenter Mode — Full Event Timeline

```
RabbitMQ: StartGame
  → GAME_STARTED broadcast (firstQuestionStartsAt = null)
  → question producer starts in background (fills buffer to QUESTION_BUFFER_TARGET=2)

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

Both conditions are evaluated atomically in Lua. `maxWrongAnswers = null` means **no elimination by wrong answers** (score-only / unlimited-lives game). In this mode, a pure no-show is never eliminated by the sweep — but they are still excluded from ranking by the Option A survivor rule (§10.1).

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

**Ghost** = has a `game_participants` DB row (`role=player`, `eliminated=false`, `participant_role NOT IN (spectator,eliminated)`) but is absent from the Redis `participants ∪ spectators` sets. A ghost is a player who paid the entry fee but **never called `/game-session/join`**.

Algorithm:
1. `SMEMBERS(participants) ∪ SMEMBERS(spectators)` → Redis-known set
2. DB query → all active players for the game
3. Difference → ghost users
4. For each ghost: `wrongCount+1`, `remainingLives−1`; eliminate if limit reached
5. DB-updates + `PLAYER_WRONG_ANSWER` / `PLAYER_ELIMINATED` broadcasts

**Important:** the sweep only increments `wrong_count` (the elimination counter) for ghosts — it intentionally never touches `wrong_answers` (the real-submission counter). This means a pure no-show always keeps `wrong_answers = 0`, which causes `compute_game_ranks` to exclude them from ranking via the Option A survivor rule (§10.1), even in games where `allowed_wrong_answers = NULL` and no elimination fires.

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
           → compute_game_ranks (internal, called by distribute_prizes)
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

### 10.1 Survivor Eligibility Rule (Option A)

`compute_game_ranks` assigns a prize rank **only** to participants who satisfy all three conditions:

| Condition | Column / Value | Purpose |
|-----------|---------------|---------|
| Not eliminated | `participant_role = 'participant' AND eliminated = FALSE` | Standard elimination filter |
| Played at least once | `correct_answers > 0 OR wrong_answers > 0` | Option A — excludes pure no-shows |

A **pure no-show** — a player who registered, paid the entry fee, but never submitted a single answer (correct or wrong) — has both counters at zero and receives `rank = NULL` and `status = 'disqualified'`. They cannot appear in any prize tier regardless of game type or elimination settings.

**Counter semantics:**

| Counter | Incremented by | NOT incremented by |
|---------|---------------|-------------------|
| `wrong_answers` | Real wrong submission (`handlePersistAnswer`) | Ghost-sweep no-answer, late-join penalty |
| `correct_answers` | Real correct submission (`handlePersistAnswer`) | — |
| `wrong_count` | Wrong submission + ghost sweep + late-join | — |

This means a player who joined and got every answer wrong has `wrong_answers > 0` and IS ranked (they participated). A player who never joined keeps `wrong_answers = 0` and is NOT ranked, even if the ghost sweep incremented their `wrong_count` across all questions.

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
| `games.start_buffer_seconds` | `120` s | Pregame warmup duration per game (copied from template); ms between `GAME_STARTED` and first `QUESTION_STARTED` in auto mode. Set on the template, propagated to the game row automatically. |
| `games.time_per_question` | `10` s | Answer window duration per question |
| `games.grace_period_ms` | `400` ms | Extra submission window after `endsAt`; also close-timer buffer |
| `games.allowed_wrong_answers` | `null` | Max wrong answers before elimination (`null` = unlimited) |
| `games.join_policy` | `first_question_only` | `first_question_only` \| `any_time` \| `closed` |
| `games.questions_count` | `10` | Total questions per game |
| `QUESTION_REASK_COOLDOWN_SECONDS` | `604 800` (7 days) | Platform-wide question dedup window |
| `QUESTION_DEDUP_MAX_RETRIES` | `5` | Re-generation attempts before accepting a collision |
| `QUESTION_BUFFER_TARGET` | `2` | Depth the per-game producer keeps the pre-resolved buffer filled to (generated + claimed + dedup-checked ahead of need) |
| `PRODUCER_IDLE_MS` | `250` ms | Producer poll interval while the buffer is already full |
| `PRODUCER_BACKOFF_MS` | `750` ms | Producer backoff after a failed generation before retrying |
| `QUESTION_POLL_MS` | `150` ms | Consumer poll interval while waiting for the producer to push a question |
| `QUESTION_WAIT_TIMEOUT_MS` | `60 000` ms | Max time the consumer waits for a question before declaring starvation and finalizing |
| `QUESTION_GEN_TEMPERATURE` | `0.9` | Base sampling temperature for generation (overridden by the LLM cascade temperature when set) |
| `QUESTION_GEN_TOP_P` | `0.95` | Nucleus-sampling `top_p` applied to every generation |
| `FACET_CACHE_TTL_SECONDS` | `604 800` (7 days) | TTL of the per-category self-expanding facet (sub-topic) list cached in Redis |
| `FACET_COUNT` | `60` | Number of sub-topics enumerated per category |
| `INTER_QUESTION_MIN_MS` | `3 000` ms | Lower bound of the random inter-question pause (auto mode) |
| `INTER_QUESTION_MAX_MS` | `5 000` ms | Upper bound of the random inter-question pause (auto mode), hard-capped at 5 s; a fresh value in `[min, max]` is drawn per gap. After the final question there is **no** pause — the game finalizes immediately after the last `QUESTION_CLOSED`. |

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

**Creative facet rotation (Phase 1):** a low temperature on a bare "category +
difficulty" prompt makes the model collapse onto the same handful of famous
facts, which is the real source of cross-game repeats. To force it across the
whole breadth of a category, every `generateQuestion` call is steered into a
randomly chosen **facet** (sub-topic) and **angle** (question style), and the
contract explicitly forbids the single most-famous fact about that facet. Facets
are **self-expanding**: the first generation for a category enumerates ~`FACET_COUNT`
sub-topics via one cheap LLM call (`enumerateFacets`), cached in Redis
(`q4w:facets:{category}`, `FACET_CACHE_TTL_SECONDS`) and in-process; a static
fallback list is used if enumeration fails so a generator outage never blocks a
game. Each dedup retry re-rolls into a **fresh** facet/angle (a new corner of the
category dodges a collision far better than re-asking the same one). Sampling
spread is raised to `QUESTION_GEN_TEMPERATURE` (`0.9`) with `QUESTION_GEN_TOP_P`
(`0.95`); the LLM-cascade temperature, when set, still overrides the base.

**Producer/consumer question buffer (§5.7):** each game runs a single
background **producer** (`startProducer`) that keeps the per-game buffer filled
to `QUESTION_BUFFER_TARGET` (default 2) with **fully-resolved** questions. A
buffered entry has already been generated, `claim_question`-claimed and
dedup-checked (including any regeneration), and is marked asked in Redis the
moment it is enqueued — so the buffered questions are mutually distinct without
extra bookkeeping. The producer starts on `StartGame`/recovery, generates during
the warmup and every answer window, idles (`PRODUCER_IDLE_MS`) while the buffer
is full, backs off (`PRODUCER_BACKOFF_MS`) on a generation error, and stops on
finalize. The **consumer** (`takeQuestion`, LIFO — `queue.pop()`, newest produced
question first) pops the next ready question;
the inter-question hot path is just *pop → write Redis → broadcast*, which keeps
the visible gap inside the 3–5 s bound. Because the consumer only needs **one**
ready question (not a full buffer), the game starts the moment the first
question is produced. If the buffer is momentarily empty the consumer waits for
the producer up to `QUESTION_WAIT_TIMEOUT_MS`; only on timeout (a wedged/failed
producer) does it finalize rather than overrun the client clock.

---

*Last updated: 2026-06-08. Owner: A-01 (Primary Builder). See also: `docs/livekit-events.md`, `docs/player-integration.md`.*
