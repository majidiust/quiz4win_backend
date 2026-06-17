-- =============================================================================
-- Quiz4Win — Reset stale host offers when a host is unassigned from a game
-- Migration: 20260617020000_close_host_offers_on_unassign.sql
-- Author:    A-01 (Augment Code Agent) — 2026-06-17
-- =============================================================================
-- Bug: after an admin approved a host's game request (host_game_requests.status
-- = 'approved') and then later UNASSIGNED that host, the game returned to the
-- host-app "Available" list but still showed an "Approved" badge. The badge is
-- driven by the host's still-'approved' host_game_requests row, which neither
-- assignGameHost(null) nor updateGame(host_id:null) was clearing.
--
-- The pre-existing trigger close_stale_host_offers_on_assign only handled the
-- assignment direction (host_id NULL → NOT NULL). This migration extends the
-- same trigger to also handle removal (host_id NOT NULL → NULL, or a switch to
-- a different host): the previously-assigned host's non-terminal request is set
-- to 'cancelled' and any non-terminal invitation to 'expired'. This also clears
-- the row that check_host_schedule_conflict (INV-17) would otherwise count.
--
-- Rule compliance:
--   R-05 — host_game_requests / host_invitations are lifecycle tables, not the
--          financial ledger; status updates are permitted.
--   R-06 — no reverse imports.
--   R-12 — applied exclusively by db-maintainer.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.close_stale_host_offers_on_assign()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    -- (A) New assignment supersedes every OTHER host's still-open offer so two
    --     hosts cannot race for the same slot. (host_id NULL → NOT NULL, or a
    --     switch to a different host.)
    IF NEW.host_id IS NOT NULL AND (OLD.host_id IS NULL OR OLD.host_id <> NEW.host_id) THEN
        UPDATE public.host_game_requests
           SET status     = 'cancelled',
               admin_note = COALESCE(admin_note, '') ||
                            CASE WHEN admin_note IS NULL OR admin_note = '' THEN '' ELSE E'\n' END ||
                            '[auto] superseded by host assignment',
               updated_at = NOW()
         WHERE game_id = NEW.id
           AND status  = 'pending'
           AND host_id <> NEW.host_id;

        UPDATE public.host_invitations
           SET status        = 'expired',
               response_note = COALESCE(response_note, '') ||
                               CASE WHEN response_note IS NULL OR response_note = '' THEN '' ELSE E'\n' END ||
                               '[auto] superseded by host assignment',
               updated_at    = NOW()
         WHERE game_id = NEW.id
           AND status  = 'sent'
           AND host_id <> NEW.host_id;
    END IF;

    -- (B) Previous host removed (unassigned, or replaced by a different host):
    --     clear that host's own non-terminal request/invitation so the game
    --     returns cleanly to the available pool and the host-app stops showing a
    --     stale "Approved"/"Requested" badge. (host_id NOT NULL → NULL, or a
    --     switch to a different host.)
    IF OLD.host_id IS NOT NULL AND (NEW.host_id IS NULL OR NEW.host_id <> OLD.host_id) THEN
        UPDATE public.host_game_requests
           SET status     = 'cancelled',
               admin_note = COALESCE(admin_note, '') ||
                            CASE WHEN admin_note IS NULL OR admin_note = '' THEN '' ELSE E'\n' END ||
                            '[auto] host unassigned from game',
               updated_at = NOW()
         WHERE game_id = NEW.id
           AND host_id = OLD.host_id
           AND status  IN ('pending', 'approved');

        UPDATE public.host_invitations
           SET status        = 'expired',
               response_note = COALESCE(response_note, '') ||
                               CASE WHEN response_note IS NULL OR response_note = '' THEN '' ELSE E'\n' END ||
                               '[auto] host unassigned from game',
               updated_at    = NOW()
         WHERE game_id = NEW.id
           AND host_id = OLD.host_id
           AND status  IN ('sent', 'accepted');
    END IF;

    RETURN NEW;
END;
$$;

-- The trigger already fires AFTER UPDATE OF host_id (created in
-- 20260609000300); replacing the function body above is sufficient. Recreate it
-- defensively in case this migration runs on a DB where it was dropped.
DROP TRIGGER IF EXISTS trg_close_stale_host_offers_on_assign ON public.games;
CREATE TRIGGER trg_close_stale_host_offers_on_assign
AFTER UPDATE OF host_id ON public.games
FOR EACH ROW
EXECUTE FUNCTION public.close_stale_host_offers_on_assign();

COMMENT ON FUNCTION public.close_stale_host_offers_on_assign() IS
    'When games.host_id changes: (A) on assignment, cancel every OTHER host''s '
    'pending request and expire their sent invitations so two hosts cannot race; '
    '(B) on removal/replacement, cancel the previous host''s own pending/approved '
    'request and expire their sent/accepted invitation so the game returns to the '
    'available pool with no stale offer badge.';

-- ─── One-time backfill ──────────────────────────────────────────────────────
-- Clean up rows already left stale by the pre-fix unassign paths: any
-- pending/approved request (or sent/accepted invitation) whose game no longer
-- has that host assigned.
UPDATE public.host_game_requests hr
   SET status     = 'cancelled',
       admin_note = COALESCE(hr.admin_note, '') ||
                    CASE WHEN hr.admin_note IS NULL OR hr.admin_note = '' THEN '' ELSE E'\n' END ||
                    '[auto] host unassigned from game (backfill)',
       updated_at = NOW()
  FROM public.games g
 WHERE g.id = hr.game_id
   AND hr.status IN ('pending', 'approved')
   AND (g.host_id IS NULL OR g.host_id <> hr.host_id);

UPDATE public.host_invitations hi
   SET status        = 'expired',
       response_note = COALESCE(hi.response_note, '') ||
                       CASE WHEN hi.response_note IS NULL OR hi.response_note = '' THEN '' ELSE E'\n' END ||
                       '[auto] host unassigned from game (backfill)',
       updated_at    = NOW()
  FROM public.games g
 WHERE g.id = hi.game_id
   AND hi.status IN ('sent', 'accepted')
   AND (g.host_id IS NULL OR g.host_id <> hi.host_id);

COMMIT;
