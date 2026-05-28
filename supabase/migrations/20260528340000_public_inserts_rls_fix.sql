-- ============================================================
-- Migration: public_inserts_rls_fix
-- Created : 2026-05-28
-- Purpose : Fix RLS errors on /public-host-applications and
--           /public-early-birds.
--
--           The previous migrations created INSERT policies for the
--           anon role only and the Edge Functions used
--           `.insert(...).select("id").single()` which compiles to
--           `INSERT ... RETURNING id`. PostgreSQL requires the inserted
--           row to also pass a SELECT policy for the RETURNING clause —
--           which we deliberately don't grant (would expose PII).
--           Result: every insert was rejected with
--               new row violates row-level security policy for table ...
--
--           The Edge Functions are being updated to NOT use RETURNING
--           (they now generate the row UUID client-side). This migration
--           tightens the SQL side defensively:
--             1. Recreates the INSERT policies as `TO anon, authenticated`
--                so the request also works if the client happens to be
--                signed in to Supabase Auth (the public form is hit from
--                the marketing site, which never logs users in, but be
--                safe).
--             2. Adds explicit GRANT INSERT to anon, authenticated
--                (some self-hosted setups don't pre-grant table privileges
--                on newly created tables).
-- Rules   : R-01 (no PII exposed via SELECT policy), R-04 (anon client)
-- ============================================================

-- ─── host_applications ─────────────────────────────────────────────────────

DROP POLICY IF EXISTS "host_applications_anon_insert"  ON public.host_applications;
DROP POLICY IF EXISTS "host_applications_public_insert" ON public.host_applications;

CREATE POLICY "host_applications_public_insert"
  ON public.host_applications
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

GRANT INSERT ON public.host_applications TO anon, authenticated;

-- ─── early_birds ───────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "early_birds_anon_insert"  ON public.early_birds;
DROP POLICY IF EXISTS "early_birds_public_insert" ON public.early_birds;

CREATE POLICY "early_birds_public_insert"
  ON public.early_birds
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

GRANT INSERT ON public.early_birds TO anon, authenticated;
