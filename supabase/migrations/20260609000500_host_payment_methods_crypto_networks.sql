-- ─────────────────────────────────────────────────────────────────────────────
-- 20260609000500 — host_payment_methods crypto-only network expansion
--
-- The host-app's payout-methods UI is now crypto-only (no bank accounts / IBAN
-- / PayPal). Expand the CHECK constraint to cover the additional networks the
-- new UI offers. Legacy values ('iban','bank_account','paypal') are kept in
-- the allowed list so any historical rows remain valid — only the UI stops
-- offering them going forward.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.host_payment_methods
    DROP CONSTRAINT IF EXISTS host_payment_methods_method_type_check;

ALTER TABLE public.host_payment_methods
    ADD CONSTRAINT host_payment_methods_method_type_check
    CHECK (method_type IN (
        -- Legacy (no longer offered by the UI but preserved for existing rows)
        'iban','bank_account','paypal',
        -- USDT stablecoin on supported chains
        'usdt_trc20','usdt_erc20','usdt_bep20','usdt_polygon',
        -- Native chain tokens
        'btc','eth','trx','bnb','sol','ton',
        -- Free-form fallback
        'other'
    ));

COMMENT ON COLUMN public.host_payment_methods.method_type IS
  'Payout destination type. New rows from the host-app are restricted to '
  'crypto networks (usdt_*, btc, eth, trx, bnb, sol, ton). Legacy bank/'
  'paypal values are retained for historical rows only.';
