-- =============================================================================
-- Quiz4Win — Referral Eligibility Window
-- 2026-06-19 — A-01
--
-- Allows the platform to restrict how long after signup a referee can still
-- apply a referral code (e.g. "you must use your referral code within 30 days
-- of creating your account").
--
-- Changes (all additive — R-16):
--   1. referral_codes — add eligibility_days INTEGER (NULL = global default)
--   2. app_config     — seed referral_eligibility_days = 30 (default)
--
-- Resolution logic (evaluated at redeem time in the Edge Function):
--   effective_days = COALESCE(referral_codes.eligibility_days,
--                             app_config.referral_eligibility_days, 30)
--   0              = no window restriction (unlimited)
--   > 0            = referee.profiles.created_at + effective_days must be >= now
--
-- Rules: R-02, R-05, R-16
-- =============================================================================

BEGIN;

-- ─── 1. referral_codes — per-code eligibility window override ────────────────
ALTER TABLE public.referral_codes
    ADD COLUMN IF NOT EXISTS eligibility_days INTEGER;

COMMENT ON COLUMN public.referral_codes.eligibility_days IS
    'Days after the referee''s signup during which they may apply this code. '
    'NULL = use global app_config.referral_eligibility_days. '
    '0 = no restriction (unlimited). Admin-overridable per user/code.';

-- ─── 2. app_config — global eligibility window default ───────────────────────
INSERT INTO public.app_config (key, value, value_type)
VALUES ('referral_eligibility_days', '30', 'number')
ON CONFLICT (key) DO NOTHING;

COMMENT ON COLUMN public.app_config.value IS
    'referral_eligibility_days: integer days (0 = unlimited). '
    'Default 30 — referee has 30 days from signup to apply a referral code.';

COMMIT;
