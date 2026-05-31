-- =============================================================================
-- Quiz4Win — Prize distribution
-- 2026-05-31 — A-01
--
-- Adds the atomic, idempotent, safe prize-distribution pipeline that runs the
-- moment a game's status flips to 'completed'.
--
-- Pipeline:
--   1. compute_game_ranks(p_game_id) — RANK() by score desc, correct desc,
--      joined_at asc; persists rank and flips active->completed on participants.
--   2. distribute_prizes(p_game_id) — atomic, idempotent, SECURITY DEFINER:
--        • Locks the game row FOR UPDATE; requires status='completed'
--        • Skips work if games.prizes_distributed_at IS NOT NULL (returns
--          {already_distributed: true}) — safe to call N times
--        • Computes per-rank prize amounts from games.prize_breakdown JSONB
--          (supports {rank, amount}, {rank, percent}, {rank_from, rank_to,
--          amount|percent}). When breakdown is NULL or empty → winner-takes-all.
--        • For each winner: PERFORM credit_wallet(prize) +
--          UPDATE game_participants.prize_earned + profiles.total_prizes_won
--        • Stamps games.prizes_distributed_at, games.total_winners
--   3. get_winner_push_tokens(p_game_id) — returns one row per winner-token
--      pair for the template-generator's notification fan-out.
--
-- Rule compliance:
--   R-02 — NUMERIC dollars; no floats. (Existing credit_wallet contract.)
--   R-05 — Append-only finance: credit_wallet inserts a transaction row;
--          no UPDATE/DELETE on transactions anywhere here.
--   R-09 — Wallet credit + participant update are a single transaction.
-- =============================================================================

BEGIN;

ALTER TABLE public.games
    ADD COLUMN IF NOT EXISTS prizes_distributed_at      TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS prize_notifications_sent_at TIMESTAMPTZ;

COMMENT ON COLUMN public.games.prizes_distributed_at IS
    'When distribute_prizes() successfully credited winners. NULL ⇒ pending. '
    'Stamping this column is the idempotency anchor for the RPC.';
COMMENT ON COLUMN public.games.prize_notifications_sent_at IS
    'When the template-generator fanned out prize FCM pushes for this game. '
    'NULL ⇒ pending; set once the notification tick completes.';

-- Partial index — keeps the notification-tick scan O(few rows).
CREATE INDEX IF NOT EXISTS idx_games_prize_distribution_pending
    ON public.games (ended_at)
    WHERE status = 'completed' AND prizes_distributed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_games_prize_notifications_pending
    ON public.games (prizes_distributed_at)
    WHERE prizes_distributed_at IS NOT NULL AND prize_notifications_sent_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- compute_game_ranks
--   Persists 1-based competition rank on game_participants. Tie-breakers:
--   score desc, correct_answers desc, joined_at asc. Sets status='completed'
--   on rows still 'active' and stamps completed_at.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.compute_game_ranks(p_game_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    WITH ranked AS (
        SELECT id,
               RANK() OVER (
                   ORDER BY score DESC, correct_answers DESC, joined_at ASC
               ) AS r
        FROM   public.game_participants
        WHERE  game_id = p_game_id
          AND  role    = 'player'
    )
    UPDATE public.game_participants gp
       SET rank         = ranked.r,
           status       = CASE WHEN gp.status = 'active' THEN 'completed' ELSE gp.status END,
           completed_at = COALESCE(gp.completed_at, NOW())
      FROM ranked
     WHERE gp.id = ranked.id;
END;
$$;

REVOKE ALL ON FUNCTION public.compute_game_ranks(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.compute_game_ranks(UUID) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- get_game_winners
--   Returns participants with rank IS NOT NULL and prize_earned > 0 alongside
--   profile + game context. Used by the admin UI and the notification tick.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_game_winners(p_game_id UUID)
RETURNS TABLE (
    user_id       UUID,
    rank          INTEGER,
    score         INTEGER,
    prize_amount  NUMERIC,
    full_name     TEXT,
    email         TEXT,
    avatar_url    TEXT,
    game_title    TEXT,
    currency      TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT gp.user_id,
           gp.rank,
           gp.score,
           gp.prize_earned        AS prize_amount,
           pr.full_name,
           pr.email,
           pr.avatar_url,
           g.title                AS game_title,
           COALESCE(g.prize_pool_currency, 'USD') AS currency
    FROM   public.game_participants gp
    JOIN   public.profiles pr ON pr.id = gp.user_id
    JOIN   public.games    g  ON g.id  = gp.game_id
    WHERE  gp.game_id      = p_game_id
      AND  gp.prize_earned > 0
    ORDER  BY gp.rank ASC;
$$;

REVOKE ALL ON FUNCTION public.get_game_winners(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_game_winners(UUID) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- get_winner_push_tokens
--   One row per (winner × device token). Used by the template-generator
--   notification tick to fan out FCM pushes. Notifications for prizes are
--   considered transactional (R-01 only restricts secrets), so they are sent
--   regardless of notification_preferences.game_reminders — winners must be
--   told they won.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_winner_push_tokens(p_game_id UUID)
RETURNS TABLE (
    user_id      UUID,
    token        TEXT,
    platform     TEXT,
    rank         INTEGER,
    prize_amount NUMERIC,
    full_name    TEXT,
    game_title   TEXT,
    currency     TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT gp.user_id,
           pt.token,
           pt.platform,
           gp.rank,
           gp.prize_earned        AS prize_amount,
           pr.full_name,
           g.title                AS game_title,
           COALESCE(g.prize_pool_currency, 'USD') AS currency
    FROM   public.game_participants gp
    JOIN   public.push_tokens pt ON pt.user_id = gp.user_id
    JOIN   public.profiles    pr ON pr.id      = gp.user_id
    JOIN   public.games       g  ON g.id       = gp.game_id
    WHERE  gp.game_id      = p_game_id
      AND  gp.prize_earned > 0;
$$;

REVOKE ALL ON FUNCTION public.get_winner_push_tokens(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.get_winner_push_tokens(UUID) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- distribute_prizes (atomic, idempotent, safe)
--
-- Returns JSONB:
--   { distributed: true,  total_winners: N, total_paid: X, currency: "USD" }
--   { distributed: false, already_distributed: true, total_winners: N, ... }
--
-- prize_breakdown JSONB format (all forms are accepted in a single array;
-- each tier evaluated independently):
--   { "tiers": [
--       { "rank": 1, "amount": 50.00 },
--       { "rank": 2, "amount": 25.00 },
--       { "rank_from": 3, "rank_to": 10, "amount": 5.00 },
--       { "rank_from": 11, "rank_to": 20, "percent": 1.5 }
--   ]}
-- When breakdown is NULL/empty: rank 1 takes 100% of prize_pool.
-- Percent fields are treated as a share of games.prize_pool (e.g. 50 = 50%).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.distribute_prizes(p_game_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_status        TEXT;
    v_prize_pool    NUMERIC;
    v_breakdown     JSONB;
    v_currency      TEXT;
    v_already       TIMESTAMPTZ;
    v_tier          JSONB;
    v_rank_from     INTEGER;
    v_rank_to       INTEGER;
    v_amount        NUMERIC;
    v_total_paid    NUMERIC := 0;
    v_total_winners INTEGER := 0;
    v_winner        RECORD;
BEGIN
    -- Lock the game row to serialise concurrent finalize attempts.
    SELECT status, prize_pool, prize_breakdown,
           COALESCE(prize_pool_currency, 'USD'), prizes_distributed_at
      INTO v_status, v_prize_pool, v_breakdown, v_currency, v_already
      FROM public.games
     WHERE id = p_game_id
       FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'game_not_found';
    END IF;
    IF v_status <> 'completed' THEN
        RAISE EXCEPTION 'game_not_completed' USING DETAIL = v_status;
    END IF;

    -- Idempotency anchor.
    IF v_already IS NOT NULL THEN
        RETURN jsonb_build_object(
            'distributed',         FALSE,
            'already_distributed', TRUE,
            'total_winners',       (SELECT total_winners FROM public.games WHERE id = p_game_id),
            'currency',            v_currency
        );
    END IF;

    -- Ensure ranks are populated before paying anyone.
    PERFORM public.compute_game_ranks(p_game_id);

    -- Normalise the breakdown. NULL / no tiers ⇒ winner-takes-all.
    IF v_breakdown IS NULL
       OR jsonb_typeof(v_breakdown->'tiers') <> 'array'
       OR jsonb_array_length(v_breakdown->'tiers') = 0 THEN
        v_breakdown := jsonb_build_object(
            'tiers', jsonb_build_array(jsonb_build_object('rank', 1, 'percent', 100))
        );
    END IF;

    -- Walk every tier × every participant at matching rank and credit them.
    FOR v_tier IN SELECT * FROM jsonb_array_elements(v_breakdown->'tiers') LOOP
        v_rank_from := COALESCE((v_tier->>'rank_from')::INT, (v_tier->>'rank')::INT);
        v_rank_to   := COALESCE((v_tier->>'rank_to')::INT,   (v_tier->>'rank')::INT);
        IF v_rank_from IS NULL OR v_rank_to IS NULL OR v_rank_to < v_rank_from THEN
            CONTINUE;
        END IF;

        IF v_tier ? 'amount' THEN
            v_amount := (v_tier->>'amount')::NUMERIC;
        ELSIF v_tier ? 'percent' THEN
            v_amount := ROUND(v_prize_pool * (v_tier->>'percent')::NUMERIC / 100.0, 2);
        ELSE
            CONTINUE;
        END IF;
        IF v_amount IS NULL OR v_amount <= 0 THEN CONTINUE; END IF;

        FOR v_winner IN
            SELECT id, user_id
              FROM public.game_participants
             WHERE game_id = p_game_id
               AND role    = 'player'
               AND rank   BETWEEN v_rank_from AND v_rank_to
               AND prize_earned = 0  -- never double-pay within a single run
        LOOP
            UPDATE public.game_participants
               SET prize_earned = v_amount
             WHERE id = v_winner.id;

            -- Credit wallet + bump lifetime prize stat (R-09 atomic).
            UPDATE public.profiles
               SET wallet_balance   = wallet_balance   + v_amount,
                   total_prizes_won = total_prizes_won + v_amount
             WHERE id = v_winner.user_id;

            -- Append-only ledger entry (R-05). Marked 'completed' because the
            -- wallet credit above is the settlement event itself.
            INSERT INTO public.transactions
                (user_id, type, amount, status, game_id, description, metadata)
            VALUES
                (v_winner.user_id, 'prize', v_amount, 'completed', p_game_id,
                 'Prize for game ' || p_game_id::TEXT,
                 jsonb_build_object('source', 'distribute_prizes',
                                    'rank',   (SELECT rank FROM public.game_participants
                                                WHERE id = v_winner.id)));

            v_total_paid    := v_total_paid + v_amount;
            v_total_winners := v_total_winners + 1;
        END LOOP;
    END LOOP;

    -- Stamp the game so subsequent calls short-circuit.
    UPDATE public.games
       SET total_winners         = v_total_winners,
           prizes_distributed_at = NOW()
     WHERE id = p_game_id;

    RETURN jsonb_build_object(
        'distributed',         TRUE,
        'already_distributed', FALSE,
        'total_winners',       v_total_winners,
        'total_paid',          v_total_paid,
        'currency',            v_currency
    );
END;
$$;

REVOKE ALL ON FUNCTION public.distribute_prizes(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.distribute_prizes(UUID) TO service_role;

COMMIT;
