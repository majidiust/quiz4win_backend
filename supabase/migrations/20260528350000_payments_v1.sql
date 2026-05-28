-- ============================================================
-- Migration: payments_v1
-- Created : 2026-05-28
-- Purpose : Gateway-agnostic payments table and atomic credit RPC.
--           Supports MasterCard (Remitation), Apple Pay, Crypto.
-- Rules   : R-02 (cents), R-05 (append-only ledger), R-09 (atomic)
-- ============================================================

-- ─── Table ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.payments (
    id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 UUID        NOT NULL REFERENCES public.profiles(id),
    method                  TEXT        NOT NULL CHECK (method IN ('mastercard', 'apple', 'crypto')),
    provider                TEXT        NOT NULL, -- 'remitation', 'apple_pay', etc.
    amount_cents            BIGINT      NOT NULL CHECK (amount_cents > 0),
    currency                TEXT        NOT NULL DEFAULT 'EUR',
    status                  TEXT        NOT NULL DEFAULT 'init'
                                        CHECK (status IN ('init', 'pending', 'succeeded', 'failed', 'cancelled', 'expired')),
    provider_payment_id     TEXT        UNIQUE,   -- External ID from gateway
    provider_short_id       TEXT,
    provider_response       JSONB,
    payment_link            TEXT,
    redirect_url            TEXT,
    transaction_id          UUID        REFERENCES public.transactions(id),
    client_ip               TEXT,
    extra_data              JSONB,
    initiated_at            TIMESTAMPTZ,
    verified_at             TIMESTAMPTZ,
    completed_at            TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Row-Level Security ──────────────────────────────────────────────────────

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

-- Users can view their own payment history
CREATE POLICY "payments_user_select"
    ON public.payments
    FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

-- Admin / Edge Functions use service_role which bypasses RLS.

-- ─── Indexes ─────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_payments_user_id             ON public.payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_status              ON public.payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_provider_id         ON public.payments(provider_payment_id);
CREATE INDEX IF NOT EXISTS idx_payments_created_at          ON public.payments(created_at DESC);

-- ─── Atomic Completion RPC ───────────────────────────────────────────────────

/**
 * Atomically completes a payment:
 * 1. Locks the payment row.
 * 2. Checks if already completed.
 * 3. Updates status and credits user wallet.
 * 4. Inserts immutable transaction record.
 */
CREATE OR REPLACE FUNCTION public.complete_payment(
    p_payment_id UUID,
    p_provider_response JSONB DEFAULT NULL
)
RETURNS UUID -- returns the transaction_id
LANGUAGE plpgsql
SECURITY DEFINER -- bypasses RLS to update profiles and transactions
SET search_path = public, pg_temp
AS $$
DECLARE
    v_payment      RECORD;
    v_tx_id        UUID;
    v_amount_num   NUMERIC(12,2);
BEGIN
    -- 1. Lock and fetch payment
    SELECT * INTO v_payment
    FROM payments
    WHERE id = p_payment_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'payment_not_found';
    END IF;

    -- 2. If already succeeded, just return existing tx_id
    IF v_payment.status = 'succeeded' AND v_payment.transaction_id IS NOT NULL THEN
        RETURN v_payment.transaction_id;
    END IF;

    -- 3. If already terminal (but not succeeded), error
    IF v_payment.status IN ('failed', 'cancelled', 'expired') THEN
        RAISE EXCEPTION 'payment_already_terminal';
    END IF;

    -- 4. Convert cents to NUMERIC for transactions/wallet
    -- Use 100.0 to force numeric division
    v_amount_num := v_payment.amount_cents / 100.0;

    -- 5. Create Transaction entry (R-05)
    INSERT INTO transactions (
        user_id,
        type,
        amount,
        status,
        reference,
        description,
        metadata
    ) VALUES (
        v_payment.user_id,
        'topup',
        v_amount_num,
        'completed',
        v_payment.provider_short_id,
        'Wallet top-up via ' || v_payment.method,
        jsonb_build_object(
            'payment_id', v_payment.id,
            'provider', v_payment.provider,
            'provider_id', v_payment.provider_payment_id
        )
    )
    RETURNING id INTO v_tx_id;

    -- 6. Update Profile Balance
    UPDATE profiles
    SET wallet_balance = wallet_balance + v_amount_num,
        total_deposited = total_deposited + v_amount_num,
        updated_at = NOW()
    WHERE id = v_payment.user_id;

    -- 7. Update Payment status
    UPDATE payments
    SET status = 'succeeded',
        transaction_id = v_tx_id,
        provider_response = COALESCE(p_provider_response, provider_response),
        completed_at = NOW(),
        updated_at = NOW()
    WHERE id = p_payment_id;

    RETURN v_tx_id;
END;
$$;
