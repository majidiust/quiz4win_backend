-- Migration: question de-duplication + re-ask cooldown.
--
-- Author: A-01 (Augment Code Agent)  Date: 2026-06-03
-- Domain invariant (A-05): no duplicate question is asked across the platform
-- within a configurable cooldown window, and a question is never repeated
-- inside a single game. There is no curated question bank — every live
-- question is generated on the fly by the orchestrator, so de-duplication is
-- enforced cheaply at the DB layer via a content hash + last_asked_at.
--
-- Adds:
--   * questions.content_hash  — STORED generated md5 of normalized text.
--   * questions.last_asked_at — last time the question was broadcast.
--   * Partial unique index on content_hash WHERE deleted_at IS NULL.
--   * Index on last_asked_at for fast cooldown checks.
--   * claim_question(...)     — SECURITY DEFINER RPC: atomic look-up / insert
--                               that returns was_recent=TRUE when the question
--                               was asked inside the cooldown (caller re-rolls).
--   * generate_game_from_template — picker now prefers questions outside the
--                               cooldown window and bumps last_asked_at.

BEGIN;

-- ─── 1. Schema: content_hash (generated) + last_asked_at ─────────────────────
-- Normalization: trim, collapse internal whitespace, lower-case, then md5.
-- All component functions are IMMUTABLE so the column can be STORED.
ALTER TABLE public.questions
    ADD COLUMN IF NOT EXISTS content_hash TEXT
        GENERATED ALWAYS AS (md5(lower(regexp_replace(btrim(text), '\s+', ' ', 'g')))) STORED,
    ADD COLUMN IF NOT EXISTS last_asked_at TIMESTAMPTZ;

-- ─── 2. Soft-delete pre-existing duplicate-content rows ──────────────────────
-- Keep the earliest (oldest created_at) active row per content_hash; soft-
-- delete the rest so the partial unique index can be created cleanly. Existing
-- game_questions FK references remain valid (rows are kept, only flagged).
WITH ranked AS (
    SELECT id,
           ROW_NUMBER() OVER (PARTITION BY content_hash
                              ORDER BY created_at ASC, id ASC) AS rn
      FROM public.questions
     WHERE deleted_at IS NULL
)
UPDATE public.questions q
   SET deleted_at = NOW(), active = FALSE
  FROM ranked r
 WHERE q.id = r.id AND r.rn > 1;

-- ─── 3. Indexes ──────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uq_questions_content_hash
    ON public.questions(content_hash) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_questions_last_asked_at
    ON public.questions(last_asked_at);

-- ─── 4. claim_question RPC ────────────────────────────────────────────────────
-- Atomically resolves a generated question to its canonical row:
--   * If an active row with the same content_hash exists AND was asked within
--     the cooldown → return (id, was_recent=TRUE) so the caller re-generates.
--   * Otherwise upsert/insert, stamp last_asked_at=NOW(), bump used_count, and
--     return (id, was_recent=FALSE). A concurrent insert race is caught via the
--     partial unique index and falls back to the existing row.
CREATE OR REPLACE FUNCTION public.claim_question(
    p_text              TEXT,
    p_options           TEXT[],
    p_option_ids        TEXT[],
    p_correct_option_id TEXT,
    p_correct_index     INTEGER,
    p_localized         JSONB    DEFAULT NULL,
    p_category          TEXT     DEFAULT NULL,
    p_difficulty        TEXT     DEFAULT NULL,
    p_language          TEXT     DEFAULT NULL,
    p_cooldown_seconds  INTEGER  DEFAULT 604800
) RETURNS TABLE(question_id UUID, was_recent BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_hash       TEXT;
    v_cooldown   INTERVAL;
    v_difficulty TEXT;
    v_language   TEXT;
    v_category   TEXT;
    v_id         UUID;
    v_last       TIMESTAMPTZ;
BEGIN
    v_hash     := md5(lower(regexp_replace(btrim(p_text), '\s+', ' ', 'g')));
    v_cooldown := make_interval(secs => GREATEST(COALESCE(p_cooldown_seconds, 0), 0));

    -- Normalize to satisfy the questions CHECK constraints.
    v_difficulty := CASE lower(COALESCE(p_difficulty, ''))
                        WHEN 'easy' THEN 'Easy'
                        WHEN 'hard' THEN 'Hard'
                        ELSE 'Medium'
                    END;
    v_language := CASE WHEN lower(COALESCE(p_language, '')) IN ('en','ar','fa','tr')
                       THEN lower(p_language) ELSE 'en' END;
    v_category := COALESCE(NULLIF(btrim(p_category), ''), 'General');

    SELECT id, last_asked_at INTO v_id, v_last
      FROM public.questions
     WHERE content_hash = v_hash AND deleted_at IS NULL
     FOR UPDATE;

    IF FOUND THEN
        IF v_last IS NOT NULL AND v_last > (NOW() - v_cooldown) THEN
            RETURN QUERY SELECT v_id, TRUE; RETURN;
        END IF;
        UPDATE public.questions
           SET last_asked_at = NOW(), used_count = used_count + 1
         WHERE id = v_id;
        RETURN QUERY SELECT v_id, FALSE; RETURN;
    END IF;

    BEGIN
        INSERT INTO public.questions
            (text, options, option_ids, correct_option_id, correct_index,
             localized, validated, category, difficulty, language,
             used_count, active, last_asked_at)
        VALUES
            (p_text, p_options, p_option_ids, p_correct_option_id, p_correct_index,
             p_localized, TRUE, v_category, v_difficulty, v_language,
             1, TRUE, NOW())
        RETURNING id INTO v_id;
        RETURN QUERY SELECT v_id, FALSE; RETURN;
    EXCEPTION WHEN unique_violation THEN
        -- A concurrent claim of the same content won the race.
        SELECT id, last_asked_at INTO v_id, v_last
          FROM public.questions
         WHERE content_hash = v_hash AND deleted_at IS NULL
         FOR UPDATE;
        IF v_last IS NOT NULL AND v_last > (NOW() - v_cooldown) THEN
            RETURN QUERY SELECT v_id, TRUE; RETURN;
        END IF;
        UPDATE public.questions
           SET last_asked_at = NOW(), used_count = used_count + 1
         WHERE id = v_id;
        RETURN QUERY SELECT v_id, FALSE; RETURN;
    END;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_question(TEXT, TEXT[], TEXT[], TEXT, INTEGER, JSONB, TEXT, TEXT, TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_question(TEXT, TEXT[], TEXT[], TEXT, INTEGER, JSONB, TEXT, TEXT, TEXT, INTEGER) TO service_role;

-- ─── 5. generate_game_from_template : cooldown-aware question picker ───────────
-- Identical to 20260531300000_cron_aligned_scheduling.sql except the picker now
-- prefers questions outside the re-ask cooldown window (still falling back to
-- recent ones so a game is never left short of its questions_count) and stamps
-- last_asked_at on the picked rows. Default cooldown: 7 days (604800s).
CREATE OR REPLACE FUNCTION public.generate_game_from_template(
    p_template_id   UUID,
    p_skip_overlap  BOOLEAN DEFAULT FALSE
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_tpl                 public.game_templates%ROWTYPE;
    v_current_status      TEXT;
    v_new_game_id         UUID := gen_random_uuid();
    v_min_start           TIMESTAMPTZ;
    v_start_at            TIMESTAMPTZ;
    v_title               TEXT;
    v_livekit_room        TEXT;
    v_needs_streaming     BOOLEAN;
    v_cooldown_seconds    INTEGER := 604800;  -- 7 days; mirrors QUESTION_REASK_COOLDOWN_SECONDS
BEGIN
    SELECT * INTO v_tpl
      FROM public.game_templates
     WHERE id = p_template_id
       AND deleted_at IS NULL
       FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'template_not_found' USING ERRCODE = 'P0002';
    END IF;

    IF v_tpl.current_game_id IS NOT NULL THEN
        SELECT status INTO v_current_status
          FROM public.games WHERE id = v_tpl.current_game_id;
    END IF;

    -- Overlap (spec §5): block when a registerable game is already queued.
    -- 'live' / 'completed' / 'cancelled' / NULL  → allow generation.
    IF NOT COALESCE(p_skip_overlap, FALSE)
       AND v_current_status IN ('upcoming', 'open') THEN
        RETURN NULL;
    END IF;

    -- scheduled_at = next cron match after NOW + start_buffer_seconds.
    -- Falls back to NOW + buffer if cron is invalid / has no match.
    v_min_start := NOW() + (v_tpl.start_buffer_seconds || ' seconds')::INTERVAL;
    v_start_at  := COALESCE(
        public.next_cron_match(v_tpl.cron_expression, v_min_start),
        v_min_start
    );

    v_title := v_tpl.name || '_' || to_char(v_start_at AT TIME ZONE 'UTC', 'MMDD_HH24MI');

    v_needs_streaming := v_tpl.enable_streaming OR v_tpl.ai_enabled;
    v_livekit_room := CASE WHEN v_needs_streaming
                            THEN 'quiz-' || v_new_game_id::TEXT
                            ELSE NULL END;

    INSERT INTO public.games (
        id, template_id, title, description, subtitle,
        mode, category, difficulty, language,
        entry_fee, prize_pool, prize_pool_currency,
        max_players, questions_count, time_per_question, allowed_wrong_answers,
        scheduled_at, status,
        prize_breakdown, prize_distribution, rules, tags,
        is_featured,
        icon, thumbnail_url, poster_url,
        host_id, host_name, host_avatar_url, host_title,
        livekit_room_name,
        sponsor, accent_color, glow_color, gradient_colors,
        created_at
    ) VALUES (
        v_new_game_id, v_tpl.id, v_title, v_tpl.description, NULL,
        v_tpl.mode, v_tpl.category, v_tpl.difficulty, v_tpl.language,
        v_tpl.entry_fee, v_tpl.prize_pool, v_tpl.prize_pool_currency,
        v_tpl.max_players, v_tpl.questions_count, v_tpl.time_per_question, v_tpl.allowed_wrong_answers,
        v_start_at, 'upcoming',
        v_tpl.prize_breakdown, v_tpl.prize_distribution, v_tpl.rules, v_tpl.tags,
        v_tpl.is_featured,
        v_tpl.icon, v_tpl.thumbnail_url, v_tpl.poster_url,
        v_tpl.host_id, v_tpl.host_name, v_tpl.host_avatar_url, v_tpl.host_title,
        v_livekit_room,
        v_tpl.sponsor, v_tpl.accent_color, v_tpl.glow_color, v_tpl.gradient_colors,
        NOW()
    );

    WITH picked AS (
        SELECT id, (ROW_NUMBER() OVER () - 1)::INT AS ord
          FROM public.questions
         WHERE active = TRUE
           AND deleted_at IS NULL
           AND (v_tpl.question_category   IS NULL OR category   = v_tpl.question_category)
           AND (v_tpl.question_difficulty IS NULL OR difficulty = v_tpl.question_difficulty)
           AND (v_tpl.question_language   IS NULL OR language   = v_tpl.question_language)
         ORDER BY
           (CASE WHEN last_asked_at IS NULL
                  OR last_asked_at < NOW() - make_interval(secs => v_cooldown_seconds)
                 THEN 0 ELSE 1 END),
           random()
         LIMIT v_tpl.questions_count
    )
    INSERT INTO public.game_questions (game_id, question_id, "order")
    SELECT v_new_game_id, id, ord FROM picked;

    UPDATE public.questions
       SET used_count    = used_count + 1,
           last_asked_at = NOW()
     WHERE id IN (SELECT question_id FROM public.game_questions WHERE game_id = v_new_game_id);

    UPDATE public.game_templates
       SET last_completed_game_id = CASE WHEN v_tpl.current_game_id IS NOT NULL
                                          AND v_current_status IN ('completed','cancelled')
                                         THEN v_tpl.current_game_id
                                         ELSE last_completed_game_id END,
           current_game_id        = v_new_game_id,
           last_generated_at      = NOW(),
           total_games_generated  = total_games_generated + 1,
           updated_at             = NOW()
     WHERE id = v_tpl.id;

    RETURN v_new_game_id;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_game_from_template(UUID, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generate_game_from_template(UUID, BOOLEAN) TO service_role;

COMMIT;
