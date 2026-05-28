-- =============================================================================
-- Quiz4Win — Show hosts: public access + years_on_air
-- 2026-05-28 — A-01
--
-- Two changes to support GET /public-featured-host:
--
-- 1. Add show_hosts.years_on_air INTEGER — exposed on the public Host Spotlight
--    card. Nullable, defaults to NULL so existing rows keep working.
--
-- 2. Add an anon SELECT policy on show_hosts restricted to active rows. All
--    columns on this table are public-facing presenter data (name, bio,
--    avatar, shows_hosted, avg_rating, years_on_air) — no PII. The policy
--    mirrors games_select_all from 20260524200000_customer_rls_policies.sql
--    and is required because R-04 forbids service-role bypass in app code.
-- =============================================================================

BEGIN;

ALTER TABLE public.show_hosts
  ADD COLUMN IF NOT EXISTS years_on_air INTEGER;

DROP POLICY IF EXISTS show_hosts_select_active ON public.show_hosts;
CREATE POLICY show_hosts_select_active ON public.show_hosts
    FOR SELECT TO authenticated, anon USING (status = 'active');

COMMIT;
