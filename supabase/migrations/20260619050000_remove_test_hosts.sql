-- =============================================================================
-- Quiz4Win — One-time cleanup: remove all (test) hosts and their dependent data
-- 2026-06-19 — A-01
--
-- Context: pre-launch test data on production. Owner-authorized full removal of
-- every public.show_hosts row and all host-scoped child data.
--
-- ⚠️  R-05 OVERRIDE (authorized, one-time, pre-launch test data only):
--     host_earnings and host_withdrawals are financial ledgers that are normally
--     append-only (never DELETE). This migration deletes them because the data
--     is test-only and no real money/users exist yet. Do NOT replicate this
--     pattern once the platform is live.
--
-- Execution: applied exclusively by the db-maintainer container (R-12).
--     Migration runners track applied files, so this runs at most once per DB;
--     on a fresh/empty DB it is a harmless no-op.
--
-- Ordering rationale (FK constraints to public.show_hosts(id)):
--   • games.host_id            → nullable, RESTRICT  → UNLINK (preserve games)
--   • game_templates.host_id   → nullable, RESTRICT  → UNLINK (preserve templates)
--   • host_earnings            → RESTRICT (financial) → DELETE (R-05 override)
--   • host_withdrawals         → RESTRICT (financial) → DELETE (R-05 override)
--   • show_host_ratings        → CASCADE  ┐
--   • host_game_requests       → CASCADE  │
--   • host_invitations         → CASCADE  │ auto-removed when show_hosts deleted
--   • host_stream_sessions     → CASCADE  │
--   • host_payment_methods     → CASCADE  │
--   • host_uploaded_files      → CASCADE  ┘ (NOTE: S3 objects are NOT removed by
--                                            this DB delete — see R-15 note below)
--
-- NOTE (R-15): host_uploaded_files rows are deleted here, but the underlying
--     S3 objects are not. If the test uploads must also be purged from storage,
--     do that separately via the S3 helper / bucket lifecycle.
-- =============================================================================

BEGIN;

-- 1. Unlink games from hosts (host_id is nullable; preserves the games)
UPDATE public.games
   SET host_id = NULL
 WHERE host_id IS NOT NULL;

-- 2. Unlink game templates from hosts (preserves the templates)
UPDATE public.game_templates
   SET host_id = NULL
 WHERE host_id IS NOT NULL;

-- 3. Remove financial child rows blocked by ON DELETE RESTRICT
--    (R-05 override — authorized test-data cleanup only)
DELETE FROM public.host_withdrawals;
DELETE FROM public.host_earnings;

-- 4. Delete the host rows. CASCADE clears:
--    show_host_ratings, host_game_requests, host_invitations,
--    host_stream_sessions, host_payment_methods, host_uploaded_files.
DELETE FROM public.show_hosts;

COMMIT;
