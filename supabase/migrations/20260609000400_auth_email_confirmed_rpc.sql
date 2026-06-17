-- ─────────────────────────────────────────────────────────────────────────────
-- 20260609000400 — auth_email_confirmed RPC
--
-- The /auth/verify-otp Edge Function needs to know whether a signup email is
-- already confirmed in order to distinguish the legitimate "wrong code" path
-- from the "mail-scanner prefetched the link and burned the OTP token" path.
--
-- PostgREST is configured to expose only `public` (db_schemas not overridden),
-- so the admin client cannot SELECT from auth.users directly. This RPC bridges
-- that gap with a SECURITY DEFINER function locked to service_role.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.auth_email_confirmed(p_email TEXT)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM auth.users
    WHERE lower(email) = lower(p_email)
      AND email_confirmed_at IS NOT NULL
  );
$$;

REVOKE ALL ON FUNCTION public.auth_email_confirmed(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.auth_email_confirmed(TEXT) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auth_email_confirmed(TEXT) TO service_role;

COMMENT ON FUNCTION public.auth_email_confirmed(TEXT) IS
  'Returns true if the given email exists in auth.users and has been '
  'confirmed. Used by /auth/verify-otp to detect link-prefetch races where '
  'the OTP was already invalidated by a mail-scanner pre-clicking the link.';
