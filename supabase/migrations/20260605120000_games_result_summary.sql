-- =============================================================================
-- Quiz4Win — Persisted game result summary + GAME_RESULT broadcast support
-- 2026-06-05
--
-- Adds the aggregate `result_summary JSONB` column on `public.games` and updates
-- `distribute_prizes(p_game_id)` to populate it atomically. The orchestrator
-- broadcasts a `GAME_RESULT` LiveKit event right after this RPC returns; the
-- public `GET /public-games/:id/result` endpoint reads the persisted JSONB so
-- subsequent requests never recompute the distribution.
--
-- result_summary shape:
--   {
--     "game_id":          "<uuid>",
--     "total_winners":    <int>,
--     "total_prize":      <numeric>,        -- sum of prize_earned across winners
--     "prize_pool":       <numeric>,        -- games.prize_pool at distribution
--     "currency":         "USD",
--     "share_per_winner": <numeric>,        -- total_prize / total_winners (0 if N=0)
--     "winner_user_ids":  ["<uuid>", ...],  -- ordered by rank ASC
--     "winners":          [ { "user_id":"<uuid>", "rank":N, "prize_amount":X }, ... ],
--     "distributed_at":   "<timestamptz>"
--   }
--
-- Rule compliance:
--   R-02 — NUMERIC dollars; no floats.
--   R-05 — Append-only finance preserved (no transactions UPDATE/DELETE).
--   R-06 — Only the orchestrator/SECURITY DEFINER RPC writes this column.
-- =============================================================================

BEGIN;

ALTER TABLE public.games
    ADD COLUMN IF NOT EXISTS result_summary JSONB;

COMMENT ON COLUMN public.games.result_summary IS
    'Persisted aggregate result of distribute_prizes() — total winners, total paid, share per winner, winner IDs and per-winner amounts. Populated atomically at the end of distribute_prizes; the source of truth for the public game-result API.';

-- ─────────────────────────────────────────────────────────────────────────────
-- distribute_prizes (atomic, idempotent, safe) — now persists result_summary
-- and returns the full summary on both first-run and idempotent-replay paths.
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
    v_summary       JSONB;
    v_tier          JSONB;
    v_rank_from     INTEGER;
    v_rank_to       INTEGER;
    v_amount        NUMERIC;
    v_total_paid    NUMERIC := 0;
    v_total_winners INTEGER := 0;
    v_winner        RECORD;
    v_distributed   TIMESTAMPTZ;
BEGIN
    -- Lock the game row to serialise concurrent finalize attempts.
    SELECT status, prize_pool, prize_breakdown,
           COALESCE(prize_pool_currency, 'USD'), prizes_distributed_at,
           result_summary
      INTO v_status, v_prize_pool, v_breakdown, v_currency, v_already, v_summary
      FROM public.games
     WHERE id = p_game_id
       FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'game_not_found';
    END IF;
    IF v_status <> 'completed' THEN
        RAISE EXCEPTION 'game_not_completed' USING DETAIL = v_status;
    END IF;

    -- Idempotency anchor — return the stored summary verbatim so callers
    -- (orchestrator broadcast / public API) get the canonical numbers without
    -- recomputing anything.
    IF v_already IS NOT NULL THEN
        IF v_summary IS NULL THEN
            -- Back-fill summary for games distributed before this migration.
            v_summary := jsonb_build_object(
                'game_id',          p_game_id,
                'total_winners',    COALESCE((SELECT total_winners FROM public.games WHERE id = p_game_id), 0),
                'total_prize',      COALESCE((SELECT SUM(prize_earned) FROM public.game_participants WHERE game_id = p_game_id), 0),
                'prize_pool',       v_prize_pool,
                'currency',         v_currency,
                'share_per_winner', 0,
                'winner_user_ids',  COALESCE((SELECT jsonb_agg(user_id ORDER BY rank ASC) FROM public.game_participants WHERE game_id = p_game_id AND prize_earned > 0), '[]'::jsonb),
                'winners',          COALESCE((SELECT jsonb_agg(jsonb_build_object('user_id', user_id, 'rank', rank, 'prize_amount', prize_earned) ORDER BY rank ASC) FROM public.game_participants WHERE game_id = p_game_id AND prize_earned > 0), '[]'::jsonb),
                'distributed_at',   v_already
            );
            UPDATE public.games SET result_summary = v_summary WHERE id = p_game_id;
        END IF;
        RETURN v_summary || jsonb_build_object(
            'distributed',         FALSE,
            'already_distributed', TRUE
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

            -- Append-only ledger entry (R-05).
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

    v_distributed := NOW();

    -- Build the persisted aggregate summary.
    v_summary := jsonb_build_object(
        'game_id',          p_game_id,
        'total_winners',    v_total_winners,
        'total_prize',      v_total_paid,
        'prize_pool',       v_prize_pool,
        'currency',         v_currency,
        'share_per_winner', CASE WHEN v_total_winners > 0
                                 THEN ROUND(v_total_paid / v_total_winners, 2)
                                 ELSE 0 END,
        'winner_user_ids',  COALESCE((SELECT jsonb_agg(user_id ORDER BY rank ASC)
                                        FROM public.game_participants
                                       WHERE game_id = p_game_id AND prize_earned > 0), '[]'::jsonb),
        'winners',          COALESCE((SELECT jsonb_agg(jsonb_build_object(
                                            'user_id',      user_id,
                                            'rank',         rank,
                                            'prize_amount', prize_earned) ORDER BY rank ASC)
                                        FROM public.game_participants
                                       WHERE game_id = p_game_id AND prize_earned > 0), '[]'::jsonb),
        'distributed_at',   v_distributed
    );

    -- Stamp the game (idempotency anchor + persisted summary).
    UPDATE public.games
       SET total_winners         = v_total_winners,
           prizes_distributed_at = v_distributed,
           result_summary        = v_summary
     WHERE id = p_game_id;

    RETURN v_summary || jsonb_build_object(
        'distributed',         TRUE,
        'already_distributed', FALSE
    );
END;
$$;

REVOKE ALL ON FUNCTION public.distribute_prizes(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.distribute_prizes(UUID) TO service_role;

COMMIT;
