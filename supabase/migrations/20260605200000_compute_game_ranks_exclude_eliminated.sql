-- =============================================================================
-- Quiz4Win — compute_game_ranks excludes eliminated players
-- 2026-06-05 — A-01
--
-- Domain rule (Domain_Knowledge.md / user spec):
--   "The prize pool is always distributed only among the players who remain
--    in the game until the end and successfully survive all elimination
--    rules."
--
-- The previous compute_game_ranks ranked every `role='player'` row
-- regardless of whether the player had been eliminated by wrong answers or
-- by missing question windows. distribute_prizes pays anyone whose rank
-- falls inside a prize tier range, so an eliminated player at score 0 could
-- still occupy a prize rank when survivors were few.
--
-- This migration rewrites compute_game_ranks to only RANK() over rows where
-- `participant_role = 'participant' AND eliminated = FALSE`. Eliminated
-- players keep rank=NULL and never appear in any tier's BETWEEN range, so
-- distribute_prizes naturally skips them. Their `status` is flipped to
-- 'disqualified' so the post-game UI can distinguish "completed" survivors
-- from "disqualified" eliminated players without re-deriving from
-- participant_role.
--
-- Rule compliance:
--   R-05 — Append-only finance preserved (no transactions UPDATE/DELETE).
--   R-06 — Only SECURITY DEFINER RPCs write to game_participants.rank.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.compute_game_ranks(p_game_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Survivors only — eliminated players are not part of the prize ranking.
    WITH ranked AS (
        SELECT id,
               RANK() OVER (
                   ORDER BY score DESC, correct_answers DESC, joined_at ASC
               ) AS r
        FROM   public.game_participants
        WHERE  game_id          = p_game_id
          AND  role             = 'player'
          AND  participant_role = 'participant'
          AND  eliminated       = FALSE
    )
    UPDATE public.game_participants gp
       SET rank         = ranked.r,
           status       = CASE WHEN gp.status = 'active' THEN 'completed' ELSE gp.status END,
           completed_at = COALESCE(gp.completed_at, NOW())
      FROM ranked
     WHERE gp.id = ranked.id;

    -- Eliminated players: clear any stale rank from earlier runs and stamp
    -- status='disqualified' / completed_at so the post-game UI has a single
    -- authoritative finish marker per row.
    UPDATE public.game_participants
       SET rank         = NULL,
           status       = CASE WHEN status = 'active' THEN 'disqualified' ELSE status END,
           completed_at = COALESCE(completed_at, NOW())
     WHERE game_id    = p_game_id
       AND role       = 'player'
       AND (participant_role = 'eliminated' OR eliminated = TRUE);
END;
$$;

REVOKE ALL ON FUNCTION public.compute_game_ranks(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.compute_game_ranks(UUID) TO service_role;

COMMIT;
