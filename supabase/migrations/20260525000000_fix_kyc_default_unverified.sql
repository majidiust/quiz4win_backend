-- Fix: kyc_status default was 'pending', which made every new user appear to
-- have a pending KYC request even before submitting any documents. The
-- handlers (kyc/index.ts, withdrawals/index.ts) treat 'unverified' as the
-- correct initial state for a user who has never submitted KYC.
--
-- Steps:
--   1. Drop the old CHECK constraint that omitted 'unverified'.
--   2. Add a new CHECK constraint that includes 'unverified'.
--   3. Change the column default to 'unverified'.
--   4. Delete all pending kyc_requests (none are genuinely reviewed yet).
--   5. Reset ALL profiles to kyc_status = 'unverified' so every user
--      starts fresh and can submit their first KYC via POST /kyc/submit.

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_kyc_status_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_kyc_status_check
  CHECK (kyc_status IN ('unverified','pending','verified','rejected'));

ALTER TABLE public.profiles
  ALTER COLUMN kyc_status SET DEFAULT 'unverified';

-- Clear all pending KYC requests so users are not blocked by old stale submissions.
DELETE FROM public.kyc_requests WHERE status = 'pending';

-- Reset every profile to 'unverified' (full reset for all users).
UPDATE public.profiles
SET kyc_status = 'unverified', updated_at = NOW()
WHERE kyc_status != 'unverified';
