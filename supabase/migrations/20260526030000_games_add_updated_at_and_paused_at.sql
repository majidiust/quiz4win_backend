-- Migration: add `updated_at` and `paused_at` columns to public.games.
--
-- The admin handler (supabase/functions/admin-games/index.ts) writes
-- `updated_at` on every games row mutation (edit, cancel, pause, resume,
-- asset upload, questions reorder) and `paused_at` on pause/resume. The
-- initial schema only declared `created_at`, so every admin write that
-- relied on PostgREST schema cache failed with:
--   "Could not find the 'updated_at' column of 'games' in the schema cache"
--
-- Existing rows get updated_at = NOW() (column DEFAULT) at migration time,
-- which is a sensible "last touched" value going forward. paused_at stays
-- NULL (no game has ever been paused).
--
-- Note: pause/resume also requires the status CHECK constraint to allow
-- 'paused'. That is intentionally NOT changed here — pause is not yet a
-- live feature, and tightening the constraint is a separate decision.

ALTER TABLE public.games
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS paused_at  TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_games_updated_at ON public.games(updated_at);
