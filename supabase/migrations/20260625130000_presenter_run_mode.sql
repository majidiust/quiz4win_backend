-- =============================================================================
-- Quiz4Win — Add 'presenter' run_mode for human-host-driven live games
-- Migration: 20260625130000_presenter_run_mode.sql
-- Author:    A-01 (Augment Code Agent) — 2026-06-25
-- =============================================================================
-- Adds a new, ADDITIVE concept: a live game assigned to a human host (and with
-- NO AI presenter) runs in command-driven `presenter` run_mode, so the host-app
-- can drive the question flow (PrepareQuestion/StartQuestion/CloseQuestion/
-- AdvanceQuestion/FinalizeGame) via the orchestrator — exactly the same command
-- path the AI presenter would use. The existing `auto` (timer-driven) flow used
-- by automated and AI-decorative games is left completely UNCHANGED.
--
-- Mutual exclusion (enforced once at the DB layer, not scattered across the 4+
-- host-assignment code paths):
--   * host assigned  AND template.ai_enabled = FALSE  → run_mode = 'presenter'
--   * host removed (or AI-enabled)                     → run_mode reverts to 'auto'
-- Only the auto ⇄ presenter transition is ever touched; admin-set 'manual'/'live'
-- values are preserved verbatim.
--
-- Rule compliance:
--   R-05 — games is not the financial ledger; status/run_mode updates allowed.
--   R-06 — no reverse imports.
--   R-12 — applied exclusively by db-maintainer.
--   R-16 — additive-only; widens an enum CHECK and adds a BEFORE trigger; no
--          existing response shape or behaviour changes.
-- =============================================================================

BEGIN;

-- ─── (1) Widen the run_mode CHECK constraint to include 'presenter' ──────────
-- The original constraint was created inline (ADD COLUMN … CHECK …) in
-- 20260528360000 and carries an auto-generated name. Drop whatever CHECK
-- currently constrains run_mode, then add a stable, explicitly-named one.
DO $$
DECLARE r RECORD;
BEGIN
    FOR r IN
        SELECT con.conname
          FROM pg_constraint con
          JOIN pg_class     rel ON rel.oid = con.conrelid
          JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
         WHERE nsp.nspname = 'public'
           AND rel.relname = 'games'
           AND con.contype = 'c'
           AND pg_get_constraintdef(con.oid) ILIKE '%run_mode%'
    LOOP
        EXECUTE format('ALTER TABLE public.games DROP CONSTRAINT %I', r.conname);
    END LOOP;
END $$;

ALTER TABLE public.games
    ADD CONSTRAINT games_run_mode_check
    CHECK (run_mode IN ('auto', 'manual', 'live', 'presenter'));

-- ─── (2) Single-point mutual-exclusion trigger ──────────────────────────────
-- BEFORE INSERT (covers generate_game_from_template) and BEFORE UPDATE OF
-- host_id (covers admin direct assign, invitation accept, request approve, and
-- unassign) so every host-assignment path is handled in one place.
CREATE OR REPLACE FUNCTION public.set_presenter_run_mode()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_ai_enabled BOOLEAN := FALSE;
BEGIN
    IF NEW.template_id IS NOT NULL THEN
        SELECT COALESCE(ai_enabled, FALSE) INTO v_ai_enabled
          FROM public.game_templates
         WHERE id = NEW.template_id;
    END IF;
    v_ai_enabled := COALESCE(v_ai_enabled, FALSE);

    IF NEW.host_id IS NOT NULL AND v_ai_enabled = FALSE THEN
        -- Human host, no AI: command-driven presenter mode (only promote auto).
        IF NEW.run_mode = 'auto' THEN
            NEW.run_mode := 'presenter';
        END IF;
    ELSIF NEW.run_mode = 'presenter' THEN
        -- No host (or AI-driven): fall back to the automatic timer flow.
        NEW.run_mode := 'auto';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_presenter_run_mode ON public.games;
CREATE TRIGGER trg_set_presenter_run_mode
BEFORE INSERT OR UPDATE OF host_id ON public.games
FOR EACH ROW
EXECUTE FUNCTION public.set_presenter_run_mode();

COMMENT ON FUNCTION public.set_presenter_run_mode() IS
    'Keeps games.run_mode in sync with host assignment: a host-assigned, '
    'non-AI game runs command-driven (''presenter''); removing the host (or an '
    'AI-enabled template) reverts to the automatic timer flow (''auto''). Only '
    'the auto<->presenter transition is touched; ''manual''/''live'' are preserved.';

-- ─── (3) One-time backfill for already-scheduled host-driven games ───────────
-- Templated games whose template has AI disabled.
UPDATE public.games g
   SET run_mode = 'presenter', updated_at = NOW()
  FROM public.game_templates t
 WHERE g.template_id = t.id
   AND g.host_id IS NOT NULL
   AND COALESCE(t.ai_enabled, FALSE) = FALSE
   AND g.run_mode = 'auto'
   AND g.status IN ('upcoming', 'open');

-- Template-less games with a host assigned.
UPDATE public.games g
   SET run_mode = 'presenter', updated_at = NOW()
 WHERE g.template_id IS NULL
   AND g.host_id IS NOT NULL
   AND g.run_mode = 'auto'
   AND g.status IN ('upcoming', 'open');

COMMIT;
