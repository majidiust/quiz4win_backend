-- =============================================================================
-- Quiz4Win — Host Platform Phase 7: notifications.type extension
-- Migration: 20260609000200_host_platform_notification_types.sql
-- Author:    A-01 — 2026-06-09
-- =============================================================================
-- Extend public.notifications.type CHECK with host-platform values so admin-hosts
-- can record per-user notifications on every host lifecycle event without
-- silently mapping them onto an existing category (which would lose semantics).
--
-- Preserves every value from 20260522120000_initial_schema.sql line 621-622.
--
-- Added types (all prefixed `host_*` for easy mobile-side filtering):
--   host_application  — application approved / rejected / suspended / reactivated
--   host_invite       — invitation received / cancelled / accepted-confirmed
--   host_request      — game-host request approved / rejected
--   host_earning      — earning approved (credit posted) / cancelled
--   host_payment_method — payout method verified / rejected
--   host_file         — verification file approved / rejected
--   host_stream       — stream-readiness reminders (future)
--
-- Rule compliance: R-12 (db-maintainer only). No financial column changed.
-- =============================================================================

BEGIN;

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE public.notifications
    ADD CONSTRAINT notifications_type_check CHECK (
        type IN (
            'prize','game_invite','show_reminder','kyc_update',
            'withdrawal','system','promotion',
            'host_application','host_invite','host_request','host_earning',
            'host_payment_method','host_file','host_stream'
        )
    );

COMMENT ON COLUMN public.notifications.type IS
    'Notification category. Customer-facing: prize/game_invite/show_reminder/'
    'kyc_update/withdrawal/system/promotion. Host-facing: host_application/'
    'host_invite/host_request/host_earning/host_payment_method/host_file/host_stream.';

COMMIT;
