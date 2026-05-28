-- =============================================================================
-- Quiz4Win Backend — Admin API Keys
-- Migration: 20260528000000_api_keys.sql
-- Author:    A-01 (Augment Code Agent)
-- Purpose:   Allow super_admins to mint long-lived API keys for server-to-
--            server access to admin Edge Functions. Each key carries its own
--            role, optional expiry, optional Origin allow-list, and is
--            stored as a SHA-256 hash of its secret (R-01, R-04).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.api_keys (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Public, non-sensitive prefix included in every X-API-Key header.
    -- Format: q4w_ + 16 hex chars (8 random bytes).
    key_id          TEXT         NOT NULL UNIQUE,
    -- SHA-256 hex digest of the secret part. The raw secret is shown to the
    -- creator exactly once and never persisted.
    secret_hash     TEXT         NOT NULL,
    -- Last 4 chars of the raw secret, kept only to help the operator
    -- identify a key in the UI ("…7f2a"). Not sufficient to authenticate.
    secret_hint     TEXT         NOT NULL,
    name            TEXT         NOT NULL,
    description     TEXT,
    -- Role enforced on every request authenticated by this key. Matches the
    -- admin_users.role CHECK list verbatim.
    role            TEXT         NOT NULL
                                 CHECK (role IN ('super_admin','admin','moderator','finance','support')),
    -- Optional Origin allow-list. Empty array = no Origin restriction (typical
    -- for server-to-server). A non-empty list is matched case-insensitively
    -- against the inbound Origin header.
    allowed_domains TEXT[]       NOT NULL DEFAULT '{}',
    expires_at      TIMESTAMPTZ,
    revoked_at      TIMESTAMPTZ,
    last_used_at    TIMESTAMPTZ,
    last_used_ip    TEXT,
    created_by      UUID         NOT NULL REFERENCES public.admin_users(id),
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_keys_key_id     ON public.api_keys(key_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_revoked_at ON public.api_keys(revoked_at);
CREATE INDEX IF NOT EXISTS idx_api_keys_expires_at ON public.api_keys(expires_at);
CREATE INDEX IF NOT EXISTS idx_api_keys_created_by ON public.api_keys(created_by);

ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
-- No policies: service-role only access (R-04). The admin panel uses the
-- service-role client; Edge Functions look keys up via service-role too.

COMMENT ON TABLE public.api_keys IS
  'Admin-issued API keys for server-to-server access to admin Edge Functions. The raw secret is shown once at creation, then only the SHA-256 hash is retained. Service-role only — no RLS policies.';
