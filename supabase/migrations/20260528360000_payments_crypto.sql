-- ============================================================
-- Migration: payments_crypto
-- Created : 2026-05-28
-- Purpose : Add crypto-specific columns to payments table.
--           Remitation's crypto gateway returns address/QR/expires
--           instead of a redirect URL.
-- ============================================================

ALTER TABLE public.payments
    ADD COLUMN IF NOT EXISTS pay_address     TEXT,
    ADD COLUMN IF NOT EXISTS pay_amount      NUMERIC(24,8),    -- crypto amount in coin units (e.g. 29.997164 USDT)
    ADD COLUMN IF NOT EXISTS pay_currency    TEXT,             -- e.g. 'usdttrc20'
    ADD COLUMN IF NOT EXISTS qr_url          TEXT,
    ADD COLUMN IF NOT EXISTS expires_at      TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_payments_pay_address ON public.payments(pay_address)
    WHERE pay_address IS NOT NULL;
