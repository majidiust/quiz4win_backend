-- =============================================================================
-- Quiz4Win — Fix admin voucher panel bugs
-- 2026-06-19 — A-01
--
-- Fixes discovered during admin panel audit:
--   1. vouchers.type CHECK — original schema only allows 'platform'/'affiliate'
--      but admin UI creates promo/referral/partner/free_entry/reward types.
--   2. vouchers.reward_type CHECK — add 'discount' (offered in admin UI).
--   3. voucher_redemptions — add missing columns used by admin issueVoucher:
--      note TEXT, reward_type TEXT, reward_amount NUMERIC(10,2).
--      (issued_by_admin is captured via admin_audit_log — R-01/R-05.)
--
-- Rules: R-05 (append-only finance), R-12 (migration-only schema changes),
--        R-16 (additive / no breaking changes)
-- =============================================================================

BEGIN;

-- ─── 1. Widen vouchers.type CHECK ─────────────────────────────────────────────
-- Original: CHECK (type IN ('platform','affiliate'))
-- New: adds all types used by the admin panel UI
ALTER TABLE public.vouchers DROP CONSTRAINT IF EXISTS vouchers_type_check;
ALTER TABLE public.vouchers
  ADD CONSTRAINT vouchers_type_check
  CHECK (type IN ('platform','affiliate','promo','referral','partner','free_entry','reward'));

-- ─── 2. Add 'discount' to vouchers.reward_type CHECK ─────────────────────────
-- 'discount' is offered in the admin UI reward-type select.
ALTER TABLE public.vouchers DROP CONSTRAINT IF EXISTS vouchers_reward_type_check;
ALTER TABLE public.vouchers
  ADD CONSTRAINT vouchers_reward_type_check
  CHECK (
    reward_type IN (
      'topup_bonus_pct','topup_bonus_fixed','free_entry',
      'wallet_credit','affiliate_redirect','discount'
    ) OR reward_type IS NULL
  );

-- ─── 3. Add missing columns to voucher_redemptions ────────────────────────────
-- These are populated by the admin issueVoucher server action.
ALTER TABLE public.voucher_redemptions
  ADD COLUMN IF NOT EXISTS note         TEXT,
  ADD COLUMN IF NOT EXISTS reward_type  TEXT,
  ADD COLUMN IF NOT EXISTS reward_amount NUMERIC(10,2);

COMMENT ON COLUMN public.voucher_redemptions.note IS
  'Free-text note added by admin when manually issuing a voucher.';
COMMENT ON COLUMN public.voucher_redemptions.reward_type IS
  'Snapshot of vouchers.reward_type at time of redemption.';
COMMENT ON COLUMN public.voucher_redemptions.reward_amount IS
  'Reward applied in USD dollars at time of redemption (mirrors reward_value_applied_usd for admin-issued path).';

COMMIT;
