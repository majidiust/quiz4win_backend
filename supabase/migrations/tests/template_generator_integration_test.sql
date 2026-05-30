-- =============================================================================
-- Integration Test: cron-tick RPC (generate_games_from_active_templates)
--
-- Verifies end-to-end template-generator behaviour:
--   1. A template whose cron matches NOW() produces a game row.
--   2. A second tick within 90 s returns status='skipped_recent'.
--   3. A template whose cron does NOT match returns status='no_match'.
--   4. An inactive template is ignored entirely.
--
-- Run against a local Supabase Postgres:
--   psql "$DATABASE_URL" -f supabase/migrations/tests/template_generator_integration_test.sql
--
-- The entire script runs inside a transaction that is ROLLED BACK at the end.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Utility
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION _test_assert(p_ok BOOLEAN, p_name TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN RAISE EXCEPTION 'FAIL: %', p_name;
  ELSE RAISE NOTICE 'PASS: %', p_name; END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email, created_at, updated_at)
VALUES ('ffffffff-0000-0000-0000-000000000001', 'integ@quiz4win.test', NOW(), NOW())
ON CONFLICT DO NOTHING;

INSERT INTO public.profiles (id, email, username, created_at)
VALUES ('ffffffff-0000-0000-0000-000000000001', 'integ@quiz4win.test', 'integ_gen', NOW())
ON CONFLICT DO NOTHING;

-- 5 questions matching the template filters
INSERT INTO public.questions (id, text, options, correct_option_index, category, difficulty, language, active, created_at)
SELECT gen_random_uuid(), 'IntegQ' || g, '["A","B","C","D"]'::jsonb, 0, 'Science', 'Easy', 'en', TRUE, NOW()
FROM generate_series(1, 5) g;

-- Template A — cron always matches NOW() (wildcard)
INSERT INTO public.game_templates (
  id, name, cron_expression, mode, language, entry_fee, prize_pool, prize_pool_currency,
  questions_count, time_per_question, duration_minutes, start_buffer_seconds,
  question_category, question_difficulty, question_language,
  is_active, enable_streaming, ai_enabled, created_at, updated_at
) VALUES (
  'aaaaaaaa-0000-0000-0000-000000000001',
  'IntegTemplateA', '* * * * *', 'live', 'en', 0, 500, 'USD',
  3, 10, 5, 0, 'Science', 'Easy', 'en',
  TRUE, FALSE, FALSE, NOW(), NOW()
);

-- Template B — cron never matches (minute=61, impossible)
INSERT INTO public.game_templates (
  id, name, cron_expression, mode, language, entry_fee, prize_pool, prize_pool_currency,
  questions_count, time_per_question, duration_minutes, start_buffer_seconds,
  is_active, enable_streaming, ai_enabled, created_at, updated_at
) VALUES (
  'bbbbbbbb-0000-0000-0000-000000000001',
  'IntegTemplateB', '61 * * * *', 'live', 'en', 0, 0, 'USD',
  1, 10, 5, 0,
  TRUE, FALSE, FALSE, NOW(), NOW()
);

-- Template C — inactive, must be ignored
INSERT INTO public.game_templates (
  id, name, cron_expression, mode, language, entry_fee, prize_pool, prize_pool_currency,
  questions_count, time_per_question, duration_minutes, start_buffer_seconds,
  is_active, enable_streaming, ai_enabled, created_at, updated_at
) VALUES (
  'cccccccc-0000-0000-0000-000000000001',
  'IntegTemplateC', '* * * * *', 'live', 'en', 0, 0, 'USD',
  1, 10, 5, 0,
  FALSE, FALSE, FALSE, NOW(), NOW()
);

-- ---------------------------------------------------------------------------
-- Test 1: First tick — template A generates, B no_match
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_result   JSONB;
  v_a_entry  JSONB;
  v_b_entry  JSONB;
  v_game_id  UUID;
  v_game     public.games%ROWTYPE;
  v_q_count  BIGINT;
BEGIN
  v_result := public.generate_games_from_active_templates();

  -- Find template A entry
  SELECT elem INTO v_a_entry
    FROM jsonb_array_elements(v_result) elem
   WHERE elem->>'template_id' = 'aaaaaaaa-0000-0000-0000-000000000001';

  PERFORM _test_assert(v_a_entry IS NOT NULL, '1.1 template A appears in tick result');
  PERFORM _test_assert(v_a_entry->>'status' = 'generated', '1.2 template A status = generated');

  v_game_id := (v_a_entry->>'game_id')::UUID;
  PERFORM _test_assert(v_game_id IS NOT NULL, '1.3 tick result includes game_id for template A');

  SELECT * INTO v_game FROM public.games WHERE id = v_game_id;
  PERFORM _test_assert(v_game.status = 'upcoming', '1.4 generated game has status=upcoming');
  PERFORM _test_assert(v_game.mode   = 'live',     '1.5 generated game has mode=live');
  PERFORM _test_assert(v_game.template_id = 'aaaaaaaa-0000-0000-0000-000000000001',
    '1.6 generated game has correct template_id');

  SELECT COUNT(*) INTO v_q_count FROM public.game_questions WHERE game_id = v_game_id;
  PERFORM _test_assert(v_q_count = 3, '1.7 3 game_questions inserted (questions_count=3)');

  -- Template B should have no_match
  SELECT elem INTO v_b_entry
    FROM jsonb_array_elements(v_result) elem
   WHERE elem->>'template_id' = 'bbbbbbbb-0000-0000-0000-000000000001';

  PERFORM _test_assert(v_b_entry->>'status' = 'no_match', '1.8 template B (minute=61) status = no_match');

  -- Template C must not appear (inactive)
  PERFORM _test_assert(
    NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_result) elem
                 WHERE elem->>'template_id' = 'cccccccc-0000-0000-0000-000000000001'),
    '1.9 inactive template C absent from tick result'
  );
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- Test 2: Immediate second tick — template A skipped_recent
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_result  JSONB;
  v_a_entry JSONB;
BEGIN
  -- Run tick again immediately — last_generated_at is within 90s.
  v_result := public.generate_games_from_active_templates();

  SELECT elem INTO v_a_entry
    FROM jsonb_array_elements(v_result) elem
   WHERE elem->>'template_id' = 'aaaaaaaa-0000-0000-0000-000000000001';

  PERFORM _test_assert(v_a_entry->>'status' = 'skipped_recent',
    '2.1 second immediate tick returns skipped_recent for template A');
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------------
-- Teardown
-- ---------------------------------------------------------------------------
ROLLBACK;
