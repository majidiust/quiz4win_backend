-- Migration: Rules watchdog for game-template lifecycle.
--
-- Adds public.audit_game_template_rules(grace_minutes) — a self-healing RPC
-- the template-generator service calls every tick. It enforces the invariants
-- of docs/game_template_logic.md and repairs drift caused by crashes, races
-- or external manual changes.
--
-- Rules enforced (each idempotent, safe to re-run):
--   §5  Duplicate upcoming/open per template
--        Keep earliest by scheduled_at; cancel the rest with
--        cancelled_reason='duplicate_upcoming_audit'.
--   §3  Orphan / stuck registerable games
--        upcoming/open + started_at IS NULL + scheduled_at < NOW - grace
--        → cancel with cancelled_reason='orphan_never_started'. Without
--        this, a stuck row blocks queue refill forever (unique index).
--   §2/§5/§6  Missing upcoming per active template
--        For each active, non-deleted template that has NO upcoming/open
--        game → call generate_game_from_template() to refill the queue.
--        Subsumes the queue-builder tick: triggers when current is
--        live / completed / cancelled / NULL.
--
-- Returns a JSONB array of actions taken; one entry per rule with non-zero
-- effect. Empty array = clean state.

BEGIN;

CREATE OR REPLACE FUNCTION public.audit_game_template_rules(
    p_orphan_grace_minutes INTEGER DEFAULT 15
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    rec        RECORD;
    v_now      TIMESTAMPTZ := NOW();
    v_grace    INTERVAL    := (p_orphan_grace_minutes || ' minutes')::INTERVAL;
    v_new_id   UUID;
    v_count    INT;
    v_dup_ids  UUID[];
    v_orphan   UUID[];
    v_actions  JSONB := '[]'::JSONB;
BEGIN
    -- ─── Rule §5: cancel duplicate upcoming/open per template ────────────────
    WITH ranked AS (
        SELECT id, template_id,
               ROW_NUMBER() OVER (PARTITION BY template_id
                                  ORDER BY scheduled_at ASC NULLS LAST,
                                           created_at  ASC) AS rn
          FROM public.games
         WHERE status IN ('upcoming','open')
           AND template_id IS NOT NULL
    ), to_cancel AS (
        UPDATE public.games
           SET status           = 'cancelled',
               cancelled_reason = 'duplicate_upcoming_audit',
               updated_at       = v_now
         WHERE id IN (SELECT id FROM ranked WHERE rn > 1)
        RETURNING id
    )
    SELECT array_agg(id), count(*) INTO v_dup_ids, v_count FROM to_cancel;
    IF COALESCE(v_count, 0) > 0 THEN
        v_actions := v_actions || jsonb_build_object(
            'rule',     'duplicate_upcoming',
            'count',    v_count,
            'game_ids', to_jsonb(v_dup_ids)
        );
    END IF;

    -- ─── Rule §3: cancel orphan / never-started registerable games ───────────
    -- These are upcoming/open rows whose scheduled_at + grace has passed yet
    -- the scheduler never flipped them to live (started_at IS NULL). They
    -- will never run; their presence violates the unique-index and blocks
    -- refill.
    WITH stuck AS (
        UPDATE public.games
           SET status           = 'cancelled',
               cancelled_reason = 'orphan_never_started',
               updated_at       = v_now
         WHERE status IN ('upcoming','open')
           AND started_at IS NULL
           AND scheduled_at IS NOT NULL
           AND scheduled_at < v_now - v_grace
        RETURNING id
    )
    SELECT array_agg(id), count(*) INTO v_orphan, v_count FROM stuck;
    IF COALESCE(v_count, 0) > 0 THEN
        v_actions := v_actions || jsonb_build_object(
            'rule',     'orphan_never_started',
            'count',    v_count,
            'game_ids', to_jsonb(v_orphan)
        );
    END IF;

    -- ─── Rule §2/§5/§6: refill missing upcoming per active template ──────────
    -- Subsumes queue-builder: covers (a) fresh activation, (b) current goes
    -- live, (c) current completed but no next yet.
    FOR rec IN
        SELECT t.id, t.name
          FROM public.game_templates t
         WHERE t.is_active = TRUE
           AND t.deleted_at IS NULL
           AND NOT EXISTS (
                SELECT 1 FROM public.games g
                 WHERE g.template_id = t.id
                   AND g.status IN ('upcoming','open')
           )
    LOOP
        BEGIN
            v_new_id := public.generate_game_from_template(rec.id, FALSE);
            IF v_new_id IS NOT NULL THEN
                v_actions := v_actions || jsonb_build_object(
                    'rule',        'queue_refill',
                    'template_id', rec.id,
                    'name',        rec.name,
                    'game_id',     v_new_id
                );
            END IF;
        EXCEPTION WHEN OTHERS THEN
            v_actions := v_actions || jsonb_build_object(
                'rule',        'queue_refill_error',
                'template_id', rec.id,
                'name',        rec.name,
                'error',       SQLERRM
            );
        END;
    END LOOP;

    RETURN v_actions;
END;
$$;

REVOKE ALL ON FUNCTION public.audit_game_template_rules(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.audit_game_template_rules(INTEGER) TO service_role;

COMMIT;
