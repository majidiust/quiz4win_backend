-- =============================================================================
-- Customer-facing Row Level Security policies
-- =============================================================================
-- The initial schema enabled RLS on every table but never created policies for
-- end-users. With RLS enabled and no SELECT policy, all reads via the anon
-- (JWT-scoped) client are silently denied — which is why /profile and
-- /wallet/balance returned 404 and other endpoints returned empty arrays.
--
-- This migration adds the minimum policy set needed for customer Edge
-- Functions to operate via the JWT-scoped anon client. Admin code paths
-- continue to use the service-role key which bypasses RLS by design.
-- R-04: every customer table now has an explicit policy.
-- R-05: financial tables (transactions, withdrawals creation) remain
--       write-restricted; users can only read.
-- =============================================================================

-- profiles --------------------------------------------------------------------
DROP POLICY IF EXISTS profiles_select_own ON public.profiles;
CREATE POLICY profiles_select_own ON public.profiles
    FOR SELECT TO authenticated USING (id = auth.uid());

DROP POLICY IF EXISTS profiles_update_own ON public.profiles;
CREATE POLICY profiles_update_own ON public.profiles
    FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());

-- user_settings ---------------------------------------------------------------
DROP POLICY IF EXISTS user_settings_select_own ON public.user_settings;
CREATE POLICY user_settings_select_own ON public.user_settings
    FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS user_settings_upsert_own ON public.user_settings;
CREATE POLICY user_settings_upsert_own ON public.user_settings
    FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS user_settings_update_own ON public.user_settings;
CREATE POLICY user_settings_update_own ON public.user_settings
    FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- push_tokens -----------------------------------------------------------------
DROP POLICY IF EXISTS push_tokens_all_own ON public.push_tokens;
CREATE POLICY push_tokens_all_own ON public.push_tokens
    FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- notification_preferences ----------------------------------------------------
DROP POLICY IF EXISTS notification_prefs_all_own ON public.notification_preferences;
CREATE POLICY notification_prefs_all_own ON public.notification_preferences
    FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- transactions (read-only; R-05 append-only via service_role) -----------------
DROP POLICY IF EXISTS transactions_select_own ON public.transactions;
CREATE POLICY transactions_select_own ON public.transactions
    FOR SELECT TO authenticated USING (user_id = auth.uid());

-- notifications (read + mark-as-read) -----------------------------------------
DROP POLICY IF EXISTS notifications_select_own ON public.notifications;
CREATE POLICY notifications_select_own ON public.notifications
    FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS notifications_update_own ON public.notifications;
CREATE POLICY notifications_update_own ON public.notifications
    FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- games (public list) ---------------------------------------------------------
DROP POLICY IF EXISTS games_select_all ON public.games;
CREATE POLICY games_select_all ON public.games
    FOR SELECT TO authenticated, anon USING (true);

-- game_participants (own + leaderboards) --------------------------------------
DROP POLICY IF EXISTS game_participants_select_all ON public.game_participants;
CREATE POLICY game_participants_select_all ON public.game_participants
    FOR SELECT TO authenticated USING (true);

-- withdrawals -----------------------------------------------------------------
DROP POLICY IF EXISTS withdrawals_select_own ON public.withdrawals;
CREATE POLICY withdrawals_select_own ON public.withdrawals
    FOR SELECT TO authenticated USING (user_id = auth.uid());

-- referral_codes (own row) ----------------------------------------------------
DROP POLICY IF EXISTS referral_codes_select_own ON public.referral_codes;
CREATE POLICY referral_codes_select_own ON public.referral_codes
    FOR SELECT TO authenticated USING (owner_id = auth.uid());

-- referral_uses (own as referrer OR referred) ---------------------------------
DROP POLICY IF EXISTS referral_uses_select_own ON public.referral_uses;
CREATE POLICY referral_uses_select_own ON public.referral_uses
    FOR SELECT TO authenticated
    USING (referrer_user_id = auth.uid() OR referred_user_id = auth.uid());

-- vouchers (public — required for /vouchers/validate) -------------------------
DROP POLICY IF EXISTS vouchers_select_active ON public.vouchers;
CREATE POLICY vouchers_select_active ON public.vouchers
    FOR SELECT TO authenticated, anon USING (status = 'active');

-- voucher_redemptions (own) ---------------------------------------------------
DROP POLICY IF EXISTS voucher_redemptions_select_own ON public.voucher_redemptions;
CREATE POLICY voucher_redemptions_select_own ON public.voucher_redemptions
    FOR SELECT TO authenticated USING (user_id = auth.uid());

-- voucher_announcements (public; per-game lookup) -----------------------------
DROP POLICY IF EXISTS voucher_announcements_select_all ON public.voucher_announcements;
CREATE POLICY voucher_announcements_select_all ON public.voucher_announcements
    FOR SELECT TO authenticated, anon USING (true);

-- support_tickets (own) -------------------------------------------------------
DROP POLICY IF EXISTS support_tickets_select_own ON public.support_tickets;
CREATE POLICY support_tickets_select_own ON public.support_tickets
    FOR SELECT TO authenticated USING (user_id = auth.uid());

-- support_ticket_messages (own ticket) ----------------------------------------
DROP POLICY IF EXISTS support_messages_select_own ON public.support_ticket_messages;
CREATE POLICY support_messages_select_own ON public.support_ticket_messages
    FOR SELECT TO authenticated
    USING (EXISTS (
        SELECT 1 FROM public.support_tickets t
        WHERE t.id = ticket_id AND t.user_id = auth.uid()
    ));

-- help_articles (published only) ----------------------------------------------
DROP POLICY IF EXISTS help_articles_select_published ON public.help_articles;
CREATE POLICY help_articles_select_published ON public.help_articles
    FOR SELECT TO authenticated, anon USING (is_published = true);

-- kyc_requests (own) ----------------------------------------------------------
DROP POLICY IF EXISTS kyc_requests_select_own ON public.kyc_requests;
CREATE POLICY kyc_requests_select_own ON public.kyc_requests
    FOR SELECT TO authenticated USING (user_id = auth.uid());

-- app_config (public read of safe keys) ---------------------------------------
DROP POLICY IF EXISTS app_config_select_all ON public.app_config;
CREATE POLICY app_config_select_all ON public.app_config
    FOR SELECT TO authenticated, anon USING (true);
