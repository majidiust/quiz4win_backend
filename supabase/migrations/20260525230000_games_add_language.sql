-- Migration: add `language` column to public.games.
--
-- The customer API (GET /games, GET /games/:id) and docs/api-reference.md
-- already document a `language` field on every game (values: 'en','ar','fa','tr').
-- The initial schema accidentally omitted the column on the `games` table even
-- though it exists on `questions`, `profiles`, and `help_articles`.
--
-- Default = 'en' so all existing rows have a sensible value. The CHECK matches
-- the other language-bearing tables for consistency.

ALTER TABLE public.games
  ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT 'en'
    CHECK (language IN ('en','ar','fa','tr'));

CREATE INDEX IF NOT EXISTS idx_games_language ON public.games(language);
