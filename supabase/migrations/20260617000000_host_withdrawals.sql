-- =============================================================================
-- Quiz4Win — Host Withdrawals
-- Migration: 20260617000000_host_withdrawals.sql
-- Author:    A-01 — 2026-06-17
--
-- Adds host_withdrawals table for host payout requests.
-- A host selects one of their verified payment methods, enters an amount
-- (minimum $10), and an admin reviews → processes → completes the payout.
--
-- Lifecycle: pending → processing → completed  (or → rejected at any stage)
--
-- Money: amount debited from profiles.wallet_balance atomically in the edge
--        function at request time; refunded if admin rejects.
--
-- Rule compliance:
--   R-02 — NUMERIC(12,2) (consistent with existing host schema)
--   R-04 — RLS ENABLED; host SELECT-only policy
--   R-05 — append-only; no UPDATE/DELETE by app code
--   R-12 — applied via db-maintainer
-- =============================================================================

BEGIN;

-- ─── 1. host_withdrawals ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.host_withdrawals (
    id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    host_id               UUID          NOT NULL
                                        REFERENCES public.show_hosts(id) ON DELETE RESTRICT,
    payment_method_id     UUID          NOT NULL
                                        REFERENCES public.host_payment_methods(id) ON DELETE RESTRICT,
    amount                NUMERIC(12,2) NOT NULL CHECK (amount >= 10.00),
    currency              TEXT          NOT NULL DEFAULT 'USD',
    status                TEXT          NOT NULL DEFAULT 'pending'
                                        CHECK (status IN ('pending','processing','completed','rejected')),
    note                  TEXT,
    -- crypto snapshot (denormalised for audit trail, copied from payment method)
    crypto_coin           TEXT,
    crypto_network        TEXT,
    crypto_address        TEXT,
    -- admin fields
    transaction_reference TEXT,
    rejection_reason      TEXT,
    internal_note         TEXT,
    reviewed_by           UUID          REFERENCES public.admin_users(id),
    reviewed_at           TIMESTAMPTZ,
    completed_at          TIMESTAMPTZ,
    requested_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_host_withdrawals_host_id      ON public.host_withdrawals(host_id);
CREATE INDEX IF NOT EXISTS idx_host_withdrawals_status       ON public.host_withdrawals(status);
CREATE INDEX IF NOT EXISTS idx_host_withdrawals_requested_at ON public.host_withdrawals(requested_at DESC);

ALTER TABLE public.host_withdrawals ENABLE ROW LEVEL SECURITY;

-- Host can view their own withdrawal requests.
-- The edge function uses service_role (getAdminClient) and bypasses RLS.
CREATE POLICY host_withdrawals_select ON public.host_withdrawals
    FOR SELECT
    USING (
        host_id IN (
            SELECT id FROM public.show_hosts WHERE auth_user_id = auth.uid()
        )
    );

-- ─── 2. Extend notifications.type CHECK ──────────────────────────────────────
-- Adds host_withdrawal on top of 20260609000200_host_platform_notification_types.sql
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE public.notifications
    ADD CONSTRAINT notifications_type_check CHECK (
        type IN (
            -- original player types
            'prize','game_invite','show_reminder','kyc_update',
            'withdrawal','system','promotion',
            -- host lifecycle types (20260609000200)
            'host_application','host_invite','host_request','host_earning',
            'host_payment_method','host_file','host_stream',
            -- host payout type (this migration)
            'host_withdrawal'
        )
    );

COMMENT ON COLUMN public.notifications.type IS
    'Notification category. '
    'Player: prize/game_invite/show_reminder/kyc_update/withdrawal/system/promotion. '
    'Host: host_application/host_invite/host_request/host_earning/'
    'host_payment_method/host_file/host_stream/host_withdrawal.';

COMMIT;
