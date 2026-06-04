-- =============================================================================
-- Quiz4Win — Crypto Withdrawal Columns
-- 2026-06-04 — A-01
--
-- Adds structured crypto-specific columns to the withdrawals table so that
-- finance admins can filter, search, and sort by coin/network without having
-- to reach into the JSONB account_details blob.
--
-- Changes:
--   1. withdrawals.crypto_coin    TEXT  — e.g. 'USDT', 'USDC'
--   2. withdrawals.crypto_network TEXT  — e.g. 'TRC20', 'ERC20', 'BEP20', 'SOL'
--   3. withdrawals.crypto_address TEXT  — destination wallet address
--   4. Index on (method, crypto_coin) for admin list filtering
--
-- Rules: R-02 (no floats), R-05 (append-only — only adding columns, no data
--        mutation), R-12 (applied via db-maintainer).
-- =============================================================================

BEGIN;

ALTER TABLE public.withdrawals
    ADD COLUMN IF NOT EXISTS crypto_coin    TEXT,
    ADD COLUMN IF NOT EXISTS crypto_network TEXT,
    ADD COLUMN IF NOT EXISTS crypto_address TEXT;

-- Fast filter: admin list → method=crypto, or method=crypto + coin=USDT, etc.
CREATE INDEX IF NOT EXISTS idx_withdrawals_method
    ON public.withdrawals (method);

CREATE INDEX IF NOT EXISTS idx_withdrawals_crypto_coin
    ON public.withdrawals (crypto_coin)
    WHERE crypto_coin IS NOT NULL;

COMMIT;
