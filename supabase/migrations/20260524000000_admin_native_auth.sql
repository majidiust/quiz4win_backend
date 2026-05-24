-- =============================================================================
-- Native admin authentication — fully decoupled from Supabase Auth
-- =============================================================================
-- Quiz4Win admins are stored in public.admin_users. Previously their identity
-- was managed through Supabase Auth (auth.users), which created a hard
-- conflict: a single email can only exist once in auth.users, so a customer
-- and an admin could never share the same address, and the password/MFA flows
-- were shared between unrelated user populations.
--
-- This migration introduces a self-contained credential, session, MFA and
-- password-reset model owned entirely by the admin_users table. From here on
-- the Supabase Auth subsystem is reserved exclusively for customer accounts.
--
-- New columns on admin_users
--   • password_hash           — bcrypt hash of the admin's password
--   • password_changed_at     — last successful password change
--   • mfa_recovery_codes      — JSONB array of bcrypt-hashed recovery codes
--   • failed_login_attempts   — running counter, reset on success
--   • locked_until            — set when failed_login_attempts exceeds policy
--
-- New tables
--   • admin_sessions                — hashed session + refresh tokens
--   • admin_password_reset_tokens   — single-use, time-bound reset tokens
--   • admin_mfa_challenges          — short-lived TOTP challenge between
--                                     password verification and full session
--
-- RLS posture
--   All four new/extended surfaces deny access to anon and authenticated.
--   They are exclusively driven by the service-role key used by the Next.js
--   admin server actions, /api/admin/auth/* route handlers, and the admin-*
--   Edge Functions. No customer JWT can ever touch them.
-- =============================================================================

-- 1. Extend admin_users with credential & lockout fields ----------------------
ALTER TABLE public.admin_users
    ADD COLUMN IF NOT EXISTS password_hash         TEXT,
    ADD COLUMN IF NOT EXISTS password_changed_at   TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS mfa_recovery_codes    JSONB,
    ADD COLUMN IF NOT EXISTS failed_login_attempts INT  NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS locked_until          TIMESTAMPTZ;

COMMENT ON COLUMN public.admin_users.password_hash
    IS 'bcrypt hash (cost 12) of the admin password. NULL means the account '
       'has been provisioned but not yet activated via the welcome email.';
COMMENT ON COLUMN public.admin_users.mfa_recovery_codes
    IS 'JSONB array of bcrypt-hashed one-time recovery codes (10 codes generated '
       'at MFA enrolment). Each code is marked used by replacing its hash with '
       'NULL in-place to preserve ordering.';

-- 2. admin_sessions -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.admin_sessions (
    id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id            UUID         NOT NULL REFERENCES public.admin_users(id) ON DELETE CASCADE,
    session_token_hash  TEXT         NOT NULL UNIQUE,
    refresh_token_hash  TEXT         UNIQUE,
    aal                 TEXT         NOT NULL DEFAULT 'aal2'
                                     CHECK (aal IN ('aal1','aal2')),
    ip_address          TEXT,
    user_agent          TEXT,
    expires_at          TIMESTAMPTZ  NOT NULL,
    refresh_expires_at  TIMESTAMPTZ,
    last_used_at        TIMESTAMPTZ,
    revoked_at          TIMESTAMPTZ,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_admin_id   ON public.admin_sessions(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires_at ON public.admin_sessions(expires_at);
ALTER TABLE public.admin_sessions ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.admin_sessions IS
    'Admin authenticated sessions. Tokens are stored as SHA-256 hashes; the '
    'plaintext token lives only in the admin browser cookie and is never '
    'persisted server-side.';

-- 3. admin_password_reset_tokens ---------------------------------------------
CREATE TABLE IF NOT EXISTS public.admin_password_reset_tokens (
    id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id    UUID         NOT NULL REFERENCES public.admin_users(id) ON DELETE CASCADE,
    token_hash  TEXT         NOT NULL UNIQUE,
    purpose     TEXT         NOT NULL DEFAULT 'reset'
                             CHECK (purpose IN ('reset','invite')),
    expires_at  TIMESTAMPTZ  NOT NULL,
    used_at     TIMESTAMPTZ,
    ip_address  TEXT,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_admin_password_reset_tokens_admin_id ON public.admin_password_reset_tokens(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_password_reset_tokens_expires  ON public.admin_password_reset_tokens(expires_at);
ALTER TABLE public.admin_password_reset_tokens ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.admin_password_reset_tokens IS
    'Single-use tokens emailed to admins for password reset or first-time '
    'account activation (purpose=invite). Tokens stored as SHA-256 hash.';

-- 4. admin_mfa_challenges ----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.admin_mfa_challenges (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id        UUID         NOT NULL REFERENCES public.admin_users(id) ON DELETE CASCADE,
    challenge_hash  TEXT         NOT NULL UNIQUE,
    -- enrol = first-time MFA setup challenge, verify = standard TOTP login step
    purpose         TEXT         NOT NULL DEFAULT 'verify'
                                 CHECK (purpose IN ('verify','enrol')),
    expires_at      TIMESTAMPTZ  NOT NULL,
    consumed_at     TIMESTAMPTZ,
    ip_address      TEXT,
    user_agent      TEXT,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_admin_mfa_challenges_admin_id ON public.admin_mfa_challenges(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_mfa_challenges_expires  ON public.admin_mfa_challenges(expires_at);
ALTER TABLE public.admin_mfa_challenges ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.admin_mfa_challenges IS
    'Short-lived (5 min) challenges issued after successful password '
    'verification. The admin must redeem the challenge by submitting a valid '
    'TOTP code before a session cookie is issued.';

-- 5. RLS — deny by default; service_role bypasses RLS implicitly --------------
-- These four surfaces are 100% server-side. Block anon & authenticated.
DROP POLICY IF EXISTS admin_sessions_deny_all              ON public.admin_sessions;
DROP POLICY IF EXISTS admin_password_reset_tokens_deny_all ON public.admin_password_reset_tokens;
DROP POLICY IF EXISTS admin_mfa_challenges_deny_all        ON public.admin_mfa_challenges;

CREATE POLICY admin_sessions_deny_all
    ON public.admin_sessions
    FOR ALL TO anon, authenticated
    USING (FALSE) WITH CHECK (FALSE);

CREATE POLICY admin_password_reset_tokens_deny_all
    ON public.admin_password_reset_tokens
    FOR ALL TO anon, authenticated
    USING (FALSE) WITH CHECK (FALSE);

CREATE POLICY admin_mfa_challenges_deny_all
    ON public.admin_mfa_challenges
    FOR ALL TO anon, authenticated
    USING (FALSE) WITH CHECK (FALSE);
