-- =============================================================================
-- join_game: status is the sole registration gate
-- =============================================================================
-- Previous version (20260531200000_game_lifecycle.sql) rejected joins when
-- scheduled_at <= NOW() even if status was still 'upcoming'/'open'. This
-- conflicts with the documented status semantics: status 'open' means
-- "registration is explicitly open". The scheduler/orchestrator owns the
-- 'open' → 'live' transition; until that transition is performed the game
-- is joinable. Orphan/stuck games are handled by audit_game_template_rules.
-- =============================================================================

BEGIN;

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
    IF v_status NOT IN ('upcoming','open') THEN
        RAISE EXCEPTION 'game_not_open';
    END IF;
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

COMMIT;
