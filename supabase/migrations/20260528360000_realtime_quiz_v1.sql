-- ============================================================================
-- Migration: realtime_quiz_v1
-- Created : 2026-05-28
-- Purpose : Phase-1 schema additions to align with the WingoBingo / Quiz4Win
--           Real-Time Quiz Backend Architecture (docs/wingobingo_quiz_*.md).
--
-- Scope   :
--   - games            : server-side question lifecycle columns
--   - game_participants: spectator / elimination / session tracking
--   - questions        : stable option_ids + localized payload
--   - game_answers     : full audit-log columns (§16) + attempt idempotency
--
-- Rules   : R-05 (append-only ledger preserved), R-06 (no reverse imports)
-- ============================================================================

BEGIN;

-- ─── 1. games : real-time question lifecycle ────────────────────────────────
-- Server is the only source of truth for question timing (§11, §19.1).
ALTER TABLE public.games
    ADD COLUMN IF NOT EXISTS current_question_id        UUID
        REFERENCES public.questions(id),
    ADD COLUMN IF NOT EXISTS current_question_index     INTEGER,
    ADD COLUMN IF NOT EXISTS current_question_starts_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS current_question_ends_at   TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS current_question_closed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS grace_period_ms            INTEGER NOT NULL DEFAULT 400,
    ADD COLUMN IF NOT EXISTS join_policy                TEXT    NOT NULL DEFAULT 'first_question_only'
        CHECK (join_policy IN ('first_question_only','any_time','closed')),
    ADD COLUMN IF NOT EXISTS run_mode                   TEXT    NOT NULL DEFAULT 'auto'
        CHECK (run_mode IN ('auto','manual','live'));

-- `allowed_wrong_answers` already exists; alias it as a sanity comment.
-- NULL = unlimited mistakes, otherwise hard cap (§10).

CREATE INDEX IF NOT EXISTS idx_games_current_question_id
    ON public.games(current_question_id);

-- ─── 2. game_participants : spectator + elimination ────────────────────────
-- The architecture splits users into participant / spectator / eliminated
-- (§7, §12). The existing `eliminated` boolean and `status` enum are kept
-- for compatibility; the new `participant_role` column is authoritative.
ALTER TABLE public.game_participants
    ADD COLUMN IF NOT EXISTS participant_role   TEXT
        NOT NULL DEFAULT 'participant'
        CHECK (participant_role IN ('participant','spectator','eliminated')),
    ADD COLUMN IF NOT EXISTS wrong_count        INTEGER NOT NULL DEFAULT 0,
    -- NOTE: `lives_remaining` (INTEGER) already exists on game_participants
    --       from the initial schema; we reuse it as authoritative life counter.
    ADD COLUMN IF NOT EXISTS eliminated_at      TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS elimination_reason TEXT,
    ADD COLUMN IF NOT EXISTS session_id         TEXT,
    ADD COLUMN IF NOT EXISTS device_id          TEXT,
    ADD COLUMN IF NOT EXISTS join_question_index INTEGER;

CREATE INDEX IF NOT EXISTS idx_game_participants_participant_role
    ON public.game_participants(participant_role);
CREATE INDEX IF NOT EXISTS idx_game_participants_session_id
    ON public.game_participants(session_id);

-- ─── 3. questions : stable option_ids + localized payloads ──────────────────
-- §5.5: question identity and option IDs must remain identical across
-- languages. The client submits selectedOptionId, not the text. We back-fill
-- option_ids = ['A','B','C','D'] for existing rows.
ALTER TABLE public.questions
    ADD COLUMN IF NOT EXISTS option_ids         TEXT[],
    ADD COLUMN IF NOT EXISTS correct_option_id  TEXT,
    ADD COLUMN IF NOT EXISTS localized          JSONB,
    ADD COLUMN IF NOT EXISTS validated          BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS validation_flags   JSONB;

-- Backfill stable option_ids and correct_option_id for legacy rows.
UPDATE public.questions
   SET option_ids        = ARRAY['A','B','C','D'],
       correct_option_id = (ARRAY['A','B','C','D'])[correct_index + 1]
 WHERE option_ids IS NULL;

ALTER TABLE public.questions
    ALTER COLUMN option_ids SET NOT NULL;

-- A question must have exactly four stable option IDs and a matching
-- correct_option_id. The check is deferred so the back-fill above succeeds
-- before the constraint is enforced.
ALTER TABLE public.questions
    ADD CONSTRAINT questions_option_ids_len
        CHECK (array_length(option_ids, 1) = 4),
    ADD CONSTRAINT questions_correct_option_id_in_set
        CHECK (correct_option_id = ANY(option_ids));

-- ─── 4. game_answers : full audit log (§16) + idempotency ───────────────────
ALTER TABLE public.game_answers
    ADD COLUMN IF NOT EXISTS attempt_id              UUID,
    ADD COLUMN IF NOT EXISTS selected_option_id      TEXT,
    ADD COLUMN IF NOT EXISTS correct_option_id       TEXT,
    ADD COLUMN IF NOT EXISTS server_received_at      TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS question_starts_at      TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS question_ends_at        TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS was_late                BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS was_duplicate           BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS was_no_answer           BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS user_status_before      TEXT,
    ADD COLUMN IF NOT EXISTS user_status_after       TEXT,
    ADD COLUMN IF NOT EXISTS wrong_count_before      INTEGER,
    ADD COLUMN IF NOT EXISTS wrong_count_after       INTEGER,
    ADD COLUMN IF NOT EXISTS remaining_lives_before  INTEGER,
    ADD COLUMN IF NOT EXISTS remaining_lives_after   INTEGER,
    ADD COLUMN IF NOT EXISTS elimination_reason      TEXT,
    ADD COLUMN IF NOT EXISTS ip_address              TEXT,
    ADD COLUMN IF NOT EXISTS user_agent              TEXT,
    ADD COLUMN IF NOT EXISTS session_id              TEXT;

-- Idempotency (§14.3): a given attempt_id from a participant must be unique.
-- Partial index allows legacy rows without attempt_id to coexist.
CREATE UNIQUE INDEX IF NOT EXISTS uq_game_answers_attempt
    ON public.game_answers(participant_id, attempt_id)
    WHERE attempt_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_game_answers_server_received_at
    ON public.game_answers(server_received_at);
CREATE INDEX IF NOT EXISTS idx_game_answers_was_late
    ON public.game_answers(was_late);

-- ─── 5. RLS policy refresh ───────────────────────────────────────────────────
-- Existing participant SELECT policies continue to cover the new columns.
-- The audit-log columns (ip, user_agent, etc.) are PII; only the row's
-- own participant or service_role may read them — that matches the
-- existing per-participant USING clauses.

COMMIT;
