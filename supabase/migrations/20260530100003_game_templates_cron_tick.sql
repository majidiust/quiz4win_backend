-- Migration: Game Templates v1 — cron-tick entry point.
--
-- generate_games_from_active_templates() is called once per minute by the
-- template-generator Docker service (running on a 60s sleep loop). It:
--
--   1. Fetches every active, non-deleted template.
--   2. For each template, calls match_cron_expression() against NOW().
--   3. Adds a 2-minute "recently generated" guard to prevent duplicates when
--      two cron ticks land on the same matching minute.
--   4. Invokes generate_game_from_template() for matching templates and
--      collects {template_id, game_id, status} per template.
--
-- Errors raised by an individual template are caught and logged in the result
-- array so one bad template does not halt the entire tick (resilience > strict
-- failure here — the loop must always make progress).
--
-- Returns a JSONB array suitable for the generator service to log.

BEGIN;

CREATE OR REPLACE FUNCTION public.generate_games_from_active_templates()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    rec     RECORD;
    v_now   TIMESTAMPTZ := NOW();
    v_new   UUID;
    v_res   JSONB := '[]'::JSONB;
    v_entry JSONB;
BEGIN
    FOR rec IN
        SELECT id, name, cron_expression, last_generated_at
          FROM public.game_templates
         WHERE is_active = TRUE
           AND deleted_at IS NULL
    LOOP
        -- Dedup guard: don't fire twice within the same matching minute.
        IF rec.last_generated_at IS NOT NULL
           AND rec.last_generated_at > v_now - INTERVAL '90 seconds' THEN
            v_entry := jsonb_build_object(
                'template_id', rec.id,
                'name', rec.name,
                'status', 'skipped_recent'
            );
            v_res := v_res || v_entry;
            CONTINUE;
        END IF;

        IF NOT public.match_cron_expression(rec.cron_expression, v_now) THEN
            v_entry := jsonb_build_object(
                'template_id', rec.id,
                'name', rec.name,
                'status', 'no_match'
            );
            v_res := v_res || v_entry;
            CONTINUE;
        END IF;

        BEGIN
            v_new := public.generate_game_from_template(rec.id, FALSE);
            IF v_new IS NULL THEN
                v_entry := jsonb_build_object(
                    'template_id', rec.id,
                    'name', rec.name,
                    'status', 'overlap_skipped'
                );
            ELSE
                v_entry := jsonb_build_object(
                    'template_id', rec.id,
                    'name', rec.name,
                    'status', 'generated',
                    'game_id', v_new
                );
            END IF;
        EXCEPTION WHEN OTHERS THEN
            v_entry := jsonb_build_object(
                'template_id', rec.id,
                'name', rec.name,
                'status', 'error',
                'error', SQLERRM
            );
        END;

        v_res := v_res || v_entry;
    END LOOP;

    RETURN v_res;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_games_from_active_templates() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.generate_games_from_active_templates() TO service_role;

COMMIT;
