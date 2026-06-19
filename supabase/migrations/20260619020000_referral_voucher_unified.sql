-- =============================================================================
-- Quiz4Win — Referral + Voucher Unified Layer
-- 2026-06-19 — A-01
--
-- Implements dual-sided referral bonuses (referrer + referee), fixes the
-- voucher wallet-credit bug, and wires the INV-08 referral payout.
--
-- Changes (all additive — R-16):
--   1. credit_wallet RPC — add 'voucher' to the allowed-type whitelist
--   2. transactions.type CHECK — add 'voucher'
--   3. referral_codes — add referee_reward_value (per-code referee bonus)
--   4. referral_uses — add dual-sided tracking columns
--   5. app_config — seed referral bonus defaults + feature_user_vouchers flag
--   6. pay_referee_bonus(UUID) — atomic, idempotent; credits referee wallet
--   7. pay_referrer_bonus(UUID, UUID) — atomic, idempotent; credits referrer
--      wallet on referred user's first paid game join
--
-- Rules: R-02, R-05, R-09, R-12, R-16
-- =============================================================================

BEGIN;

-- ─── 1. credit_wallet — add 'voucher' to whitelist ───────────────────────────
-- The parameter name `p_amount_cents` is a historical misnomer; the value is
-- actually in NUMERIC dollars to match wallet_balance (NUMERIC(12,2)).
CREATE OR REPLACE FUNCTION public.credit_wallet(
    p_user_id      UUID,
    p_amount_cents NUMERIC,   -- dollars (despite the name — R-02 note)
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
    IF p_type NOT IN ('refund','prize','admin_adjustment','referral_bonus','topup','voucher') THEN
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

-- ─── 2. transactions.type CHECK — add 'voucher' ──────────────────────────────
ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS transactions_type_check;
ALTER TABLE public.transactions
    ADD CONSTRAINT transactions_type_check
    CHECK (type IN ('topup','withdrawal','game_entry_fee','prize',
                    'referral_bonus','refund','admin_adjustment',
                    'earnings_transfer','voucher'));

-- ─── 3. referral_codes — add referee_reward_value ────────────────────────────
-- Per-code override for the referee (invitee) bonus. NULL = use global default.
ALTER TABLE public.referral_codes
    ADD COLUMN IF NOT EXISTS referee_reward_value NUMERIC(10,2);

COMMENT ON COLUMN public.referral_codes.referee_reward_value IS
    'Bonus credited to the referee (invited user) in USD. NULL = global default '
    '(app_config.referral_referee_bonus_usd). bonus_amount = referrer bonus.';

-- ─── 4. referral_uses — dual-sided bonus tracking ────────────────────────────
ALTER TABLE public.referral_uses
    ADD COLUMN IF NOT EXISTS referrer_bonus_paid    BOOLEAN     NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS referrer_bonus_paid_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS referee_bonus_paid     BOOLEAN     NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS referee_bonus_paid_at  TIMESTAMPTZ;

COMMENT ON COLUMN public.referral_uses.referee_bonus_paid IS
    'TRUE once the referee (invitee) has been credited their welcome bonus.';
COMMENT ON COLUMN public.referral_uses.referrer_bonus_paid IS
    'TRUE once the referrer has been credited their bonus (on referee first paid game).';

-- ─── 5. app_config — seed referral bonus defaults ────────────────────────────
INSERT INTO public.app_config (key, value, value_type)
VALUES
  ('referral_referrer_bonus_usd', '10.00', 'number'),  -- referrer gets $10
  ('referral_referee_bonus_usd',   '5.00', 'number'),  -- referee  gets $5
  ('feature_user_vouchers',       'false', 'boolean')  -- user-created codes off by default
ON CONFLICT (key) DO NOTHING;

-- ─── 6. trigger: auto-increment referral_codes.use_count on referral_uses insert
CREATE OR REPLACE FUNCTION public.trg_increment_referral_use_count()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    UPDATE public.referral_codes
       SET use_count = use_count + 1
     WHERE code = NEW.code;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_referral_uses_increment ON public.referral_uses;
CREATE TRIGGER trg_referral_uses_increment
    AFTER INSERT ON public.referral_uses
    FOR EACH ROW EXECUTE FUNCTION public.trg_increment_referral_use_count();

-- ─── 8. pay_referee_bonus — credits the invited user at signup ───────────────
-- Called immediately after referral_uses row is created (Option B, INV-08).
-- Idempotent: a second call is a no-op. Blocked when monetization_mode='none'.
CREATE OR REPLACE FUNCTION public.pay_referee_bonus(p_referral_use_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_use          RECORD;
    v_code         RECORD;
    v_mode         TEXT;
    v_amount       NUMERIC;
    v_global       NUMERIC;
BEGIN
    -- Lock the row to prevent double-pay on concurrent calls.
    SELECT ru.id, ru.referred_user_id, ru.code,
           ru.referee_bonus_paid
      INTO v_use
      FROM public.referral_uses ru
     WHERE ru.id = p_referral_use_id
       FOR UPDATE;

    IF NOT FOUND THEN RAISE EXCEPTION 'referral_use_not_found'; END IF;
    IF v_use.referee_bonus_paid THEN RETURN; END IF;  -- idempotent

    -- Check monetization gate.
    SELECT value INTO v_mode FROM public.app_config WHERE key = 'monetization_mode';
    IF v_mode = 'none' THEN RETURN; END IF;

    -- Resolve bonus amount: per-code override > global default.
    SELECT referee_reward_value INTO v_code
      FROM public.referral_codes WHERE code = v_use.code;

    SELECT value::NUMERIC INTO v_global
      FROM public.app_config WHERE key = 'referral_referee_bonus_usd';

    v_amount := COALESCE(v_code.referee_reward_value, v_global, 5.00);

    IF v_amount <= 0 THEN RETURN; END IF;

    -- Credit the referee's wallet (R-09 atomic).
    UPDATE public.profiles
       SET wallet_balance = wallet_balance + v_amount,
           updated_at     = NOW()
     WHERE id = v_use.referred_user_id;

    INSERT INTO public.transactions(user_id, type, amount, status, description, created_at)
    VALUES (v_use.referred_user_id, 'referral_bonus', v_amount, 'completed',
            'Referee welcome bonus for using referral code ' || v_use.code, NOW());

    UPDATE public.referral_uses
       SET referee_bonus_paid    = TRUE,
           referee_bonus_paid_at = NOW()
     WHERE id = p_referral_use_id;
END;
$$;

REVOKE ALL ON FUNCTION public.pay_referee_bonus(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.pay_referee_bonus(UUID) TO service_role;

-- ─── 9. pay_referrer_bonus — credits referrer on referee's first paid game ───
-- Called after join_game succeeds and entry_fee > 0 (Option B timing for
-- referrer). Idempotent: skips if already paid or not the first paid game.
CREATE OR REPLACE FUNCTION public.pay_referrer_bonus(
    p_referred_user_id UUID,
    p_game_id          UUID
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_use        RECORD;
    v_code       RECORD;
    v_mode       TEXT;
    v_amount     NUMERIC;
    v_global     NUMERIC;
    v_paid_count INTEGER;
    v_fee        NUMERIC;
BEGIN
    -- Verify the current game has a paid entry fee.
    SELECT COALESCE(entry_fee, 0) INTO v_fee
      FROM public.games WHERE id = p_game_id;
    IF v_fee <= 0 THEN RETURN; END IF;  -- free game — no trigger

    -- Check this is the referred user's first paid game join.
    SELECT COUNT(*) INTO v_paid_count
      FROM public.game_participants
     WHERE user_id = p_referred_user_id
       AND entry_fee_paid > 0
       AND game_id <> p_game_id;
    IF v_paid_count > 0 THEN RETURN; END IF;  -- not the first paid game

    -- Find the referral_uses row and lock it.
    SELECT ru.id, ru.referrer_user_id, ru.code, ru.referrer_bonus_paid
      INTO v_use
      FROM public.referral_uses ru
     WHERE ru.referred_user_id = p_referred_user_id
       FOR UPDATE;

    IF NOT FOUND THEN RETURN; END IF;           -- user wasn't referred
    IF v_use.referrer_bonus_paid THEN RETURN; END IF;  -- idempotent

    -- Check monetization gate.
    SELECT value INTO v_mode FROM public.app_config WHERE key = 'monetization_mode';
    IF v_mode = 'none' THEN RETURN; END IF;

    -- Resolve bonus: per-code override (bonus_amount) > global default.
    SELECT bonus_amount INTO v_code
      FROM public.referral_codes WHERE code = v_use.code;

    SELECT value::NUMERIC INTO v_global
      FROM public.app_config WHERE key = 'referral_referrer_bonus_usd';

    v_amount := COALESCE(v_code.bonus_amount, v_global, 10.00);
    IF v_amount <= 0 THEN RETURN; END IF;

    -- Credit the referrer's wallet (R-09 atomic).
    UPDATE public.profiles
       SET wallet_balance = wallet_balance + v_amount,
           updated_at     = NOW()
     WHERE id = v_use.referrer_user_id;

    INSERT INTO public.transactions(user_id, type, amount, status, description, game_id, created_at)
    VALUES (v_use.referrer_user_id, 'referral_bonus', v_amount, 'completed',
            'Referrer bonus — referred user joined first paid game', p_game_id, NOW());

    UPDATE public.referral_uses
       SET referrer_bonus_paid    = TRUE,
           referrer_bonus_paid_at = NOW(),
           bonus_paid             = TRUE,          -- keep legacy flag in sync
           bonus_paid_at          = NOW()
     WHERE id = v_use.id;
END;
$$;

REVOKE ALL ON FUNCTION public.pay_referrer_bonus(UUID, UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.pay_referrer_bonus(UUID, UUID) TO service_role;

COMMIT;
