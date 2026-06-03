-- =============================================================================
-- Quiz4Win — Mid-game Participant Notifications
-- 2026-06-04
--
-- Adds functionality to send notifications to all participants during live games.
--
-- Pipeline:
--   1. get_game_participant_push_tokens(p_game_id) — returns push tokens for all participants
--   2. template-generator service sends FCM notifications via sendFcmToTokens
--   3. Stores notification records in public.notifications table
--
-- Rule compliance:
--   R-01 — No secrets logged; only delivery counts surface
--   R-05 — Append-only: only INSERTs to notifications table
--   R-06 — generator service is the only writer to notifications for this feature
--   R-08 — Not applicable (general notifications, not withdrawal-specific)
-- =============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- RPC: get_game_participant_push_tokens
--   Returns every push_tokens.token for users who are participants in the game
--   and have notifications enabled (via notification_preferences or default TRUE).
--   Used by the template-generator service to send mid-game participant notifications.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_game_participant_push_tokens(p_game_id UUID)
RETURNS TABLE (
    user_id      UUID,
    token        TEXT,
    platform     TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT DISTINCT pt.user_id,
                    pt.token,
                    pt.platform
    FROM   public.game_participants gp
    JOIN   public.push_tokens pt ON pt.user_id = gp.user_id
    LEFT JOIN public.notification_preferences np ON np.user_id = gp.user_id
    WHERE  gp.game_id      = p_game_id
      AND  COALESCE(np.game_notifications, TRUE) = TRUE;
$$;

REVOKE ALL ON FUNCTION public.get_game_participant_push_tokens(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_game_participant_push_tokens(UUID) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Optional: Add columns to track last mid-game notification sent (for rate limiting)
-- Alternative approach: use existing notifications table with type='mid_game' and 
-- query for recent notifications when deciding whether to send a new one.
-- ─────────────────────────────────────────────────────────────────────────────

-- ALTER TABLE public.games
--     ADD COLUMN IF NOT EXISTS last_mid_game_notification_at TIMESTAMPTZ;

COMMENT ON COLUMN public.games.last_mid_game_notification_at IS
    'When the last mid-game participant notification was sent for this game. '
    'Used for rate limiting to avoid spamming participants.';

COMMIT;