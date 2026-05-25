-- =============================================================================
-- user_security table — per-user 2FA state for customer accounts
-- =============================================================================
-- Backs the /security/settings and /security/2fa/* endpoints.
--
-- Columns:
--   email_2fa_enabled   — true once the user has confirmed an email code
--   totp_enabled        — true once the user has confirmed a TOTP code
--   totp_secret         — Base32 RFC 4648 secret (NULL if no TOTP attempt yet).
--                         Populated by /security/2fa/totp/setup (provisional) and
--                         remains the active secret once the user enables TOTP.
--                         Cleared on /security/2fa/totp/disable.
--   email_code_hash     — SHA-256 hex of the most recent email 6-digit code
--   email_code_expires_at — when the email code stops being accepted
--   email_code_attempts — verification attempts on the current code (lock at 5)
--
-- R-01: no plaintext OTP is stored; the email code is hashed before persisting.
-- R-04: RLS enabled, users may SELECT their own row only. Writes go through the
--       admin client inside the security Edge Function (no INSERT/UPDATE
--       policies for authenticated role on purpose).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.user_security (
    user_id                UUID         PRIMARY KEY
                                        REFERENCES public.profiles(id) ON DELETE CASCADE,
    email_2fa_enabled      BOOLEAN      NOT NULL DEFAULT FALSE,
    totp_enabled           BOOLEAN      NOT NULL DEFAULT FALSE,
    totp_secret            TEXT,
    email_code_hash        TEXT,
    email_code_expires_at  TIMESTAMPTZ,
    email_code_attempts    INTEGER      NOT NULL DEFAULT 0,
    created_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

ALTER TABLE public.user_security ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_security_select_own ON public.user_security;
CREATE POLICY user_security_select_own ON public.user_security
    FOR SELECT TO authenticated USING (user_id = auth.uid());
