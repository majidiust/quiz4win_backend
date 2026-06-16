-- =============================================================================
-- Quiz4Win — Host Platform follow-up fixes (Phase 9 audit)
-- Migration: 20260609000300_host_platform_followup_fixes.sql
-- Author:    A-01 — 2026-06-09
-- =============================================================================
-- Three corrective changes uncovered while auditing the Phase 1..8 work:
--
-- (1) admin_audit_log column rename — the table was created in the initial
--     schema with `entity_type` / `entity_id`, but *every* Edge Function in the
--     repo writes `target_type` / `target_id` (admin-auth, admin-finance,
--     admin-game-templates, admin-host-applications, admin-users, admin-hosts,
--     admin-questions, admin-vouchers, admin-config, admin-kyc).  Result: every
--     admin audit INSERT has been silently failing in production.  Rename the
--     columns (and their indexes) so the existing code finally writes successful
--     audit rows.  `details` keeps its original name.
--
-- (2) approve_host_earning_atomic SECURITY DEFINER RPC — the Phase 6 admin
--     code was calling a non-existent `increment_wallet_balance` and inserting
--     transactions outside a single DB transaction, so a partial failure (wallet
--     update fails after the transactions row is committed) would leave the
--     books in an inconsistent state.  This RPC performs the whole INV-16 flow
--     in one atomic block: select-for-update earning → guard status → insert
--     transactions(type='host_earning') → debit-style update profiles +
--     show_hosts.total_earnings → update host_earnings to approved with the new
--     transaction_id.  An EXCEPTION block rolls everything back.
--
-- (3) Auto-close trigger — when games.host_id flips from NULL to NOT NULL the
--     trigger sets every still-pending host_game_requests row and every
--     still-sent host_invitations row for that game to a terminal state
--     ('cancelled' / 'expired') so two hosts can't race for the same game and
--     so the host UI does not keep showing stale offers.
--
-- Rule compliance:
--   R-02 — money columns remain NUMERIC(12,2) (the repo-wide cents migration is
--          a separate P0 task; this RPC preserves the existing precision).
--   R-05 — transactions stays append-only; the RPC INSERTs once, no UPDATE/DEL.
--   R-09 — the RPC is wrapped in plpgsql's implicit transaction semantics and
--          is SECURITY DEFINER so the whole earning approve is atomic.
--   R-12 — applied exclusively by db-maintainer.
-- =============================================================================

BEGIN;

-- ─── 1. Rename admin_audit_log columns ─────────────────────────────────────
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='admin_audit_log'
          AND column_name='entity_type'
    ) THEN
        ALTER TABLE public.admin_audit_log RENAME COLUMN entity_type TO target_type;
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='admin_audit_log'
          AND column_name='entity_id'
    ) THEN
        ALTER TABLE public.admin_audit_log RENAME COLUMN entity_id TO target_id;
    END IF;
END $$;

ALTER INDEX IF EXISTS public.idx_admin_audit_log_entity_type RENAME TO idx_admin_audit_log_target_type;
ALTER INDEX IF EXISTS public.idx_admin_audit_log_entity_id   RENAME TO idx_admin_audit_log_target_id;

COMMENT ON COLUMN public.admin_audit_log.target_type IS
    'Entity category written by admin Edge Functions (e.g. show_host, host_earning).';
COMMENT ON COLUMN public.admin_audit_log.target_id IS
    'Stringified primary key of the audited entity. UUIDs are cast to text here.';

-- ─── 2. approve_host_earning_atomic RPC ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.approve_host_earning_atomic(
    p_earning_id UUID,
    p_admin_id   UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_earning      public.host_earnings%ROWTYPE;
    v_auth_user_id UUID;
    v_total_prev   NUMERIC(12,2);
    v_tx_id        UUID;
BEGIN
    -- 2a. Lock the earning row to serialise concurrent approvers.
    SELECT * INTO v_earning
      FROM public.host_earnings
     WHERE id = p_earning_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'earning_not_found' USING ERRCODE = 'P0002';
    END IF;
    IF v_earning.status <> 'pending' THEN
        RAISE EXCEPTION 'only_pending_can_be_approved' USING ERRCODE = '22023';
    END IF;
    IF v_earning.amount IS NULL OR v_earning.amount < 0 THEN
        RAISE EXCEPTION 'invalid_amount' USING ERRCODE = '22023';
    END IF;

    -- 2b. Resolve the host's auth user (required for wallet credit).
    SELECT auth_user_id, total_earnings INTO v_auth_user_id, v_total_prev
      FROM public.show_hosts
     WHERE id = v_earning.host_id
     FOR UPDATE;

    IF v_auth_user_id IS NULL THEN
        RAISE EXCEPTION 'host_has_no_auth_user' USING ERRCODE = '22023';
    END IF;

    -- 2c. Append-only transactions row (R-05).  status='completed' because the
    --     wallet credit lands in the same atomic block immediately below.
    INSERT INTO public.transactions (
        user_id, type, amount, status, description, game_id, admin_id, created_at
    ) VALUES (
        v_auth_user_id, 'host_earning', v_earning.amount, 'completed',
        'Host earning — game ' || v_earning.game_id::text,
        v_earning.game_id, p_admin_id, NOW()
    ) RETURNING id INTO v_tx_id;

    -- 2d. Credit the host's wallet.
    UPDATE public.profiles
       SET wallet_balance = COALESCE(wallet_balance, 0) + v_earning.amount,
           updated_at     = NOW()
     WHERE id = v_auth_user_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'host_profile_missing' USING ERRCODE = '22023';
    END IF;

    -- 2e. Track cumulative earnings on the host record.
    UPDATE public.show_hosts
       SET total_earnings = COALESCE(total_earnings, 0) + v_earning.amount,
           updated_at     = NOW()
     WHERE id = v_earning.host_id;

    -- 2f. Flip the earning to approved and stamp the transaction reference.
    UPDATE public.host_earnings
       SET status         = 'approved',
           approved_by    = p_admin_id,
           approved_at    = NOW(),
           transaction_id = v_tx_id,
           updated_at     = NOW()
     WHERE id = p_earning_id;

    RETURN jsonb_build_object(
        'earning_id',     p_earning_id,
        'transaction_id', v_tx_id,
        'amount',         v_earning.amount,
        'currency',       v_earning.currency,
        'host_id',        v_earning.host_id,
        'auth_user_id',   v_auth_user_id
    );
END;
$$;

COMMENT ON FUNCTION public.approve_host_earning_atomic(UUID, UUID) IS
    'INV-16 atomic host-earning approval. Inserts the host_earning transaction, '
    'credits the host wallet, increments show_hosts.total_earnings, and flips '
    'host_earnings to approved within a single plpgsql block. Raises '
    'earning_not_found / only_pending_can_be_approved / host_has_no_auth_user '
    'on guard failures; all writes roll back on any error.';

REVOKE ALL ON FUNCTION public.approve_host_earning_atomic(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_host_earning_atomic(UUID, UUID) TO service_role;

-- ─── 3. Auto-close stale pending offers when a game gets assigned ──────────
CREATE OR REPLACE FUNCTION public.close_stale_host_offers_on_assign()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    -- Only fire when host_id transitions from NULL → NOT NULL.
    IF NEW.host_id IS NOT NULL AND (OLD.host_id IS NULL OR OLD.host_id <> NEW.host_id) THEN
        UPDATE public.host_game_requests
           SET status     = 'cancelled',
               admin_note = COALESCE(admin_note, '') ||
                            CASE WHEN admin_note IS NULL OR admin_note = '' THEN '' ELSE E'\n' END ||
                            '[auto] superseded by host assignment',
               updated_at = NOW()
         WHERE game_id = NEW.id
           AND status  = 'pending'
           AND host_id <> NEW.host_id;

        UPDATE public.host_invitations
           SET status        = 'expired',
               response_note = COALESCE(response_note, '') ||
                               CASE WHEN response_note IS NULL OR response_note = '' THEN '' ELSE E'\n' END ||
                               '[auto] superseded by host assignment',
               updated_at    = NOW()
         WHERE game_id = NEW.id
           AND status  = 'sent'
           AND host_id <> NEW.host_id;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_close_stale_host_offers_on_assign ON public.games;
CREATE TRIGGER trg_close_stale_host_offers_on_assign
AFTER UPDATE OF host_id ON public.games
FOR EACH ROW
EXECUTE FUNCTION public.close_stale_host_offers_on_assign();

COMMENT ON FUNCTION public.close_stale_host_offers_on_assign() IS
    'When games.host_id is set (NULL → NOT NULL), cancel every other pending '
    'host_game_requests row and expire every other sent host_invitations row '
    'for the same game so two hosts cannot race for the same slot.';

COMMIT;
