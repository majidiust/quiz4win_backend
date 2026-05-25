-- Fix: kyc_status default was 'pending', which made every new user appear to
-- have a pending KYC request even before submitting any documents. The
-- handlers (kyc/index.ts, withdrawals/index.ts) treat 'unverified' as the
-- correct initial state for a user who has never submitted KYC.
--
-- Steps:
--   1. Drop the old CHECK constraint that omitted 'unverified'.
--   2. Add a new CHECK constraint that includes 'unverified'.
--   3. Change the column default to 'unverified'.
--   4. Backfill: any profile with kyc_status='pending' but no kyc_requests row
--      is a user who never submitted — flip them to 'unverified'.

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_kyc_status_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_kyc_status_check
  CHECK (kyc_status IN ('unverified','pending','verified','rejected'));

ALTER TABLE public.profiles
  ALTER COLUMN kyc_status SET DEFAULT 'unverified';

UPDATE public.profiles p
SET kyc_status = 'unverified', updated_at = NOW()
WHERE p.kyc_status = 'pending'
  AND NOT EXISTS (
    SELECT 1 FROM public.kyc_requests r WHERE r.user_id = p.id
  );
