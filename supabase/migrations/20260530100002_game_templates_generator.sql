-- Migration: Game Templates v1 — game generator.
--
-- generate_game_from_template(template_id, skip_overlap):
--   * Loads the template (row-locked).
--   * Skips if overlap (current_game_id still active) unless skip_overlap.
--   * Inserts a new game row mirroring the template (mode=template.mode,
--     status='upcoming', template_id=template.id, livekit_room_name from
--     enable_streaming/ai_enabled).
--   * Selects template.questions_count random questions matching the template
--     filters (question_category/difficulty/language) and writes game_questions.
--   * Bumps template tracking columns.
--   * Returns the new game id (NULL when skipped).

BEGIN;

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
    v_start_at            TIMESTAMPTZ;
    v_end_at              TIMESTAMPTZ;
    v_title               TEXT;
    v_livekit_room        TEXT;
    v_needs_streaming     BOOLEAN;
BEGIN
    -- Lock the template row for the duration of generation.
    SELECT * INTO v_tpl
      FROM public.game_templates
     WHERE id = p_template_id
       AND deleted_at IS NULL
       FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'template_not_found' USING ERRCODE = 'P0002';
    END IF;

    -- Look up the current_game_id's status (used for both overlap and tracking).
    IF v_tpl.current_game_id IS NOT NULL THEN
        SELECT status INTO v_current_status
          FROM public.games
         WHERE id = v_tpl.current_game_id;
    END IF;

    -- Overlap check: skip if current game is still active.
    IF NOT COALESCE(p_skip_overlap, FALSE)
       AND v_current_status IN ('upcoming','open','live','paused') THEN
        RETURN NULL;  -- still active → skip
    END IF;

    -- Compute schedule
    v_start_at := NOW() + (v_tpl.start_buffer_seconds || ' seconds')::INTERVAL;
    v_end_at   := v_start_at + (v_tpl.duration_minutes || ' minutes')::INTERVAL;

    -- Unique-ish title: <template name>_MMDD_HHMM
    v_title := v_tpl.name || '_' || to_char(v_start_at AT TIME ZONE 'UTC', 'MMDD_HH24MI');

    -- LiveKit room is created when streaming/AI is on. ai_enabled forces streaming.
    v_needs_streaming := v_tpl.enable_streaming OR v_tpl.ai_enabled;
    v_livekit_room := CASE WHEN v_needs_streaming
                            THEN 'quiz-' || v_new_game_id::TEXT
                            ELSE NULL END;

    -- Insert the new game.
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

    -- Filter-based question selection. NULL filter = any value.
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

    -- Bump used_count on picked questions
    UPDATE public.questions
       SET used_count = used_count + 1
     WHERE id IN (SELECT question_id FROM public.game_questions WHERE game_id = v_new_game_id);

    -- Update template tracking. Promote previous current_game_id to
    -- last_completed_game_id only if its status was actually terminal.
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
