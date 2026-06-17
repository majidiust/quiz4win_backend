-- =============================================================================
-- Quiz4Win — Per-game / per-template "requires host" flag
-- Migration: 20260617010000_game_requires_host.sql
-- Author:    A-01 (Augment Code Agent) — 2026-06-17
-- =============================================================================
-- Adds a boolean flag that controls whether a game (or generated game) needs a
-- human host. When FALSE, the game is excluded from the host-app "available"
-- list so hosts cannot apply for / be offered games that do not need a host.
--
--   requires_host BOOLEAN NOT NULL DEFAULT TRUE
--
-- DEFAULT TRUE preserves current behaviour (existing live games keep showing in
-- the host application); admins disable it per-template or per-game when a game
-- is fully automated / AI-presented and needs no host.
--
-- Rule compliance:
--   R-06 — no reverse imports.
--   R-12 — applied exclusively by db-maintainer.
-- =============================================================================

BEGIN;

ALTER TABLE public.game_templates
  ADD COLUMN IF NOT EXISTS requires_host BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE public.games
  ADD COLUMN IF NOT EXISTS requires_host BOOLEAN NOT NULL DEFAULT TRUE;

COMMIT;
