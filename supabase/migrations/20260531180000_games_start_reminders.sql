-- Migration: games_start_reminders
-- Created : 2026-05-31
-- Purpose : Track "game starts soon" push reminders sent by the
--           template-generator service. Three reminder windows:
--             T-60 minutes, T-10 minutes, T-1 minute.
--           Each column is set to NOW() the first time that reminder is
--           successfully fanned-out, making the dispatch idempotent across
--           ticks and across service restarts.
--
-- The template-generator selects games where:
--   status IN ('upcoming','open')
--   scheduled_at > NOW()
--   scheduled_at <= NOW() + <window>
--   reminder_<window>_sent_at IS NULL
--
-- The partial indexes keep the per-tick scan O(few rows) regardless of how
-- many historical games exist — only rows whose reminder is still pending
-- live in each index.
--
-- Rule compliance:
--   R-05 — non-financial; no UPDATE/DELETE on transactions.
--   R-06 — generator service is the only writer.

BEGIN;

ALTER TABLE public.games
    ADD COLUMN IF NOT EXISTS reminder_60m_sent_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS reminder_10m_sent_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS reminder_1m_sent_at  TIMESTAMPTZ;

COMMENT ON COLUMN public.games.reminder_60m_sent_at IS
    'When the T-60min "starts in 1 hour" push reminder was fanned-out.';
COMMENT ON COLUMN public.games.reminder_10m_sent_at IS
    'When the T-10min "starts in 10 minutes" push reminder was fanned-out.';
COMMENT ON COLUMN public.games.reminder_1m_sent_at  IS
    'When the T-1min "starts now" push reminder was fanned-out.';

CREATE INDEX IF NOT EXISTS idx_games_reminder_60m_pending
    ON public.games (scheduled_at)
    WHERE reminder_60m_sent_at IS NULL AND status IN ('upcoming','open');

CREATE INDEX IF NOT EXISTS idx_games_reminder_10m_pending
    ON public.games (scheduled_at)
    WHERE reminder_10m_sent_at IS NULL AND status IN ('upcoming','open');

CREATE INDEX IF NOT EXISTS idx_games_reminder_1m_pending
    ON public.games (scheduled_at)
    WHERE reminder_1m_sent_at IS NULL AND status IN ('upcoming','open');

-- ─────────────────────────────────────────────────────────────────────────────
-- RPC: get_game_reminder_push_tokens
--   Returns every push_tokens.token whose owner has notification_preferences
--   game_reminders = TRUE (or no preferences row, since the column default is
--   TRUE). Used by the template-generator service to fan-out start reminders.
--
--   SECURITY DEFINER so the service-role caller can read aggregated tokens
--   without bypassing RLS on push_tokens directly.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_game_reminder_push_tokens()
RETURNS TABLE (user_id UUID, token TEXT, platform TEXT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT pt.user_id, pt.token, pt.platform
    FROM   public.push_tokens pt
    LEFT JOIN public.notification_preferences np ON np.user_id = pt.user_id
    WHERE  COALESCE(np.game_reminders, TRUE) = TRUE;
$$;

REVOKE ALL ON FUNCTION public.get_game_reminder_push_tokens() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_game_reminder_push_tokens() TO service_role;

COMMIT;
