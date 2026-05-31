-- =============================================================================
-- Game lifecycle alignment with Game Template spec
-- =============================================================================
-- 1. join_game: registration window is (creation time → scheduled_at). Allow
--    status IN ('upcoming','open') AND scheduled_at > NOW(). Time is the gate.
-- 2. generate_game_from_template: overlap check now blocks only when the
--    template's current game is still 'upcoming'. Once it flips to 'open' /
--    'live' / 'completed' / 'cancelled', the next upcoming game may be
--    generated — supporting the spec's "one running + one upcoming" pattern.
--    (Dropped 'paused' from the list — not a valid games.status.)
-- =============================================================================

BEGIN;

-- join_game ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.join_game(
    p_user_id         UUID,
    p_game_id         UUID,
    p_entry_fee_cents NUMERIC
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_balance      NUMERIC;
    v_status       TEXT;
    v_max          INTEGER;
    v_count        INTEGER;
    v_scheduled_at TIMESTAMPTZ;
BEGIN
    SELECT status, max_players, total_participants, scheduled_at
      INTO v_status, v_max, v_count, v_scheduled_at
      FROM public.games WHERE id = p_game_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'game_not_found'; END IF;
    IF v_status NOT IN ('upcoming','open') THEN
        RAISE EXCEPTION 'game_not_open';
    END IF;
    -- Registration closes at scheduled_at (spec: creation → start time).
    IF v_scheduled_at IS NOT NULL AND v_scheduled_at <= NOW() THEN
        RAISE EXCEPTION 'registration_closed';
    END IF;
    IF v_max IS NOT NULL AND COALESCE(v_count,0) >= v_max THEN
        RAISE EXCEPTION 'game_full';
    END IF;

    IF EXISTS (SELECT 1 FROM public.game_participants
                WHERE game_id = p_game_id AND user_id = p_user_id) THEN
        RAISE EXCEPTION 'already_joined';
    END IF;

    SELECT wallet_balance INTO v_balance
      FROM public.profiles WHERE id = p_user_id FOR UPDATE;
    IF v_balance IS NULL OR v_balance < p_entry_fee_cents THEN
        RAISE EXCEPTION 'insufficient_balance';
    END IF;

    IF p_entry_fee_cents > 0 THEN
        UPDATE public.profiles
           SET wallet_balance = wallet_balance - p_entry_fee_cents,
               updated_at     = NOW()
         WHERE id = p_user_id;

        INSERT INTO public.transactions(user_id, type, amount, status, reference, game_id, created_at)
        VALUES (p_user_id, 'game_entry_fee', p_entry_fee_cents, 'completed',
                p_game_id::text, p_game_id, NOW());
    END IF;

    INSERT INTO public.game_participants(game_id, user_id, role, entry_fee_paid, joined_at)
    VALUES (p_game_id, p_user_id, 'player', p_entry_fee_cents, NOW());

    UPDATE public.games
       SET total_participants = COALESCE(total_participants,0) + 1
     WHERE id = p_game_id;
END;
$$;

-- generate_game_from_template: relax overlap check --------------------------
-- Body kept verbatim from 20260530100002_game_templates_generator.sql except
-- the overlap-check line, to avoid drift of INSERT / question-picker logic.
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
          FROM public.games
         WHERE id = v_tpl.current_game_id;
    END IF;

    -- Overlap: only an existing *upcoming* game blocks generation. Allows the
    -- spec's "one running + one upcoming" pattern.
    IF NOT COALESCE(p_skip_overlap, FALSE)
       AND v_current_status = 'upcoming' THEN
        RETURN NULL;
    END IF;

    v_start_at := NOW() + (v_tpl.start_buffer_seconds || ' seconds')::INTERVAL;
    v_end_at   := v_start_at + (v_tpl.duration_minutes || ' minutes')::INTERVAL;

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

COMMIT;
