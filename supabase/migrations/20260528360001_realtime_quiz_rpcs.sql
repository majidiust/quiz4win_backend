-- ============================================================================
-- Migration: realtime_quiz_redis_ref
-- Created : 2026-05-28 (supersedes Postgres-RPC draft)
-- Purpose : Add Redis reference columns to the games table (§3.8) so the
--           Game Orchestrator can store the Redis namespace/cluster ID and
--           expiry alongside the persistent game record.
--
--           During an active game, Redis is the source of truth (§2.1).
--           The database only stores the reference needed to reconstruct
--           or audit game state, not the live state itself.
--
--           Also removes any previously-created Postgres SECURITY DEFINER
--           functions that incorrectly replicated Redis Lua atomicity in SQL
--           (FOR UPDATE row locks ≠ Redis Lua atomicity per §9.3/§19.6).
--
-- Rules   : R-05 (append-only ledger), R-06 (no cross-module imports)
-- ============================================================================

BEGIN;

-- ─── 1. Drop incorrect Postgres RPCs if they were somehow applied ────────────
-- (Safe to run even if they don't exist — IF EXISTS guards the DROP.)
DROP FUNCTION IF EXISTS public.join_game_session(UUID, UUID, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.start_game_question(UUID, INTEGER, INTEGER);
DROP FUNCTION IF EXISTS public.close_game_question(UUID);
DROP FUNCTION IF EXISTS public.submit_answer_v2(UUID, UUID, UUID, TEXT, UUID, INTEGER, TEXT, TEXT, TEXT);

-- ─── 2. Redis reference columns on games (§3.8) ─────────────────────────────
-- Store only the cluster/namespace reference, not the password or raw state.
ALTER TABLE public.games
    ADD COLUMN IF NOT EXISTS redis_namespace   TEXT,
    ADD COLUMN IF NOT EXISTS redis_cluster_id  TEXT,
    ADD COLUMN IF NOT EXISTS redis_started_at  TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS redis_expires_at  TIMESTAMPTZ;

COMMENT ON COLUMN public.games.redis_namespace  IS
    'Redis key prefix used for this game session (set by Orchestrator at start).';
COMMENT ON COLUMN public.games.redis_cluster_id IS
    'Identifier of the Redis cluster/instance serving this game (for multi-cluster HA).';
COMMENT ON COLUMN public.games.redis_expires_at IS
    'When the Orchestrator will TTL the Redis keys (normally game end + buffer).';

COMMIT;

