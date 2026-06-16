-- =============================================================================
-- Quiz4Win — Host Platform Phase 1b: RLS policies
-- Migration: 20260609000100_host_platform_rls_policies.sql
-- Author:    A-01 — 2026-06-09
-- =============================================================================
-- Per R-04 every host-platform table gets row-level policies. Pattern:
--   (a) host can SELECT / INSERT / UPDATE rows whose host_id resolves to a
--       show_hosts row whose auth_user_id = auth.uid().
--   (b) For show_hosts: host can SELECT and UPDATE their own row.
--   (c) Admin Edge Functions use getAdminClient() (service_role), which
--       bypasses RLS — so no admin-side policies are needed (R-04 §4).
--   (d) Anon role gets NO policy on any new table — these are owner-private.
-- =============================================================================

BEGIN;

-- ─── show_hosts ─────────────────────────────────────────────────────────────
-- (existing policy: show_hosts_select_active for anon/authenticated on status='active'.
--  We add owner-self access so a host can read+update their own row even when
--  it is not yet 'active' — e.g. application_status='pending'.)
DROP POLICY IF EXISTS show_hosts_own_select ON public.show_hosts;
CREATE POLICY show_hosts_own_select ON public.show_hosts
    FOR SELECT TO authenticated USING (auth_user_id = auth.uid());

DROP POLICY IF EXISTS show_hosts_own_update ON public.show_hosts;
CREATE POLICY show_hosts_own_update ON public.show_hosts
    FOR UPDATE TO authenticated
    USING (auth_user_id = auth.uid())
    WITH CHECK (auth_user_id = auth.uid());

-- ─── helper macro replicated inline for each table ──────────────────────────
-- "host_id maps to current user via show_hosts.auth_user_id" — used six times.

DROP POLICY IF EXISTS host_game_requests_owner_all ON public.host_game_requests;
CREATE POLICY host_game_requests_owner_all ON public.host_game_requests
    FOR ALL TO authenticated
    USING (EXISTS (SELECT 1 FROM public.show_hosts h
                   WHERE h.id = host_game_requests.host_id AND h.auth_user_id = auth.uid()))
    WITH CHECK (EXISTS (SELECT 1 FROM public.show_hosts h
                        WHERE h.id = host_game_requests.host_id AND h.auth_user_id = auth.uid()));

DROP POLICY IF EXISTS host_invitations_owner_all ON public.host_invitations;
CREATE POLICY host_invitations_owner_all ON public.host_invitations
    FOR ALL TO authenticated
    USING (EXISTS (SELECT 1 FROM public.show_hosts h
                   WHERE h.id = host_invitations.host_id AND h.auth_user_id = auth.uid()))
    WITH CHECK (EXISTS (SELECT 1 FROM public.show_hosts h
                        WHERE h.id = host_invitations.host_id AND h.auth_user_id = auth.uid()));

DROP POLICY IF EXISTS host_stream_sessions_owner_all ON public.host_stream_sessions;
CREATE POLICY host_stream_sessions_owner_all ON public.host_stream_sessions
    FOR ALL TO authenticated
    USING (EXISTS (SELECT 1 FROM public.show_hosts h
                   WHERE h.id = host_stream_sessions.host_id AND h.auth_user_id = auth.uid()))
    WITH CHECK (EXISTS (SELECT 1 FROM public.show_hosts h
                        WHERE h.id = host_stream_sessions.host_id AND h.auth_user_id = auth.uid()));

DROP POLICY IF EXISTS host_earnings_owner_select ON public.host_earnings;
CREATE POLICY host_earnings_owner_select ON public.host_earnings
    FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public.show_hosts h
                   WHERE h.id = host_earnings.host_id AND h.auth_user_id = auth.uid()));
-- Hosts cannot INSERT/UPDATE earnings themselves (admin-only writes).

DROP POLICY IF EXISTS host_payment_methods_owner_all ON public.host_payment_methods;
CREATE POLICY host_payment_methods_owner_all ON public.host_payment_methods
    FOR ALL TO authenticated
    USING (EXISTS (SELECT 1 FROM public.show_hosts h
                   WHERE h.id = host_payment_methods.host_id AND h.auth_user_id = auth.uid()))
    WITH CHECK (EXISTS (SELECT 1 FROM public.show_hosts h
                        WHERE h.id = host_payment_methods.host_id AND h.auth_user_id = auth.uid()));

DROP POLICY IF EXISTS host_uploaded_files_owner_all ON public.host_uploaded_files;
CREATE POLICY host_uploaded_files_owner_all ON public.host_uploaded_files
    FOR ALL TO authenticated
    USING (EXISTS (SELECT 1 FROM public.show_hosts h
                   WHERE h.id = host_uploaded_files.host_id AND h.auth_user_id = auth.uid()))
    WITH CHECK (EXISTS (SELECT 1 FROM public.show_hosts h
                        WHERE h.id = host_uploaded_files.host_id AND h.auth_user_id = auth.uid()));

COMMIT;
