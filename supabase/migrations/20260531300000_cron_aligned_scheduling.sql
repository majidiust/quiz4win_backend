-- Migration: cron-aligned scheduling for game generation.
--
-- Aligns generate_game_from_template with docs/game_template_logic.md:
--   §2  Games are created BEFORE they start; scheduled_at is set to the next
--       cron match (so the cron expression defines WHEN a game starts, not
--       merely when generation fires).
--   §5  Only one upcoming/open ("registerable") game per template at a time.
--       A running game (live) does NOT block creation of the next upcoming.
--   §6  Generation triggers: (a) activation, (b) current goes to running.
--       The cron tick remains as a safety net only.
--
-- Adds:
--   * next_cron_match(expr, from)  — first matching minute boundary >= from.
--   * generate_game_from_template  — scheduled_at via next_cron_match;
--                                    overlap blocks on ('upcoming','open').
--   * Partial unique index         — DB-level enforcement of §5 invariant.
--
-- Pre-flight: cancels duplicate upcoming/open rows (keeps the earliest by
-- scheduled_at) so the partial unique index can be created cleanly.

BEGIN;

-- ─── next_cron_match ─────────────────────────────────────────────────────────
-- Returns the first minute-boundary timestamp >= p_from for which the cron
-- matches. Linear scan up to ~1 year of minutes; returns NULL if no match.
CREATE OR REPLACE FUNCTION public.next_cron_match(
    p_expr TEXT,
    p_from TIMESTAMPTZ
) RETURNS TIMESTAMPTZ
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
    v_ts       TIMESTAMPTZ;
    v_max_iter INT := 527040;  -- 366 * 24 * 60
    i          INT := 0;
BEGIN
    IF p_expr IS NULL OR length(trim(p_expr)) = 0 THEN
        RETURN NULL;
    END IF;
    -- Smallest minute boundary >= p_from.
    v_ts := date_trunc('minute', p_from);
    IF v_ts < p_from THEN
        v_ts := v_ts + INTERVAL '1 minute';
    END IF;

    WHILE i < v_max_iter LOOP
        IF public.match_cron_expression(p_expr, v_ts) THEN
            RETURN v_ts;
        END IF;
        v_ts := v_ts + INTERVAL '1 minute';
        i    := i + 1;
    END LOOP;
    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.next_cron_match(TEXT, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.next_cron_match(TEXT, TIMESTAMPTZ) TO service_role;

-- ─── generate_game_from_template ─────────────────────────────────────────────
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
         ORDER BY random()
         LIMIT v_tpl.questions_count
    )
    INSERT INTO public.game_questions (game_id, question_id, "order")
    SELECT v_new_game_id, id, ord FROM picked;

    UPDATE public.questions
       SET used_count = used_count + 1
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

-- ─── Pre-flight cleanup ──────────────────────────────────────────────────────
-- Prior overlap rules allowed multiple upcoming/open games per template under
-- some races. Cancel all but the earliest scheduled one per template so the
-- new partial unique index can be created.
WITH ranked AS (
    SELECT id,
           ROW_NUMBER() OVER (PARTITION BY template_id
                              ORDER BY scheduled_at ASC NULLS LAST, created_at ASC) AS rn
      FROM public.games
     WHERE status IN ('upcoming','open')
       AND template_id IS NOT NULL
)
UPDATE public.games
   SET status           = 'cancelled',
       cancelled_reason = 'duplicate_upcoming_cleanup'
 WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- ─── Hard DB invariant (§5) ──────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS games_one_registerable_per_template
    ON public.games(template_id)
    WHERE status IN ('upcoming','open') AND template_id IS NOT NULL;

COMMIT;
