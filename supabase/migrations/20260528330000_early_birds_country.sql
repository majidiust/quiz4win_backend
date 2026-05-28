-- ============================================================
-- Migration: early_birds — add country fields
-- Created : 2026-05-28
-- Purpose : Capture country name and ISO 3166-1 alpha-2 code
--           from mobile early-access sign-ups.
-- Rules   : R-01 (no PII leaked in public responses), R-05 (append-only)
-- ============================================================

ALTER TABLE public.early_birds
  ADD COLUMN IF NOT EXISTS country      TEXT CHECK (char_length(trim(country))      <= 100),
  ADD COLUMN IF NOT EXISTS country_code TEXT CHECK (char_length(trim(country_code)) =  2);

COMMENT ON COLUMN public.early_birds.country      IS 'Full country name, e.g. "Canada"';
COMMENT ON COLUMN public.early_birds.country_code IS 'ISO 3166-1 alpha-2 country code, e.g. "CA". Always stored uppercase.';

-- Index for admin browsing / analytics by country
CREATE INDEX IF NOT EXISTS early_birds_country_code_idx
  ON public.early_birds (country_code, created_at DESC);
