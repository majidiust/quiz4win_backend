-- =============================================================================
-- Phase 6 — Email Broadcast Tracking System
-- Migration: 20260524100000_email_broadcasts.sql
-- =============================================================================

BEGIN;

-- 1. email_broadcasts ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.email_broadcasts (
    id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    title             TEXT          NOT NULL,
    subject           TEXT          NOT NULL,
    type              TEXT          NOT NULL DEFAULT 'promotion' CHECK (type IN ('system', 'promotion')),
    payload           JSONB         NOT NULL DEFAULT '{}'::jsonb, -- components (heroTitle, bodyHtml, etc)
    content_html      TEXT          NOT NULL,
    content_text      TEXT          NOT NULL,
    target_segment    TEXT          NOT NULL CHECK (target_segment IN ('all', 'verified_only', 'non_verified_only', 'active_players_30d', 'inactive_players_30d', 'specific_ids')),
    target_ids        UUID[]        DEFAULT '{}'::uuid[], -- used if target_segment = 'specific_ids'
    status            TEXT          NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'queued', 'processing', 'completed', 'cancelled')),
    total_count       INTEGER       NOT NULL DEFAULT 0,
    sent_count        INTEGER       NOT NULL DEFAULT 0,
    error_count       INTEGER       NOT NULL DEFAULT 0,
    created_by        UUID          NOT NULL REFERENCES public.admin_users(id),
    scheduled_at      TIMESTAMPTZ,
    started_at        TIMESTAMPTZ,
    completed_at      TIMESTAMPTZ,
    created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_broadcasts_status       ON public.email_broadcasts(status);
CREATE INDEX IF NOT EXISTS idx_email_broadcasts_scheduled_at ON public.email_broadcasts(scheduled_at);
ALTER TABLE public.email_broadcasts ENABLE ROW LEVEL SECURITY;

-- 2. email_messages -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.email_messages (
    id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    broadcast_id      UUID          NOT NULL REFERENCES public.email_broadcasts(id) ON DELETE CASCADE,
    user_id           UUID          NOT NULL REFERENCES public.profiles(id),
    email             TEXT          NOT NULL, -- snapshot of email at time of sending
    message_id        TEXT,         -- Brevo message ID
    status            TEXT          NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed', 'opened', 'clicked')),
    error             TEXT,
    sent_at           TIMESTAMPTZ,
    opened_at         TIMESTAMPTZ,
    clicked_at        TIMESTAMPTZ,
    created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_messages_broadcast_id ON public.email_messages(broadcast_id);
CREATE INDEX IF NOT EXISTS idx_email_messages_user_id      ON public.email_messages(user_id);
CREATE INDEX IF NOT EXISTS idx_email_messages_status       ON public.email_messages(status);
ALTER TABLE public.email_messages ENABLE ROW LEVEL SECURITY;

-- 3. RLS — deny by default; service_role bypasses RLS implicitly --------------
CREATE POLICY email_broadcasts_deny_all
    ON public.email_broadcasts
    FOR ALL TO anon, authenticated
    USING (FALSE) WITH CHECK (FALSE);

CREATE POLICY email_messages_deny_all
    ON public.email_messages
    FOR ALL TO anon, authenticated
    USING (FALSE) WITH CHECK (FALSE);

-- 4. Helper RPCs for broadcast tracking ---------------------------------------
CREATE OR REPLACE FUNCTION public.increment_broadcast_sent(b_id UUID)
RETURNS VOID AS $$
BEGIN
    UPDATE public.email_broadcasts
    SET sent_count = sent_count + 1,
        updated_at = NOW()
    WHERE id = b_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.increment_broadcast_error(b_id UUID)
RETURNS VOID AS $$
BEGIN
    UPDATE public.email_broadcasts
    SET error_count = error_count + 1,
        updated_at = NOW()
    WHERE id = b_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMIT;
