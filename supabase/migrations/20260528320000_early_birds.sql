-- ============================================================
-- Migration: early_birds
-- Created : 2026-05-28
-- Purpose : Mobile early-access sign-up list (iOS + Android).
--           Public submits via POST /public-early-birds and
--           receives a branded welcome email.
-- Rules   : R-01 (no PII leaked), R-04 (no service-role in app code),
--           R-05 (append-only inserts from public)
-- ============================================================

-- ─── Table ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.early_birds (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 'ios'  → email holds the user's Apple ID (email-format identifier or
  --          @privaterelay.appleid.com address shared by the Sign in with Apple flow).
  -- 'android' → email holds a regular email address.
  platform                TEXT        NOT NULL CHECK (platform IN ('ios', 'android')),
  name                    TEXT        NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 120),
  email                   TEXT        NOT NULL CHECK (char_length(trim(email)) BETWEEN 5 AND 254),
  ip_address              TEXT,       -- rate-limiting only; not returned in any public response
  welcome_email_sent_at   TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Prevent the same user from signing up twice on the same platform.
CREATE UNIQUE INDEX IF NOT EXISTS early_birds_platform_email_uidx
  ON public.early_birds (platform, lower(email));

-- ─── Row-Level Security ──────────────────────────────────────────────────────

ALTER TABLE public.early_birds ENABLE ROW LEVEL SECURITY;

-- Anon role may INSERT (public form). No SELECT/UPDATE/DELETE for anon.
-- Admins use the service_role client which bypasses RLS.
CREATE POLICY "early_birds_anon_insert"
  ON public.early_birds
  FOR INSERT
  TO anon
  WITH CHECK (true);

-- ─── Indexes ─────────────────────────────────────────────────────────────────

-- Rate-limit lookups (IP + time window)
CREATE INDEX IF NOT EXISTS early_birds_ip_created_idx
  ON public.early_birds (ip_address, created_at DESC);

-- Admin browsing by platform / created date
CREATE INDEX IF NOT EXISTS early_birds_platform_created_idx
  ON public.early_birds (platform, created_at DESC);

-- ─── Rate-limit helper (SECURITY DEFINER) ────────────────────────────────────
--
-- Returns TRUE  → IP is allowed to submit (within limits).
-- Returns FALSE → IP is rate-limited; reject with 429.
--
-- Limits:
--   • < 5 submissions per IP in the last 10 minutes
--   • < 10 submissions per IP in the last hour
--
-- These are slightly more permissive than host_applications because mobile
-- onboarding may legitimately retry from the same NAT'd IP (e.g. office wifi).

CREATE OR REPLACE FUNCTION public.check_early_bird_rate_limit(p_ip TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
AS $$
  SELECT
    (
      SELECT COUNT(*)
        FROM public.early_birds
       WHERE ip_address = p_ip
         AND created_at > NOW() - INTERVAL '10 minutes'
    ) < 5
    AND
    (
      SELECT COUNT(*)
        FROM public.early_birds
       WHERE ip_address = p_ip
         AND created_at > NOW() - INTERVAL '1 hour'
    ) < 10;
$$;

-- Grant anon EXECUTE so the public Edge Function can call this RPC
-- without needing service-role access (R-04).
GRANT EXECUTE ON FUNCTION public.check_early_bird_rate_limit(TEXT) TO anon;
