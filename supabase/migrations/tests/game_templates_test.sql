-- =============================================================================
-- SQL Tests: Game Template Engine
--
-- Tests match_cron_expression, generate_game_from_template, and the overlap
-- guard logic using plain SQL DO/ASSERT blocks (no pgTAP required).
--
-- Run against a local Supabase Postgres:
--   psql "$DATABASE_URL" -f supabase/migrations/tests/game_templates_test.sql
--
-- The entire script runs inside a transaction that is rolled back at the end
-- so it leaves the database clean.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Utility: simple assertion wrapper
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION _test_assert(p_ok BOOLEAN, p_name TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'FAIL: %', p_name;
  ELSE
    RAISE NOTICE 'PASS: %', p_name;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 1. match_cron_expression — unit-level tests
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  -- Wildcard matches anything
  PERFORM _test_assert(
    public.match_cron_expression('* * * * *', '2026-06-01 14:37:00+00'),
    '1.1 wildcard matches any time'
  );

  -- Exact minute/hour
  PERFORM _test_assert(
    public.match_cron_expression('0 14 * * *', '2026-06-01 14:00:00+00'),
    '1.2 top-of-hour at 14:00 matches'
  );
  PERFORM _test_assert(
    NOT public.match_cron_expression('0 14 * * *', '2026-06-01 14:01:00+00'),
    '1.3 top-of-hour at 14:00 does NOT match 14:01'
  );

  -- Step expression */15
  PERFORM _test_assert(
    public.match_cron_expression('*/15 * * * *', '2026-06-01 14:30:00+00'),
    '1.4 */15 matches minute 30'
  );
  PERFORM _test_assert(
    NOT public.match_cron_expression('*/15 * * * *', '2026-06-01 14:31:00+00'),
    '1.5 */15 does NOT match minute 31'
  );

  -- Comma list
  PERFORM _test_assert(
    public.match_cron_expression('0,30 * * * *', '2026-06-01 14:30:00+00'),
    '1.6 comma list 0,30 matches minute 30'
  );

  -- Range
  PERFORM _test_assert(
    public.match_cron_expression('0 9-17 * * *', '2026-06-01 12:00:00+00'),
    '1.7 range 9-17 matches hour 12'
  );
  PERFORM _test_assert(
    NOT public.match_cron_expression('0 9-17 * * *', '2026-06-01 18:00:00+00'),
    '1.8 range 9-17 does NOT match hour 18'
  );

  -- Day of week (0=Sunday)
  -- 2026-06-01 is a Monday → DOW=1
  PERFORM _test_assert(
    public.match_cron_expression('0 12 * * 1-5', '2026-06-01 12:00:00+00'),
    '1.9 Mon-Fri matches Monday 2026-06-01'
  );
  -- 2026-06-07 is a Sunday → DOW=0
  PERFORM _test_assert(
    NOT public.match_cron_expression('0 12 * * 1-5', '2026-06-07 12:00:00+00'),
    '1.10 Mon-Fri does NOT match Sunday 2026-06-07'
  );

  -- Malformed expression — must return FALSE, not raise
  PERFORM _test_assert(
    NOT public.match_cron_expression('bad expr', NOW()),
    '1.11 malformed expression returns false'
  );

  -- NULL → FALSE
  PERFORM _test_assert(
    NOT public.match_cron_expression(NULL, NOW()),
    '1.12 NULL cron returns false'
  );

  -- Weekend shortcut
  PERFORM _test_assert(
    public.match_cron_expression('0 20 * * 0,6', '2026-06-07 20:00:00+00'),
    '1.13 0,6 matches Sunday 2026-06-07 20:00 UTC'
  );
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- 2. generate_game_from_template — fixture setup
-- ---------------------------------------------------------------------------
-- Insert a minimal user to satisfy FK constraints that require created_by / host_id.
INSERT INTO auth.users (id, email, created_at, updated_at)
VALUES ('00000000-0000-0000-0000-000000000001', 'test@quiz4win.test', NOW(), NOW())
ON CONFLICT DO NOTHING;

INSERT INTO public.profiles (id, email, username, created_at)
VALUES ('00000000-0000-0000-0000-000000000001', 'test@quiz4win.test', 'test_gen', NOW())
ON CONFLICT DO NOTHING;

-- Insert 5 questions so the generator can pick from them.
INSERT INTO public.questions (id, text, options, correct_option_index, category, difficulty, language, active, created_at)
SELECT
  gen_random_uuid(), 'Q' || g, '["A","B","C","D"]'::jsonb, 0,
  'Science', 'Medium', 'en', TRUE, NOW()
FROM generate_series(1, 5) g;

-- Insert a test template.
INSERT INTO public.game_templates (
  id, name, cron_expression, mode, language, entry_fee, prize_pool, prize_pool_currency,
  questions_count, time_per_question, duration_minutes, start_buffer_seconds,
  question_category, question_difficulty, question_language,
  is_active, enable_streaming, ai_enabled, created_at, updated_at
) VALUES (
  '00000000-0000-0000-0000-000000000099',
  'Test Template', '0 * * * *', 'live', 'en', 0, 1000, 'USD',
  3, 15, 10, 0,
  'Science', 'Medium', 'en',
  TRUE, FALSE, FALSE, NOW(), NOW()
);

-- ---------------------------------------------------------------------------
-- 3. generate_game_from_template — happy path
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_game_id UUID;
  v_game    public.games%ROWTYPE;
  v_tpl     public.game_templates%ROWTYPE;
  v_q_count BIGINT;
BEGIN
  v_game_id := public.generate_game_from_template(
    '00000000-0000-0000-0000-000000000099'::UUID, TRUE
  );

  PERFORM _test_assert(v_game_id IS NOT NULL, '3.1 generator returns a game UUID');

  SELECT * INTO v_game FROM public.games WHERE id = v_game_id;

  PERFORM _test_assert(v_game.status    = 'upcoming', '3.2 generated game status = upcoming');
  PERFORM _test_assert(v_game.mode      = 'live',     '3.3 generated game mode   = live');
  PERFORM _test_assert(v_game.template_id = '00000000-0000-0000-0000-000000000099',
    '3.4 generated game has template_id set');
  PERFORM _test_assert(v_game.livekit_room_name IS NULL,
    '3.5 livekit_room_name is NULL when streaming disabled');

  SELECT COUNT(*) INTO v_q_count FROM public.game_questions WHERE game_id = v_game_id;
  PERFORM _test_assert(v_q_count = 3, '3.6 exactly 3 game_questions inserted (questions_count=3)');

  SELECT * INTO v_tpl FROM public.game_templates WHERE id = '00000000-0000-0000-0000-000000000099';
  PERFORM _test_assert(v_tpl.current_game_id = v_game_id,
    '3.7 template.current_game_id updated to new game');
  PERFORM _test_assert(v_tpl.total_games_generated = 1,
    '3.8 template.total_games_generated incremented to 1');
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- 4. generate_game_from_template — overlap guard
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_result UUID;
BEGIN
  -- current_game_id is now set to an 'upcoming' game → overlap should block.
  v_result := public.generate_game_from_template(
    '00000000-0000-0000-0000-000000000099'::UUID, FALSE  -- skip_overlap=FALSE
  );
  PERFORM _test_assert(v_result IS NULL, '4.1 overlap guard returns NULL for active current game');
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- 5. generate_game_from_template — skip_overlap=TRUE overrides guard
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_game_id UUID;
  v_tpl     public.game_templates%ROWTYPE;
BEGIN
  v_game_id := public.generate_game_from_template(
    '00000000-0000-0000-0000-000000000099'::UUID, TRUE  -- skip_overlap=TRUE
  );
  PERFORM _test_assert(v_game_id IS NOT NULL, '5.1 skip_overlap=TRUE still generates a game');

  SELECT * INTO v_tpl FROM public.game_templates WHERE id = '00000000-0000-0000-0000-000000000099';
  PERFORM _test_assert(v_tpl.total_games_generated = 2,
    '5.2 total_games_generated is now 2 after second generation');
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- 6. generate_game_from_template — AI/streaming sets livekit_room_name
-- ---------------------------------------------------------------------------
UPDATE public.game_templates
   SET ai_enabled = TRUE, ai_avatar_id = 'av-1', ai_sound_id = 'vx-1'
 WHERE id = '00000000-0000-0000-0000-000000000099';

DO $$
DECLARE
  v_game_id UUID;
  v_game    public.games%ROWTYPE;
BEGIN
  v_game_id := public.generate_game_from_template(
    '00000000-0000-0000-0000-000000000099'::UUID, TRUE
  );
  SELECT * INTO v_game FROM public.games WHERE id = v_game_id;
  PERFORM _test_assert(
    v_game.livekit_room_name LIKE 'quiz-%',
    '6.1 ai_enabled=TRUE sets livekit_room_name with quiz- prefix'
  );
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- Teardown: roll back everything so the DB stays clean.
-- ---------------------------------------------------------------------------
ROLLBACK;
