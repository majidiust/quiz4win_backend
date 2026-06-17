-- =============================================================================
-- Quiz4Win — Reinstall generate_game_from_template to copy host fee/commission
-- Migration: 20260617000100_generate_game_copies_host_fee.sql
-- Author:    A-01 — 2026-06-17
-- =============================================================================
-- Copies host_fee, host_commission_pct, show_host_fee, show_host_commission from
-- the template into each generated game row, and sets host_assignment_status:
--   'pending' when the template already has a host_id (host must accept/reject)
--   'unassigned' otherwise.
-- All other logic is preserved verbatim from 20260607150000.
-- Rule compliance: R-12 (db-maintainer only). R-06 no reverse imports.
-- =============================================================================

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
    v_livekit_room        TEXT;
    v_needs_streaming     BOOLEAN;
    v_target_languages    TEXT[];
    v_cooldown_seconds    INTEGER := 604800;  -- 7 days
    v_assignment_status   TEXT;
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

    IF NOT COALESCE(p_skip_overlap, FALSE)
       AND v_current_status IN ('upcoming', 'open') THEN
        RETURN NULL;
    END IF;

    v_min_start := NOW() + (v_tpl.start_buffer_seconds || ' seconds')::INTERVAL;
    v_start_at  := COALESCE(
        public.next_cron_match(v_tpl.cron_expression, v_min_start),
        v_min_start
    );

    v_needs_streaming := v_tpl.enable_streaming OR v_tpl.ai_enabled;
    v_livekit_room := CASE WHEN v_needs_streaming
                            THEN 'quiz-' || v_new_game_id::TEXT
                            ELSE NULL END;

    v_target_languages := ARRAY(
        SELECT DISTINCT l
          FROM unnest(array_prepend(v_tpl.language,
                      COALESCE(v_tpl.target_languages, ARRAY[]::TEXT[]))) AS l
         WHERE l = ANY (ARRAY['en','ar','fa','tr']::TEXT[]));

    -- Determine assignment status for the new game.
    v_assignment_status := CASE WHEN v_tpl.host_id IS NOT NULL THEN 'pending'
                                 ELSE 'unassigned' END;

    INSERT INTO public.games (
        id, template_id, llm_template_id, title, description, subtitle,
        mode, category, difficulty, language, target_languages,
        entry_fee, prize_pool, prize_pool_currency,
        max_players, questions_count, time_per_question, allowed_wrong_answers,
        start_buffer_seconds,
        scheduled_at, status,
        prize_breakdown, prize_distribution, rules, tags, is_featured,
        icon, thumbnail_url, poster_url,
        host_id, host_name, host_avatar_url, host_title,
        livekit_room_name, sponsor, accent_color, glow_color, gradient_colors,
        host_fee, host_commission_pct, show_host_fee, show_host_commission,
        host_assignment_status,
        created_at
    ) VALUES (
        v_new_game_id, v_tpl.id, v_tpl.llm_template_id, v_tpl.name, v_tpl.description, NULL,
        v_tpl.mode, v_tpl.category, v_tpl.difficulty, v_tpl.language, v_target_languages,
        v_tpl.entry_fee, v_tpl.prize_pool, v_tpl.prize_pool_currency,
        v_tpl.max_players, v_tpl.questions_count, v_tpl.time_per_question, v_tpl.allowed_wrong_answers,
        v_tpl.start_buffer_seconds,
        v_start_at, 'upcoming',
        v_tpl.prize_breakdown, v_tpl.prize_distribution, v_tpl.rules, v_tpl.tags, v_tpl.is_featured,
        v_tpl.icon, v_tpl.thumbnail_url, v_tpl.poster_url,
        v_tpl.host_id, v_tpl.host_name, v_tpl.host_avatar_url, v_tpl.host_title,
        v_livekit_room, v_tpl.sponsor, v_tpl.accent_color, v_tpl.glow_color, v_tpl.gradient_colors,
        v_tpl.host_fee, v_tpl.host_commission_pct, v_tpl.show_host_fee, v_tpl.show_host_commission,
        v_assignment_status,
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
