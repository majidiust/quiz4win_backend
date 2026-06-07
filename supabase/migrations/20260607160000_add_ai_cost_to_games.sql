-- Migration: add AI generation cost tracking to public.games.
--
-- The orchestrator accumulates OpenAI token usage across all generateQuestion()
-- calls for a game and stores the running cost here. Values are stored as
-- integer micro-dollars (1 = $0.000001) to avoid floats (R-02 spirit) while
-- still representing sub-cent costs accurately.
--
-- ai_cost_usd is a generated column for human-readable display only;
-- ai_cost_microdollars is the authoritative value.
--
-- The orchestrator uses PATCH games?id=eq.{id} with
--   { ai_cost_microdollars: <new total> }
-- after every question generation.

BEGIN;

ALTER TABLE public.games
  ADD COLUMN IF NOT EXISTS ai_cost_microdollars BIGINT NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.games.ai_cost_microdollars IS
  'Accumulated OpenAI cost for this game in micro-dollars (1 = $0.000001). '
  'Incremented after each generateQuestion() call by the orchestrator.';

COMMIT;
