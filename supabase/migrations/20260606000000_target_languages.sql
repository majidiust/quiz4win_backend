-- Migration: multi-language support for game templates and games.
--
-- Adds `target_languages TEXT[]` to public.game_templates and public.games.
-- This is the COMPLETE set of languages every generated question must be
-- produced in (text + options + explanation). The existing single `language`
-- column keeps its meaning: the default / primary display language. It is
-- always force-included in the target set by the generator and the
-- orchestrator, so a game can never be served in fewer languages than its
-- primary one.
--
-- Default is the full supported set ('en','ar','fa','tr') so games are fully
-- multilingual out of the box; admins may narrow it in the panel.
--
-- Rule compliance:
--   R-02/R-05  no financial columns touched.
--   R-06       no cross-module reverse imports; non-financial tables only.

BEGIN;

-- ─── columns ─────────────────────────────────────────────────────────────────
ALTER TABLE public.game_templates
    ADD COLUMN IF NOT EXISTS target_languages TEXT[] NOT NULL DEFAULT '{en,ar,fa,tr}';

ALTER TABLE public.games
    ADD COLUMN IF NOT EXISTS target_languages TEXT[] NOT NULL DEFAULT '{en,ar,fa,tr}';

-- Only supported language codes may appear in the set.
ALTER TABLE public.game_templates
    DROP CONSTRAINT IF EXISTS game_templates_target_languages_supported,
    ADD CONSTRAINT game_templates_target_languages_supported
        CHECK (target_languages <@ ARRAY['en','ar','fa','tr']::TEXT[]
               AND array_length(target_languages, 1) >= 1);

ALTER TABLE public.games
    DROP CONSTRAINT IF EXISTS games_target_languages_supported,
    ADD CONSTRAINT games_target_languages_supported
        CHECK (target_languages <@ ARRAY['en','ar','fa','tr']::TEXT[]
               AND array_length(target_languages, 1) >= 1);

-- ─── backfill ────────────────────────────────────────────────────────────────
-- Existing rows default to the full supported set, but guarantee the primary
-- language is present (it always is in the default, but stay explicit/idempotent).
UPDATE public.game_templates
   SET target_languages = (
       SELECT ARRAY(SELECT DISTINCT l
                      FROM unnest(array_prepend(language, target_languages)) AS l
                     WHERE l = ANY (ARRAY['en','ar','fa','tr']::TEXT[])))
 WHERE NOT (language = ANY (target_languages));

UPDATE public.games
   SET target_languages = (
       SELECT ARRAY(SELECT DISTINCT l
                      FROM unnest(array_prepend(language, target_languages)) AS l
                     WHERE l = ANY (ARRAY['en','ar','fa','tr']::TEXT[])))
 WHERE NOT (language = ANY (target_languages));

-- ─── generator: copy target_languages into the spawned game ─────────────────────
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
    v_target_languages    TEXT[];
BEGIN
    SELECT * INTO v_tpl
      FROM public.game_templates
     WHERE id = p_template_id AND deleted_at IS NULL
       FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'template_not_found' USING ERRCODE = 'P0002';
    END IF;

    IF v_tpl.current_game_id IS NOT NULL THEN
        SELECT status INTO v_current_status FROM public.games WHERE id = v_tpl.current_game_id;
    END IF;
    IF NOT COALESCE(p_skip_overlap, FALSE)
       AND v_current_status IN ('upcoming','open','live','paused') THEN
        RETURN NULL;
    END IF;

    v_start_at := NOW() + (v_tpl.start_buffer_seconds || ' seconds')::INTERVAL;
    v_end_at   := v_start_at + (v_tpl.duration_minutes || ' minutes')::INTERVAL;
    v_title := v_tpl.name || '_' || to_char(v_start_at AT TIME ZONE 'UTC', 'MMDD_HH24MI');
    v_needs_streaming := v_tpl.enable_streaming OR v_tpl.ai_enabled;
    v_livekit_room := CASE WHEN v_needs_streaming THEN 'quiz-' || v_new_game_id::TEXT ELSE NULL END;

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
         WHERE active = TRUE AND deleted_at IS NULL
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
