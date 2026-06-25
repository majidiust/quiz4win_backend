-- =============================================================================
-- Quiz4Win — Host assignment lifecycle: free the host once a game ends
-- Migration: 20260625140000_host_assignment_lifecycle_fix.sql
-- Author:    A-01 (Augment Code Agent) — 2026-06-25
-- =============================================================================
-- Bug (reported): a host runs an assigned recurring game; after it FINISHES the
-- host requests the next slot, but admin approval fails with "schedule conflict"
-- even though the previous game already ended.
--
-- Root cause (INV-17 helper `check_host_schedule_conflict`):
--   * Branch 1 (assigned games) already filtered g.status IN
--     ('upcoming','open','live'), but branches 2 (accepted invitations) and 3
--     (approved game requests) joined `games` WITHOUT filtering on g.status.
--   * Nothing ever moved a host's request/invitation to a terminal state when
--     its game ended — the row stayed 'approved'/'accepted' forever (the only
--     cleanup trigger, close_stale_host_offers_on_assign, fires on host_id
--     changes, not on game completion).
--   ⇒ A completed game's lingering 'approved' request kept counting its
--     [scheduled_at, scheduled_at + 90 min) window as an active commitment, so
--     for a 20-minute recurring template the next slot always "overlapped".
--
-- Fix (additive, backward-compatible — R-16):
--   (1) Add a terminal 'completed' state to the host_game_requests,
--       host_invitations, and games.host_assignment_status CHECKs.
--   (2) check_host_schedule_conflict — filter g.status IN
--       ('upcoming','open','live') in ALL THREE branches so completed/cancelled
--       games can never block a future assignment.
--   (3) BEFORE UPDATE OF status trigger: when a game transitions into a terminal
--       status, mark the assigned host's request/invitation (and the game's
--       host_assignment_status) terminal so availability is recalculated the
--       moment the game ends — no cache, no background job.
--   (4) One-time backfill: close the already-stale rows so currently-stuck
--       hosts become available immediately (no manual SQL required).
--
-- Rule compliance:
--   R-02 — no monetary columns touched.
--   R-05 — host_game_requests / host_invitations are lifecycle tables, NOT the
--          financial ledger; status transitions are permitted. host_earnings is
--          untouched.
--   R-06 — no reverse imports.
--   R-12 — applied exclusively by db-maintainer.
--   R-16 — additive only; existing status values preserved, new states added.
--   INV-17 — preserved & corrected: a commitment counts only while its game has
--            a future/active live window (upcoming/open/live).
-- =============================================================================

BEGIN;

-- ─── 1. Widen status CHECKs with a terminal 'completed' state ────────────────
ALTER TABLE public.host_game_requests
    DROP CONSTRAINT IF EXISTS host_game_requests_status_check;
ALTER TABLE public.host_game_requests
    ADD CONSTRAINT host_game_requests_status_check
    CHECK (status IN ('pending','approved','rejected','cancelled','completed'));

ALTER TABLE public.host_invitations
    DROP CONSTRAINT IF EXISTS host_invitations_status_check;
ALTER TABLE public.host_invitations
    ADD CONSTRAINT host_invitations_status_check
    CHECK (status IN ('sent','accepted','rejected','expired','cancelled','completed'));

ALTER TABLE public.games
    DROP CONSTRAINT IF EXISTS games_host_assignment_status_check;
ALTER TABLE public.games
    ADD CONSTRAINT games_host_assignment_status_check
    CHECK (host_assignment_status IN ('unassigned','pending','accepted','rejected','completed'));

-- ─── 2. check_host_schedule_conflict — count ACTIVE commitments only ─────────
CREATE OR REPLACE FUNCTION public.check_host_schedule_conflict(
    p_host_id UUID,
    p_game_id UUID
) RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_scheduled_at TIMESTAMPTZ;
    v_window       INTERVAL := INTERVAL '90 minutes';
    v_start        TIMESTAMPTZ;
    v_end          TIMESTAMPTZ;
BEGIN
    SELECT scheduled_at INTO v_scheduled_at FROM public.games WHERE id = p_game_id;
    IF v_scheduled_at IS NULL THEN RETURN FALSE; END IF;
    v_start := v_scheduled_at;
    v_end   := v_scheduled_at + v_window;

    -- (A) Assigned games (games.host_id) with a future/active live window.
    IF EXISTS (
        SELECT 1 FROM public.games g
        WHERE g.host_id = p_host_id
          AND g.id <> p_game_id
          AND g.status IN ('upcoming','open','live')
          AND g.scheduled_at IS NOT NULL
          AND tstzrange(g.scheduled_at, g.scheduled_at + v_window) && tstzrange(v_start, v_end)
    ) THEN RETURN TRUE; END IF;

    -- (B) Accepted invitations whose game is still active (NOT completed/cancelled).
    IF EXISTS (
        SELECT 1 FROM public.host_invitations hi
        JOIN public.games g ON g.id = hi.game_id
        WHERE hi.host_id = p_host_id
          AND hi.status = 'accepted'
          AND hi.game_id <> p_game_id
          AND g.status IN ('upcoming','open','live')
          AND g.scheduled_at IS NOT NULL
          AND tstzrange(g.scheduled_at, g.scheduled_at + v_window) && tstzrange(v_start, v_end)
    ) THEN RETURN TRUE; END IF;

    -- (C) Approved game requests whose game is still active (NOT completed/cancelled).
    IF EXISTS (
        SELECT 1 FROM public.host_game_requests hr
        JOIN public.games g ON g.id = hr.game_id
        WHERE hr.host_id = p_host_id
          AND hr.status = 'approved'
          AND hr.game_id <> p_game_id
          AND g.status IN ('upcoming','open','live')
          AND g.scheduled_at IS NOT NULL
          AND tstzrange(g.scheduled_at, g.scheduled_at + v_window) && tstzrange(v_start, v_end)
    ) THEN RETURN TRUE; END IF;

    RETURN FALSE;
END;
$$;

COMMENT ON FUNCTION public.check_host_schedule_conflict(UUID, UUID) IS
  'INV-17 host schedule conflict check. Returns TRUE if the host has another '
  'commitment whose game is still active (upcoming/open/live) and whose 90-minute '
  'window overlaps the target. Completed/cancelled games never count.';

-- ─── 3. Free the host when the game ends ─────────────────────────────────────
-- When games.status transitions into a terminal state, move the assigned host's
-- own non-terminal request/invitation to a terminal state and stamp the game's
-- host_assignment_status. Runs BEFORE UPDATE so it can set NEW.host_assignment_
-- status in-place (no self-UPDATE → no trigger recursion). Distinct from
-- close_stale_host_offers_on_assign (which fires on host_id changes).
CREATE OR REPLACE FUNCTION public.complete_host_assignment_on_game_end()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_terminal TEXT;
BEGIN
    IF NEW.status IN ('completed','cancelled')
       AND OLD.status IS DISTINCT FROM NEW.status
       AND NEW.host_id IS NOT NULL THEN

        v_terminal := CASE WHEN NEW.status = 'completed' THEN 'completed' ELSE 'cancelled' END;

        UPDATE public.host_game_requests
           SET status     = v_terminal,
               admin_note = COALESCE(admin_note, '') ||
                            CASE WHEN admin_note IS NULL OR admin_note = '' THEN '' ELSE E'\n' END ||
                            '[auto] game ' || NEW.status,
               updated_at = NOW()
         WHERE game_id = NEW.id
           AND host_id = NEW.host_id
           AND status  IN ('pending','approved');

        UPDATE public.host_invitations
           SET status        = v_terminal,
               response_note = COALESCE(response_note, '') ||
                               CASE WHEN response_note IS NULL OR response_note = '' THEN '' ELSE E'\n' END ||
                               '[auto] game ' || NEW.status,
               updated_at    = NOW()
         WHERE game_id = NEW.id
           AND host_id = NEW.host_id
           AND status  IN ('sent','accepted');

        -- Reflect the terminal assignment on the game row itself.
        IF NEW.host_assignment_status IN ('pending','accepted') THEN
            NEW.host_assignment_status := 'completed';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_complete_host_assignment_on_game_end ON public.games;
CREATE TRIGGER trg_complete_host_assignment_on_game_end
BEFORE UPDATE OF status ON public.games
FOR EACH ROW
EXECUTE FUNCTION public.complete_host_assignment_on_game_end();

COMMENT ON FUNCTION public.complete_host_assignment_on_game_end() IS
    'When a game enters a terminal status (completed/cancelled), mark the '
    'assigned host''s request/invitation and games.host_assignment_status terminal '
    'so the host is freed for new assignments (INV-17).';

-- ─── 4. One-time backfill — release hosts already stuck behind ended games ───
-- host_game_requests: completed game → 'completed'; cancelled game → 'cancelled'.
UPDATE public.host_game_requests hr
   SET status     = CASE WHEN g.status = 'completed' THEN 'completed' ELSE 'cancelled' END,
       admin_note = COALESCE(hr.admin_note, '') ||
                    CASE WHEN hr.admin_note IS NULL OR hr.admin_note = '' THEN '' ELSE E'\n' END ||
                    '[auto] game ' || g.status || ' (backfill)',
       updated_at = NOW()
  FROM public.games g
 WHERE g.id = hr.game_id
   AND g.status IN ('completed','cancelled')
   AND hr.host_id = g.host_id
   AND hr.status  IN ('pending','approved');

UPDATE public.host_invitations hi
   SET status        = CASE WHEN g.status = 'completed' THEN 'completed' ELSE 'cancelled' END,
       response_note = COALESCE(hi.response_note, '') ||
                       CASE WHEN hi.response_note IS NULL OR hi.response_note = '' THEN '' ELSE E'\n' END ||
                       '[auto] game ' || g.status || ' (backfill)',
       updated_at    = NOW()
  FROM public.games g
 WHERE g.id = hi.game_id
   AND g.status IN ('completed','cancelled')
   AND hi.host_id = g.host_id
   AND hi.status  IN ('sent','accepted');

-- games.host_assignment_status: ended game still flagged pending/accepted → completed.
UPDATE public.games
   SET host_assignment_status = 'completed',
       updated_at             = NOW()
 WHERE status IN ('completed','cancelled')
   AND host_id IS NOT NULL
   AND host_assignment_status IN ('pending','accepted');

COMMIT;
