-- Migration: restore canonical generate_game_from_template().
--
-- Regression context: 20260606000000_target_languages.sql redefined
-- generate_game_from_template() from a STALE copy while adding target_languages,
-- silently reverting three earlier improvements:
--
--   1. Overlap check widened to ('upcoming','open','live','paused'), so a LIVE
--      (or paused) game blocked generation of the next upcoming game. This
--      violates docs/game_template_logic.md §5: only one *registerable*
--      (upcoming/open) game per template at a time — a running game does NOT
--      block the next upcoming. A template may have several games as long as no
--      two are simultaneously registerable.
--   2. scheduled_at reverted to NOW()+start_buffer_seconds, losing the
--      cron-aligned next_cron_match() scheduling from 20260531300000.
--   3. Question picker reverted to plain random(), losing the cooldown-aware
--      preference + last_asked_at stamping from 20260603120000.
--
-- This migration re-installs the 20260603120000 body (overlap = ('upcoming',
-- 'open') only; cron-aligned scheduled_at; cooldown-aware picker) and keeps the
-- target_languages copy added by 20260606000000.
--
-- Rule compliance: R-02/R-05 no financial columns touched (entry_fee /
-- prize_pool are copied verbatim from the template as before); R-06 no reverse
-- imports; R-12 applied by db-maintainer only.

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
    v_min_start           TIMESTAMPTZ;
    v_start_at            TIMESTAMPTZ;
    v_title               TEXT;
    v_livekit_room        TEXT;
    v_needs_streaming     BOOLEAN;
    v_target_languages    TEXT[];
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

    -- Overlap (spec §5): block ONLY when a registerable game is already queued.
    -- 'live' / 'paused' / 'completed' / 'cancelled' / NULL → allow generation.
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

    -- Full language set: template's target_languages plus the primary language,
    -- deduped and restricted to supported codes. Never empty.
    v_target_languages := ARRAY(
        SELECT DISTINCT l
          FROM unnest(array_prepend(v_tpl.language,
                      COALESCE(v_tpl.target_languages, ARRAY[]::TEXT[]))) AS l
         WHERE l = ANY (ARRAY['en','ar','fa','tr']::TEXT[]));

    INSERT INTO public.games (
        id, template_id, title, description, subtitle,
        mode, category, difficulty, language, target_languages,
        entry_fee, prize_pool, prize_pool_currency,
        max_players, questions_count, time_per_question, allowed_wrong_answers,
        scheduled_at, status,
        prize_breakdown, prize_distribution, rules, tags, is_featured,
        icon, thumbnail_url, poster_url,
        host_id, host_name, host_avatar_url, host_title,
        livekit_room_name, sponsor, accent_color, glow_color, gradient_colors, created_at
    ) VALUES (
        v_new_game_id, v_tpl.id, v_title, v_tpl.description, NULL,
        v_tpl.mode, v_tpl.category, v_tpl.difficulty, v_tpl.language, v_target_languages,
        v_tpl.entry_fee, v_tpl.prize_pool, v_tpl.prize_pool_currency,
        v_tpl.max_players, v_tpl.questions_count, v_tpl.time_per_question, v_tpl.allowed_wrong_answers,
        v_start_at, 'upcoming',
        v_tpl.prize_breakdown, v_tpl.prize_distribution, v_tpl.rules, v_tpl.tags, v_tpl.is_featured,
        v_tpl.icon, v_tpl.thumbnail_url, v_tpl.poster_url,
        v_tpl.host_id, v_tpl.host_name, v_tpl.host_avatar_url, v_tpl.host_title,
        v_livekit_room, v_tpl.sponsor, v_tpl.accent_color, v_tpl.glow_color, v_tpl.gradient_colors, NOW()
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
