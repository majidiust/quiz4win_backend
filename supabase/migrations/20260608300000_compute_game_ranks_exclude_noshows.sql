-- =============================================================================
-- Quiz4Win — compute_game_ranks: exclude pure no-show participants (Option A)
-- 2026-06-08 — A-01
--
-- Domain rule (Option A, user-approved 2026-06-08):
--   A participant must have submitted at least one answer (correct OR wrong)
--   to be eligible for prize ranking. A player who registered but never
--   showed up ("ghost") is excluded from ranking regardless of the game's
--   elimination setting (including unlimited-lives / score-only games where
--   the ghost sweep never sets eliminated=TRUE).
--
-- Mechanism:
--   `game_participants.wrong_answers` is now incremented by the orchestrator
--   only on real wrong submissions (handlePersistAnswer). Ghost-sweep
--   no-answers only increment `wrong_count`, leaving `wrong_answers` at 0.
--   Correct answers increment `correct_answers` (already maintained).
--
--   A pure no-show therefore always has:
--     correct_answers = 0  AND  wrong_answers = 0
--
--   This migration adds that filter to the survivor CTE so no-shows receive
--   rank = NULL and are skipped by distribute_prizes.
--
-- Rules:
--   R-05 — append-only finance preserved (no UPDATE/DELETE on transactions).
--   R-06 — only SECURITY DEFINER RPCs write to game_participants.rank.
--   R-12 — applied by db-maintainer only.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.compute_game_ranks(p_game_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Survivors only:
    --   • participant_role = 'participant' AND eliminated = FALSE  (existing)
    --   • correct_answers > 0 OR wrong_answers > 0                (Option A: played)
    -- Pure no-shows (registered but never answered a single question) have
    -- both counters at 0 and are excluded regardless of elimination setting.
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
          AND  (correct_answers > 0 OR wrong_answers > 0)
    )
    UPDATE public.game_participants gp
       SET rank         = ranked.r,
           status       = CASE WHEN gp.status = 'active' THEN 'completed' ELSE gp.status END,
           completed_at = COALESCE(gp.completed_at, NOW())
      FROM ranked
     WHERE gp.id = ranked.id;

    -- Eliminated players AND no-shows: clear any stale rank, stamp status so
    -- the post-game UI has a single authoritative finish marker per row.
    UPDATE public.game_participants
       SET rank         = NULL,
           status       = CASE WHEN status = 'active' THEN 'disqualified' ELSE status END,
           completed_at = COALESCE(completed_at, NOW())
     WHERE game_id    = p_game_id
       AND role       = 'player'
       AND (
             participant_role = 'eliminated'
          OR eliminated       = TRUE
          OR (correct_answers = 0 AND wrong_answers = 0)
           );
END;
$$;

REVOKE ALL ON FUNCTION public.compute_game_ranks(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.compute_game_ranks(UUID) TO service_role;

COMMIT;
