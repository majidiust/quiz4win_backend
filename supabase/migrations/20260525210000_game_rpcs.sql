-- =============================================================================
-- Quiz4Win — Game-flow RPCs
-- 2026-05-25 — A-01
--
-- Adds the SECURITY DEFINER SQL functions the customer `games` Edge Function
-- has been calling without a definition:
--   - public.credit_wallet  : credit profiles.wallet_balance + transaction row
--   - public.join_game      : R-09 atomic debit + insert participant + tx row
--   - public.leave_game     : remove participant + refund (pre-start only)
--   - public.submit_answer  : score the answer + update participant tallies
--
-- All monetary arguments are NUMERIC dollars to match the column types defined
-- in 20260522120000_initial_schema.sql (see R-02 note in database.types.ts).
-- =============================================================================

BEGIN;

-- credit_wallet ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.credit_wallet(
    p_user_id      UUID,
    p_amount_cents NUMERIC,
    p_reference_id UUID,
    p_type         TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN
        RAISE EXCEPTION 'amount_must_be_positive';
    END IF;
    IF p_type NOT IN ('refund','prize','admin_adjustment','referral_bonus','topup') THEN
        RAISE EXCEPTION 'invalid_credit_type';
    END IF;

    UPDATE public.profiles
       SET wallet_balance = wallet_balance + p_amount_cents,
           updated_at     = NOW()
     WHERE id = p_user_id;

    INSERT INTO public.transactions(user_id, type, amount, status, reference, game_id, created_at)
    VALUES (p_user_id, p_type, p_amount_cents, 'completed',
            p_reference_id::text,
            CASE WHEN p_type IN ('prize','refund') THEN p_reference_id ELSE NULL END,
            NOW());
END;
$$;

-- join_game (R-09: atomic debit + join) ---------------------------------------
CREATE OR REPLACE FUNCTION public.join_game(
    p_user_id         UUID,
    p_game_id         UUID,
    p_entry_fee_cents NUMERIC
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_balance NUMERIC;
    v_status  TEXT;
    v_max     INTEGER;
    v_count   INTEGER;
BEGIN
    SELECT status, max_players, total_participants
      INTO v_status, v_max, v_count
      FROM public.games WHERE id = p_game_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'game_not_found'; END IF;
    IF v_status <> 'open' THEN RAISE EXCEPTION 'game_not_open'; END IF;
    IF v_max IS NOT NULL AND COALESCE(v_count,0) >= v_max THEN
        RAISE EXCEPTION 'game_full';
    END IF;

    IF EXISTS (SELECT 1 FROM public.game_participants
                WHERE game_id = p_game_id AND user_id = p_user_id) THEN
        RAISE EXCEPTION 'already_joined';
    END IF;

    SELECT wallet_balance INTO v_balance
      FROM public.profiles WHERE id = p_user_id FOR UPDATE;
    IF v_balance IS NULL OR v_balance < p_entry_fee_cents THEN
        RAISE EXCEPTION 'insufficient_balance';
    END IF;

    IF p_entry_fee_cents > 0 THEN
        UPDATE public.profiles
           SET wallet_balance = wallet_balance - p_entry_fee_cents,
               updated_at     = NOW()
         WHERE id = p_user_id;

        INSERT INTO public.transactions(user_id, type, amount, status, reference, game_id, created_at)
        VALUES (p_user_id, 'game_entry_fee', p_entry_fee_cents, 'completed',
                p_game_id::text, p_game_id, NOW());
    END IF;

    INSERT INTO public.game_participants(game_id, user_id, role, entry_fee_paid, joined_at)
    VALUES (p_game_id, p_user_id, 'player', p_entry_fee_cents, NOW());

    UPDATE public.games
       SET total_participants = COALESCE(total_participants,0) + 1
     WHERE id = p_game_id;
END;
$$;

-- leave_game (refund pre-start only) ------------------------------------------
CREATE OR REPLACE FUNCTION public.leave_game(
    p_user_id UUID,
    p_game_id UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_status TEXT;
    v_fee    NUMERIC;
BEGIN
    SELECT status, entry_fee INTO v_status, v_fee
      FROM public.games WHERE id = p_game_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'game_not_found'; END IF;
    IF v_status NOT IN ('upcoming','open') THEN
        RAISE EXCEPTION 'cannot_leave_started_game';
    END IF;

    DELETE FROM public.game_participants
     WHERE game_id = p_game_id AND user_id = p_user_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'not_joined'; END IF;

    UPDATE public.games
       SET total_participants = GREATEST(COALESCE(total_participants,1) - 1, 0)
     WHERE id = p_game_id;

    IF COALESCE(v_fee,0) > 0 THEN
        PERFORM public.credit_wallet(p_user_id, v_fee, p_game_id, 'refund');
    END IF;
END;
$$;

-- submit_answer ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_answer(
    p_user_id          UUID,
    p_game_id          UUID,
    p_question_id      UUID,
    p_answer           INTEGER,
    p_response_time_ms INTEGER
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_pid     UUID;
    v_correct INTEGER;
    v_is_ok   BOOLEAN;
    v_points  INTEGER;
BEGIN
    SELECT id INTO v_pid FROM public.game_participants
     WHERE game_id = p_game_id AND user_id = p_user_id;
    IF v_pid IS NULL THEN RAISE EXCEPTION 'not_a_participant'; END IF;

    IF EXISTS (SELECT 1 FROM public.game_answers
                WHERE participant_id = v_pid AND question_id = p_question_id) THEN
        RAISE EXCEPTION 'already_answered';
    END IF;

    SELECT correct_index INTO v_correct FROM public.questions WHERE id = p_question_id;
    IF v_correct IS NULL THEN RAISE EXCEPTION 'question_not_found'; END IF;

    v_is_ok := (p_answer = v_correct);
    v_points := CASE WHEN v_is_ok THEN GREATEST(1000 - COALESCE(p_response_time_ms,0), 100) ELSE 0 END;

    INSERT INTO public.game_answers(game_id, participant_id, question_id, answer_index,
                                    is_correct, response_time_ms, points_earned, submitted_at)
    VALUES (p_game_id, v_pid, p_question_id, p_answer, v_is_ok,
            p_response_time_ms, v_points, NOW());

    UPDATE public.game_participants
       SET score           = score + v_points,
           correct_answers = correct_answers + CASE WHEN v_is_ok THEN 1 ELSE 0 END,
           wrong_answers   = wrong_answers   + CASE WHEN v_is_ok THEN 0 ELSE 1 END
     WHERE id = v_pid;

    RETURN jsonb_build_object(
        'correct',       v_is_ok,
        'correct_index', v_correct,
        'points_earned', v_points
    );
END;
$$;

COMMIT;
