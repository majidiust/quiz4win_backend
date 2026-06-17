-- =============================================================================
-- Quiz4Win — Host fee, commission, visibility, assignment acceptance + payout trigger
-- Migration: 20260617000000_host_fee_commission_assignment.sql
-- Author:    A-01 (Augment Code Agent) — 2026-06-17
-- =============================================================================
-- Adds per-game / per-template host compensation parameters:
--   host_fee             NUMERIC — fixed fee paid to host regardless of income
--   host_commission_pct  NUMERIC — % of total game income (entry fees + IAP) paid to host
--   show_host_fee        BOOLEAN — admin toggle: show host_fee in host-app
--   show_host_commission BOOLEAN — admin toggle: show host_commission_pct in host-app
--
-- Adds games.host_assignment_status to track direct-assignment acceptance:
--   unassigned → pending (admin assigns) → accepted | rejected
--   On reject: host_id cleared, game returns to pool (unassigned).
--
-- Adds notifications.type value 'host_assignment' for direct-assignment events.
--
-- Payout trigger: AFTER UPDATE OF prizes_distributed_at fires
--   record_host_earning(game_id) which inserts a pending host_earnings row
--   based on host_fee + host_commission_pct * SUM(entry fees).
--
-- Rule compliance:
--   R-02 — NUMERIC columns; no floats.
--   R-05 — host_earnings is append-only; trigger uses ON CONFLICT DO NOTHING.
--   R-06 — no reverse imports.
--   R-12 — applied exclusively by db-maintainer.
-- =============================================================================

BEGIN;

-- ─── 1. Extend game_templates ─────────────────────────────────────────────────
ALTER TABLE public.game_templates
  ADD COLUMN IF NOT EXISTS host_fee            NUMERIC(12,2) NOT NULL DEFAULT 0
      CHECK (host_fee >= 0),
  ADD COLUMN IF NOT EXISTS host_commission_pct NUMERIC(5,2)  NOT NULL DEFAULT 0
      CHECK (host_commission_pct BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS show_host_fee        BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS show_host_commission BOOLEAN NOT NULL DEFAULT TRUE;

-- ─── 2. Extend games ──────────────────────────────────────────────────────────
ALTER TABLE public.games
  ADD COLUMN IF NOT EXISTS host_fee            NUMERIC(12,2) NOT NULL DEFAULT 0
      CHECK (host_fee >= 0),
  ADD COLUMN IF NOT EXISTS host_commission_pct NUMERIC(5,2)  NOT NULL DEFAULT 0
      CHECK (host_commission_pct BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS show_host_fee        BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS show_host_commission BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS host_assignment_status TEXT NOT NULL DEFAULT 'unassigned'
      CHECK (host_assignment_status IN ('unassigned','pending','accepted','rejected'));

-- ─── 3. Backfill host_assignment_status ──────────────────────────────────────
-- Games that already have a host are considered accepted (pre-feature assignments).
UPDATE public.games
   SET host_assignment_status = 'accepted'
 WHERE host_id IS NOT NULL
   AND host_assignment_status = 'unassigned';

-- ─── 4. Extend notifications.type CHECK ──────────────────────────────────────
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications
    ADD CONSTRAINT notifications_type_check CHECK (
        type IN (
            'prize','game_invite','show_reminder','kyc_update',
            'withdrawal','system','promotion',
            'host_application','host_invite','host_request','host_earning',
            'host_payment_method','host_file','host_stream','host_assignment'
        )
    );

-- ─── 5. record_host_earning() — idempotent, called by trigger ────────────────
CREATE OR REPLACE FUNCTION public.record_host_earning(p_game_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_host_id        UUID;
    v_host_fee       NUMERIC;
    v_comm_pct       NUMERIC;
    v_currency       TEXT;
    v_income         NUMERIC;
    v_earning        NUMERIC;
BEGIN
    SELECT host_id, host_fee, host_commission_pct,
           COALESCE(prize_pool_currency, 'USD')
      INTO v_host_id, v_host_fee, v_comm_pct, v_currency
      FROM public.games
     WHERE id = p_game_id;

    IF v_host_id IS NULL THEN RETURN; END IF;

    -- Sum all completed entry-fee income for this game.
    SELECT COALESCE(SUM(amount), 0)
      INTO v_income
      FROM public.transactions
     WHERE game_id = p_game_id
       AND type    = 'game_entry_fee'
       AND status  = 'completed';

    v_earning := COALESCE(v_host_fee, 0)
               + ROUND(v_income * COALESCE(v_comm_pct, 0) / 100.0, 2);

    IF v_earning <= 0 THEN RETURN; END IF;

    INSERT INTO public.host_earnings
        (host_id, game_id, amount, currency, status, created_at, updated_at)
    VALUES
        (v_host_id, p_game_id, v_earning, v_currency, 'pending', NOW(), NOW())
    ON CONFLICT (host_id, game_id) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.record_host_earning(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.record_host_earning(UUID) TO service_role;

-- ─── 6. Trigger: fire record_host_earning when prizes are settled ─────────────
CREATE OR REPLACE FUNCTION public.trg_fn_record_host_earning()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Only when prizes_distributed_at transitions NULL → value.
    IF OLD.prizes_distributed_at IS NULL AND NEW.prizes_distributed_at IS NOT NULL THEN
        PERFORM public.record_host_earning(NEW.id);
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_record_host_earning ON public.games;
CREATE TRIGGER trg_record_host_earning
    AFTER UPDATE OF prizes_distributed_at ON public.games
    FOR EACH ROW EXECUTE FUNCTION public.trg_fn_record_host_earning();

COMMIT;
