-- =============================================================================
-- force_finalize_stuck_games(grace_minutes)
-- =============================================================================
-- Watchdog RPC for games whose duration window has expired but the
-- orchestrator never delivered GAME_ENDED (process crash, DB hiccup, etc).
--
-- Selects games where:
--   status = 'live'
--   AND started_at + template.duration_minutes + grace_minutes <= NOW()
--
-- and atomically flips them to status='completed', ended_at=NOW().
--
-- Prize distribution is intentionally NOT touched here — only the lifecycle
-- state is recovered so the template's overlap rule unblocks generation of
-- the next upcoming game. Prize/winner reconciliation remains a separate
-- concern handled by the orchestrator (or a future reconciler).
--
-- Returns one row per game that was actually flipped, for caller logging.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.force_finalize_stuck_games(
    p_grace_minutes INTEGER DEFAULT 5
) RETURNS TABLE (
    game_id        UUID,
    template_id    UUID,
    started_at     TIMESTAMPTZ,
    expected_end   TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    WITH stuck AS (
        SELECT g.id,
               g.template_id,
               g.started_at,
               g.started_at
                 + (COALESCE(t.duration_minutes, 30) || ' minutes')::INTERVAL
                 + (p_grace_minutes || ' minutes')::INTERVAL  AS expected_end_at
          FROM public.games g
          LEFT JOIN public.game_templates t ON t.id = g.template_id
         WHERE g.status = 'live'
           AND g.started_at IS NOT NULL
           AND g.started_at
                 + (COALESCE(t.duration_minutes, 30) || ' minutes')::INTERVAL
                 + (p_grace_minutes || ' minutes')::INTERVAL <= NOW()
    ),
    upd AS (
        UPDATE public.games AS g
           SET status     = 'completed',
               ended_at   = NOW(),
               updated_at = NOW()
          FROM stuck s
         WHERE g.id = s.id
           AND g.status = 'live'   -- race guard
         RETURNING g.id AS flipped_id
    )
    SELECT s.id, s.template_id, s.started_at, s.expected_end_at
      FROM stuck s
      JOIN upd  u ON u.flipped_id = s.id;
END;
$$;

REVOKE ALL ON FUNCTION public.force_finalize_stuck_games(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.force_finalize_stuck_games(INTEGER) TO service_role;

COMMIT;
