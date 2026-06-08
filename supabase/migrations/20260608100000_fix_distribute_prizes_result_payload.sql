-- =============================================================================
-- Quiz4Win — Restore distribute_prizes rich result payload + result_summary
-- 2026-06-08 — A-01 (A-05 domain review: prize/result contract)
--
-- Regression fix. The three-bucket migration (20260607000000) correctly moved
-- crediting to earnings_balance + score_events (INV-15) but dropped the rich
-- return shape and stopped persisting games.result_summary that the
-- 20260605120000 migration had established. The orchestrator's GAME_RESULT
-- broadcast and the public GET /…/result endpoints read those fields, so games
-- finalized under the regressed version returned totalPrize/prizePool/
-- sharePerWinner/winnerUserIds/winners = 0/[] even though winners were paid.
--
-- This migration redefines distribute_prizes to KEEP three-bucket crediting
-- (earnings_balance + total_prizes_won + score_events) AND restore:
--   • the full return shape (total_prize, prize_pool, share_per_winner,
--     winner_user_ids, winners, distributed_at, currency)
--   • persistence of games.result_summary (source of truth for the REST APIs)
--   • idempotent-replay path that back-fills result_summary for games already
--     distributed under the regressed version (e.g. the affected game).
--
-- Rule compliance:
--   R-02 — NUMERIC dollars for money; BIGINT for score. No floats.
--   R-05 — Append-only: no UPDATE/DELETE on transactions or score_events.
--   R-09 — Each money movement is a single DB transaction.
--   INV-15 — Earnings isolation: winnings credit earnings_balance, not wallet.
-- =============================================================================

BEGIN;

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
    v_total_paid    NUMERIC  := 0;
    v_total_winners INTEGER  := 0;
    v_winner        RECORD;
    v_score_reason  TEXT;
    v_distributed   TIMESTAMPTZ;
BEGIN
    SELECT status, prize_pool, prize_breakdown,
           COALESCE(prize_pool_currency, 'USD'), prizes_distributed_at, result_summary
      INTO v_status, v_prize_pool, v_breakdown, v_currency, v_already, v_summary
      FROM public.games WHERE id = p_game_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'game_not_found'; END IF;
    IF v_status <> 'completed' THEN RAISE EXCEPTION 'game_not_completed' USING DETAIL = v_status; END IF;

    -- Idempotency anchor — return the persisted summary verbatim. Back-fill it
    -- from game_participants for games distributed before this migration (the
    -- regressed three-bucket version never wrote result_summary).
    IF v_already IS NOT NULL THEN
        IF v_summary IS NULL THEN
            v_total_paid    := COALESCE((SELECT SUM(prize_earned) FROM public.game_participants
                                          WHERE game_id = p_game_id AND prize_earned > 0), 0);
            v_total_winners := COALESCE((SELECT COUNT(*) FROM public.game_participants
                                          WHERE game_id = p_game_id AND prize_earned > 0), 0);
            v_summary := jsonb_build_object(
                'game_id',          p_game_id,
                'total_winners',    v_total_winners,
                'total_prize',      v_total_paid,
                'prize_pool',       v_prize_pool,
                'currency',         v_currency,
                'share_per_winner', CASE WHEN v_total_winners > 0
                                         THEN ROUND(v_total_paid / v_total_winners, 2) ELSE 0 END,
                'winner_user_ids',  COALESCE((SELECT jsonb_agg(user_id ORDER BY rank ASC)
                                                FROM public.game_participants
                                               WHERE game_id = p_game_id AND prize_earned > 0), '[]'::jsonb),
                'winners',          COALESCE((SELECT jsonb_agg(jsonb_build_object(
                                                    'user_id', user_id, 'rank', rank, 'prize_amount', prize_earned)
                                                    ORDER BY rank ASC)
                                                FROM public.game_participants
                                               WHERE game_id = p_game_id AND prize_earned > 0), '[]'::jsonb),
                'distributed_at',   v_already);
            UPDATE public.games SET result_summary = v_summary WHERE id = p_game_id;
        END IF;
        RETURN v_summary || jsonb_build_object('distributed', FALSE, 'already_distributed', TRUE);
    END IF;

    PERFORM public.compute_game_ranks(p_game_id);

    IF v_breakdown IS NULL
       OR jsonb_typeof(v_breakdown->'tiers') <> 'array'
       OR jsonb_array_length(v_breakdown->'tiers') = 0 THEN
        v_breakdown := jsonb_build_object(
            'tiers', jsonb_build_array(jsonb_build_object('rank', 1, 'percent', 100)));
    END IF;

    FOR v_tier IN SELECT * FROM jsonb_array_elements(v_breakdown->'tiers') LOOP
        v_rank_from := COALESCE((v_tier->>'rank_from')::INT, (v_tier->>'rank')::INT);
        v_rank_to   := COALESCE((v_tier->>'rank_to')::INT,   (v_tier->>'rank')::INT);
        IF v_rank_from IS NULL OR v_rank_to IS NULL OR v_rank_to < v_rank_from THEN CONTINUE; END IF;

        IF v_tier ? 'amount' THEN
            v_amount := (v_tier->>'amount')::NUMERIC;
        ELSIF v_tier ? 'percent' THEN
            v_amount := ROUND(v_prize_pool * (v_tier->>'percent')::NUMERIC / 100.0, 2);
        ELSE CONTINUE; END IF;
        IF v_amount IS NULL OR v_amount <= 0 THEN CONTINUE; END IF;

        FOR v_winner IN
            SELECT gp.id, gp.user_id, gp.score, gp.rank
              FROM public.game_participants gp
             WHERE gp.game_id = p_game_id AND gp.role = 'player'
               AND gp.rank BETWEEN v_rank_from AND v_rank_to
               AND gp.prize_earned = 0
        LOOP
            UPDATE public.game_participants SET prize_earned = v_amount WHERE id = v_winner.id;

            -- Credit EARNINGS (not wallet) — INV-15.
            UPDATE public.profiles
               SET earnings_balance = earnings_balance + v_amount,
                   total_prizes_won = total_prizes_won + v_amount,
                   updated_at       = NOW()
             WHERE id = v_winner.user_id;

            INSERT INTO public.transactions
                (user_id, type, amount, status, game_id, description, metadata)
            VALUES
                (v_winner.user_id, 'prize', v_amount, 'completed', p_game_id,
                 'Prize for game ' || p_game_id::TEXT,
                 jsonb_build_object('source', 'distribute_prizes', 'rank', v_winner.rank));

            v_score_reason := CASE
                WHEN v_winner.rank = 1 THEN 'game_winner'
                WHEN v_winner.rank <= 3 THEN 'top3'
                ELSE 'prize_winner' END;

            IF COALESCE(v_winner.score, 0) > 0 THEN
                UPDATE public.profiles SET score_balance = score_balance + v_winner.score
                 WHERE id = v_winner.user_id;
                INSERT INTO public.score_events(user_id, game_id, points, reason)
                VALUES (v_winner.user_id, p_game_id, v_winner.score, v_score_reason);
            END IF;

            v_total_paid    := v_total_paid + v_amount;
            v_total_winners := v_total_winners + 1;
        END LOOP;
    END LOOP;

    -- Award score to non-prize survivors as well.
    FOR v_winner IN
        SELECT gp.user_id, gp.score
          FROM public.game_participants gp
         WHERE gp.game_id = p_game_id AND gp.role = 'player'
           AND gp.prize_earned = 0 AND COALESCE(gp.score, 0) > 0
    LOOP
        UPDATE public.profiles SET score_balance = score_balance + v_winner.score
         WHERE id = v_winner.user_id;
        INSERT INTO public.score_events(user_id, game_id, points, reason)
        VALUES (v_winner.user_id, p_game_id, v_winner.score, 'participant');
    END LOOP;

    v_distributed := NOW();

    v_summary := jsonb_build_object(
        'game_id',          p_game_id,
        'total_winners',    v_total_winners,
        'total_prize',      v_total_paid,
        'prize_pool',       v_prize_pool,
        'currency',         v_currency,
        'share_per_winner', CASE WHEN v_total_winners > 0
                                 THEN ROUND(v_total_paid / v_total_winners, 2) ELSE 0 END,
        'winner_user_ids',  COALESCE((SELECT jsonb_agg(user_id ORDER BY rank ASC)
                                        FROM public.game_participants
                                       WHERE game_id = p_game_id AND prize_earned > 0), '[]'::jsonb),
        'winners',          COALESCE((SELECT jsonb_agg(jsonb_build_object(
                                            'user_id', user_id, 'rank', rank, 'prize_amount', prize_earned)
                                            ORDER BY rank ASC)
                                        FROM public.game_participants
                                       WHERE game_id = p_game_id AND prize_earned > 0), '[]'::jsonb),
        'distributed_at',   v_distributed);

    UPDATE public.games
       SET total_winners = v_total_winners, prizes_distributed_at = v_distributed,
           result_summary = v_summary
     WHERE id = p_game_id;

    RETURN v_summary || jsonb_build_object('distributed', TRUE, 'already_distributed', FALSE);
END;
$$;

REVOKE ALL ON FUNCTION public.distribute_prizes(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.distribute_prizes(UUID) TO service_role;

COMMIT;
