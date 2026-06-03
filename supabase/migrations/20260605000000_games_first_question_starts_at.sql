-- =============================================================================
-- Quiz4Win — Pregame warmup: first_question_starts_at on public.games
-- 2026-06-05
--
-- Adds a nullable TIMESTAMPTZ column that records the server-decided moment at
-- which the orchestrator will start broadcasting question 0 for an auto-mode
-- game. Set when StartGame begins the 2-minute pregame warmup so the client
-- can render a synchronized countdown (and so recoverRunningGames can honor
-- the remaining warmup after an orchestrator restart).
--
-- Rule compliance:
--   R-05 — Append-only financial rule does not apply (games is non-financial).
--   R-06 — Only the game-orchestrator writes this column.
-- =============================================================================

BEGIN;

ALTER TABLE public.games
    ADD COLUMN IF NOT EXISTS first_question_starts_at TIMESTAMPTZ;

COMMENT ON COLUMN public.games.first_question_starts_at IS
    'Server-decided UTC instant at which question 0 will be broadcast for ' ||
    'auto-mode games. Populated by the orchestrator when StartGame fires; ' ||
    'used by clients to render the pregame countdown and by the orchestrator ' ||
    'to honor any remaining warmup after a restart.';

COMMIT;
