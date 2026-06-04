-- =============================================================================
-- Quiz4Win — Withdrawal Email-OTP Confirmation
-- 2026-06-04 — A-01
--
-- Adds a mandatory email-OTP confirmation step before a withdrawal request
-- enters the finance review queue. A new request is created in the
-- `awaiting_confirmation` state and is NOT debited from earnings_balance until
-- the user confirms the emailed 6-digit code (POST /withdrawals/:id/confirm).
--
-- Changes:
--   1. withdrawals.confirmation_code_hash    TEXT        — SHA-256 hex of the OTP
--   2. withdrawals.confirmation_expires_at   TIMESTAMPTZ — when the OTP stops working
--   3. withdrawals.confirmation_attempts     INTEGER     — verify attempts (lock at 5)
--   4. withdrawals.confirmed_at              TIMESTAMPTZ — when the user confirmed
--   5. status CHECK extended with 'awaiting_confirmation'
--
-- Rules: R-01 (no plaintext OTP — only the SHA-256 hash is persisted, mirroring
--        user_security), R-02 (no floats — only NUMERIC/INT/TS columns added),
--        R-05 (append-only — additive columns only, no data mutation),
--        R-12 (applied exclusively via the db-maintainer container).
-- =============================================================================

BEGIN;

ALTER TABLE public.withdrawals
    ADD COLUMN IF NOT EXISTS confirmation_code_hash  TEXT,
    ADD COLUMN IF NOT EXISTS confirmation_expires_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS confirmation_attempts   INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS confirmed_at            TIMESTAMPTZ;

-- Extend the status domain with the pre-review `awaiting_confirmation` state.
ALTER TABLE public.withdrawals
    DROP CONSTRAINT IF EXISTS withdrawals_status_check;
ALTER TABLE public.withdrawals
    ADD CONSTRAINT withdrawals_status_check
    CHECK (status IN ('awaiting_confirmation','pending','processing','completed','rejected'));

COMMIT;
