-- =============================================================================
-- 20260525220000_games_currency_and_featured.sql
--
-- Adds two fields to public.games required by the customer app GameSummary:
--
--   * prize_pool_currency — ISO-4217 (or local) currency code the UI uses to
--     pick the right symbol ($, AED, ﷼, …). Defaults to 'USD' to preserve the
--     existing behaviour for all current rows.
--   * is_featured         — boolean toggle that drives the hero/carousel slot
--     on the home screen. Defaults to FALSE.
--
-- Both columns are NOT NULL with safe defaults so existing INSERTs and the
-- admin Game create/edit dialog keep working without changes. is_featured
-- gets a partial index so the "featured only" lookup the home screen does
-- stays fast even as the games table grows.
-- =============================================================================

ALTER TABLE public.games
  ADD COLUMN IF NOT EXISTS prize_pool_currency TEXT    NOT NULL DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS is_featured         BOOLEAN NOT NULL DEFAULT FALSE;

-- Partial index — the home-screen "featured carousel" query only ever filters
-- on is_featured = TRUE, so we don't need to index the (much larger) FALSE
-- partition.
CREATE INDEX IF NOT EXISTS idx_games_is_featured
  ON public.games (is_featured)
  WHERE is_featured = TRUE;
