-- =============================================================================
-- Quiz4Win — Three-Bucket Financial Model
-- 2026-06-07 — A-01
--
-- Implements the three-bucket balance design documented in
-- docs/financial-model-api-reference.md:
--
--   wallet_balance   — play money (top-ups, refunds, transferred earnings)
--   earnings_balance — game-prize money (withdrawable; transferred explicitly)
--   score_balance    — leaderboard points (non-monetary today)
--
-- Changes:
--   1. profiles — ADD COLUMN earnings_balance, score_balance
--   2. score_events — new append-only table (one row per score award)
--   3. transactions.type CHECK — extend to include 'earnings_transfer'
--   4. transfer_earnings_to_wallet(user_id, amount) — atomic RPC
--   5. distribute_prizes — updated to credit earnings_balance + score_balance
--
-- Rule compliance:
--   R-02 — NUMERIC(12,2) dollars for money; BIGINT for score.
--   R-05 — Append-only: no UPDATE/DELETE on transactions or score_events.
--   R-09 — Every money movement is a single DB transaction.
--   INV-05 — KYC threshold updated in the withdrawals edge function (not here).
--   INV-15 — Earnings isolation: earnings never automatically become wallet.
--   INV-16 — Winnings lock: once transferred to wallet, not withdrawable.
-- =============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. profiles — new balance columns
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS earnings_balance NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    ADD COLUMN IF NOT EXISTS score_balance    BIGINT        NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.profiles.earnings_balance IS
    'Monetary game winnings. Withdrawable directly or transferable to wallet_balance. '
    'Never spent on entry fees directly (INV-15). Backed by transactions(type=prize).';
COMMENT ON COLUMN public.profiles.score_balance IS
    'Leaderboard points. Non-monetary today; future RPC may convert to earnings_balance. '
    'Backed by score_events append-only ledger.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. score_events — append-only score ledger
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.score_events (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    game_id    UUID        NOT NULL REFERENCES public.games(id)    ON DELETE CASCADE,
    points     BIGINT      NOT NULL CHECK (points > 0),
    reason     TEXT        NOT NULL,  -- 'game_winner' | 'survivor' | 'top3' | 'participant'
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_score_events_user_id    ON public.score_events(user_id);
CREATE INDEX IF NOT EXISTS idx_score_events_game_id    ON public.score_events(game_id);
CREATE INDEX IF NOT EXISTS idx_score_events_created_at ON public.score_events(created_at DESC);

ALTER TABLE public.score_events ENABLE ROW LEVEL SECURITY;

-- Users can read their own score events
CREATE POLICY "score_events_user_select"
    ON public.score_events FOR SELECT TO authenticated
    USING (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. transactions.type CHECK — add 'earnings_transfer'
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.transactions
    DROP CONSTRAINT IF EXISTS transactions_type_check;
ALTER TABLE public.transactions
    ADD CONSTRAINT transactions_type_check
    CHECK (type IN ('topup','withdrawal','game_entry_fee','prize',
                    'referral_bonus','refund','admin_adjustment','earnings_transfer'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. transfer_earnings_to_wallet — atomic RPC (INV-15, INV-16)
--
-- Atomically moves `p_amount` from earnings_balance to wallet_balance and
-- writes a transactions(type='earnings_transfer') ledger row. Once money
-- enters wallet_balance it cannot be withdrawn again (INV-16).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.transfer_earnings_to_wallet(
    p_user_id UUID,
    p_amount  NUMERIC
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_tx_id UUID := gen_random_uuid();
BEGIN
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'amount_must_be_positive';
    END IF;

    -- Debit earnings and credit wallet atomically. The UPDATE will fail if
    -- earnings_balance would go negative (NOT NULL + DEFAULT 0 guard).
    UPDATE public.profiles
       SET earnings_balance = earnings_balance - p_amount,
           wallet_balance   = wallet_balance   + p_amount,
           updated_at       = NOW()
     WHERE id = p_user_id
       AND earnings_balance >= p_amount;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'insufficient_earnings';
    END IF;

    -- Append-only ledger entry (R-05).
    INSERT INTO public.transactions(id, user_id, type, amount, status, description, created_at)
    VALUES (v_tx_id, p_user_id, 'earnings_transfer', p_amount, 'completed',
            'Transfer from earnings to wallet', NOW());

    RETURN v_tx_id;
END;
$$;

REVOKE ALL ON FUNCTION public.transfer_earnings_to_wallet(UUID, NUMERIC) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.transfer_earnings_to_wallet(UUID, NUMERIC) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.transfer_earnings_to_wallet(UUID, NUMERIC) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. distribute_prizes — updated to credit earnings_balance + score_balance
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
    v_total_paid    NUMERIC  := 0;
    v_total_winners INTEGER  := 0;
    v_winner        RECORD;
    v_score_reason  TEXT;
BEGIN
    SELECT status, prize_pool, prize_breakdown,
           COALESCE(prize_pool_currency, 'USD'), prizes_distributed_at
      INTO v_status, v_prize_pool, v_breakdown, v_currency, v_already
      FROM public.games WHERE id = p_game_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'game_not_found'; END IF;
    IF v_status <> 'completed' THEN RAISE EXCEPTION 'game_not_completed' USING DETAIL = v_status; END IF;

    IF v_already IS NOT NULL THEN
        RETURN jsonb_build_object(
            'distributed', FALSE, 'already_distributed', TRUE,
            'total_winners', (SELECT total_winners FROM public.games WHERE id = p_game_id),
            'currency', v_currency);
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
                ELSE 'prize_winner'
            END;

            -- Always award score points equal to the player's in-game score.
            IF COALESCE(v_winner.score, 0) > 0 THEN
                UPDATE public.profiles
                   SET score_balance = score_balance + v_winner.score
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
        SELECT gp.user_id, gp.score, gp.rank
          FROM public.game_participants gp
         WHERE gp.game_id = p_game_id AND gp.role = 'player'
           AND gp.prize_earned = 0
           AND COALESCE(gp.score, 0) > 0
    LOOP
        UPDATE public.profiles
           SET score_balance = score_balance + v_winner.score
         WHERE id = v_winner.user_id;

        INSERT INTO public.score_events(user_id, game_id, points, reason)
        VALUES (v_winner.user_id, p_game_id, v_winner.score, 'participant');
    END LOOP;

    UPDATE public.games
       SET total_winners = v_total_winners, prizes_distributed_at = NOW()
     WHERE id = p_game_id;

    RETURN jsonb_build_object(
        'distributed', TRUE, 'already_distributed', FALSE,
        'total_winners', v_total_winners, 'total_paid', v_total_paid,
        'currency', v_currency);
END;
$$;

REVOKE ALL ON FUNCTION public.distribute_prizes(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.distribute_prizes(UUID) TO service_role;

COMMIT;
