-- =============================================================================
-- Quiz4Win — Monetization Mode (presentation layer, Option A)
-- 2026-06-19 — A-01
--
-- Adds an admin-controlled, deploy-free monetization switch surfaced via
-- GET /config/app. The stored ledger always stays in canonical USD; this is a
-- presentation + policy layer only (no balance is ever re-denominated):
--
--   none — withdrawals blocked (App Store / Google Play review-safe: no cash-out)
--   coin — virtual currency; amounts displayed/entered in coins and converted
--          to USD at the admin FX rate (micro-USD per coin)
--   usd  — real money, 1:1 (default — preserves current behaviour, R-16)
--
-- The FX rate is stored as a scaled INTEGER (micro-USD per 1 coin; 1 USD =
-- 1,000,000 micros) so the money path uses integer math only — no floats (R-02).
--
-- Rules: R-02 (no floats), R-05 (append-only — only adding columns, no data
--        mutation), R-12 (applied via db-maintainer), R-16 (additive only).
-- =============================================================================

BEGIN;

-- ─── 1. Seed config keys (idempotent) ────────────────────────────────────────
-- Default mode is `usd` so existing real-money behaviour is unchanged.
INSERT INTO public.app_config (key, value, value_type)
VALUES
  ('monetization_mode',    'usd',   'string'),
  ('coin_usd_rate_micros', '10000', 'number'),  -- 1 coin = $0.01 → 100 coins = $1.00
  ('coin_name',            'Coins', 'string'),
  ('coin_symbol',          'C',     'string')
ON CONFLICT (key) DO NOTHING;

-- ─── 2. Withdrawal audit columns (nullable, additive) ────────────────────────
-- Persist the monetization context of each withdrawal for finance/audit. In
-- `coin` mode `coin_amount` records the coins the user requested and
-- `coin_usd_rate_micros` locks the rate applied at request time; `amount`
-- remains the canonical USD value that is actually debited and paid out.
ALTER TABLE public.withdrawals
    ADD COLUMN IF NOT EXISTS monetization_mode    TEXT,
    ADD COLUMN IF NOT EXISTS coin_amount          NUMERIC(14,2),
    ADD COLUMN IF NOT EXISTS coin_usd_rate_micros BIGINT;

COMMIT;
