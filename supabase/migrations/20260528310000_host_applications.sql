-- ============================================================
-- Migration: host_applications
-- Created : 2026-05-28
-- Purpose : Public host-application form backend.
--           Applicants submit via POST /public-host-applications
--           (unauthenticated). Admins manage via admin panel.
-- Rules   : R-01 (no PII leaked), R-04 (no service-role in app code),
--           R-05 (append-only inserts from public; admin updates status)
-- ============================================================

-- ─── Table ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.host_applications (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT        NOT NULL CHECK (char_length(trim(name)) BETWEEN 2 AND 120),
  email         TEXT        NOT NULL CHECK (char_length(trim(email)) BETWEEN 5 AND 254),
  country       TEXT,
  instagram     TEXT,
  followers     INTEGER     CHECK (followers IS NULL OR followers >= 0),
  -- Status workflow: pending → accepted | rejected | info_requested
  status        TEXT        NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending', 'accepted', 'rejected', 'info_requested')),
  admin_notes   TEXT,        -- internal only, never exposed to public
  ip_address    TEXT,        -- rate-limiting only; not returned in any public response
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Row-Level Security ──────────────────────────────────────────────────────

ALTER TABLE public.host_applications ENABLE ROW LEVEL SECURITY;

-- Anon role may INSERT (public form). No SELECT/UPDATE/DELETE for anon.
-- Admins use the service_role client which bypasses RLS.
CREATE POLICY "host_applications_anon_insert"
  ON public.host_applications
  FOR INSERT
  TO anon
  WITH CHECK (true);

-- ─── Indexes ─────────────────────────────────────────────────────────────────

-- Rate-limit lookups (IP + time window)
CREATE INDEX IF NOT EXISTS host_applications_ip_created_idx
  ON public.host_applications (ip_address, created_at DESC);

-- Admin list with status filter + default sort
CREATE INDEX IF NOT EXISTS host_applications_status_created_idx
  ON public.host_applications (status, created_at DESC);

-- Email uniqueness queries
CREATE INDEX IF NOT EXISTS host_applications_email_idx
  ON public.host_applications (email);

-- ─── Rate-limit helper (SECURITY DEFINER) ────────────────────────────────────
--
-- Returns TRUE  → IP is allowed to submit (within limits).
-- Returns FALSE → IP is rate-limited; reject with 429.
--
-- Limits:
--   • < 3 submissions per IP in the last 10 minutes
--   • < 5 submissions per IP in the last hour

CREATE OR REPLACE FUNCTION public.check_host_application_rate_limit(p_ip TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
STABLE
AS $$
  SELECT
    (
      SELECT COUNT(*)
        FROM public.host_applications
       WHERE ip_address = p_ip
         AND created_at > NOW() - INTERVAL '10 minutes'
    ) < 3
    AND
    (
      SELECT COUNT(*)
        FROM public.host_applications
       WHERE ip_address = p_ip
         AND created_at > NOW() - INTERVAL '1 hour'
    ) < 5;
$$;

-- Grant anon EXECUTE so the public Edge Function can call this RPC
-- without needing service-role access (R-04).
GRANT EXECUTE ON FUNCTION public.check_host_application_rate_limit(TEXT) TO anon;
