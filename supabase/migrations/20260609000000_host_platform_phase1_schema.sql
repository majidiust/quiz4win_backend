-- =============================================================================
-- Quiz4Win — Host Platform Phase 1 schema
-- Migration: 20260609000000_host_platform_phase1_schema.sql
-- Author:    A-01 (Augment Code Agent) — 2026-06-09
-- =============================================================================
-- Decisions D-1..D-6 logged in Change_Log_AI.md (2026-06-09, human-approved):
--   D-1: Reuse Supabase Auth (GoTrue) — no custom password/OTP/refresh.
--   D-2: Host = extension of existing user (auth.users + profiles + show_hosts).
--   D-3: Extend show_hosts in place; preserve games.host_id FK.
--   D-4: Reuse profiles.wallet_balance + transactions ledger;
--        new host_earnings reservation table (R-05 append-only preserved).
--   D-5: host.quiz4win.com / port 5803 / host-app Next.js (Phase 8).
--   D-6: Reuse LIVEKIT_API_KEY/SECRET.
--
-- Invariants enforced:
--   INV-16 — Host earnings reservation pattern (pending → approved → paid)
--   INV-17 — No overlapping host assignments (helper: check_host_schedule_conflict)
--   INV-18 — Host application & status gates (application_status + status)
--
-- Rule compliance:
--   R-02 — money columns kept NUMERIC(12,2) to match existing schema; the
--          repo-wide R-02 conflict (open P0) will sweep all tables together.
--   R-04 — RLS ENABLED on every new table. Policies land in Phase 1b.
--   R-05 — host_earnings is the lifecycle surface. transactions stays
--          append-only; transaction_id is set ONCE on admin approval.
--   R-06 — pure schema migration; no reverse imports.
--   R-12 — applied exclusively by db-maintainer; this file is checked in
--          and waits for `docker compose up -d --force-recreate db-maintainer`.
-- =============================================================================

BEGIN;

-- ─── 1. Extend show_hosts ────────────────────────────────────────────────────
-- application_status is the host onboarding lifecycle (pending/approved/...).
-- The pre-existing `status` column (active/inactive) stays as the operational
-- visibility flag used by public-featured-host and admin-shows.
ALTER TABLE public.show_hosts
  ADD COLUMN IF NOT EXISTS auth_user_id        UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS application_status  TEXT NOT NULL DEFAULT 'approved'
      CHECK (application_status IN ('pending','approved','rejected','suspended')),
  ADD COLUMN IF NOT EXISTS country             TEXT,
  ADD COLUMN IF NOT EXISTS languages           TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS phone               TEXT,
  ADD COLUMN IF NOT EXISTS instagram_url       TEXT,
  ADD COLUMN IF NOT EXISTS telegram_url        TEXT,
  ADD COLUMN IF NOT EXISTS youtube_url         TEXT,
  ADD COLUMN IF NOT EXISTS tiktok_url          TEXT,
  ADD COLUMN IF NOT EXISTS twitter_url         TEXT,
  ADD COLUMN IF NOT EXISTS website_url         TEXT,
  ADD COLUMN IF NOT EXISTS short_bio           TEXT,
  ADD COLUMN IF NOT EXISTS applied_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_by         UUID REFERENCES public.admin_users(id),
  ADD COLUMN IF NOT EXISTS rejected_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejection_reason    TEXT,
  ADD COLUMN IF NOT EXISTS suspended_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS suspension_reason   TEXT,
  ADD COLUMN IF NOT EXISTS total_earnings      NUMERIC(12,2) NOT NULL DEFAULT 0.00;

-- Existing admin-managed rows are operational presenters; mark them approved
-- so the new application_status gate (INV-18) does not lock them out.
-- DEFAULT 'approved' on the ADD COLUMN above handles new and existing rows in
-- one shot. New self-service signups will explicitly INSERT with 'pending'.

CREATE INDEX IF NOT EXISTS idx_show_hosts_auth_user_id       ON public.show_hosts(auth_user_id);
CREATE INDEX IF NOT EXISTS idx_show_hosts_application_status ON public.show_hosts(application_status);

-- ─── 2. Extend transactions.type CHECK ───────────────────────────────────────
-- Preserve every value from 20260607000000_three_bucket_financial_model.sql
-- (including 'earnings_transfer'); add 'host_earning' + 'host_payout' for INV-16.
ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS transactions_type_check;
ALTER TABLE public.transactions
  ADD CONSTRAINT transactions_type_check CHECK (
    type IN ('topup','withdrawal','game_entry_fee','prize',
             'referral_bonus','refund','admin_adjustment','earnings_transfer',
             'host_earning','host_payout')
  );

-- ─── 3. host_game_requests ───────────────────────────────────────────────────
-- Host applies to host a specific game; admin approves/rejects.
CREATE TABLE IF NOT EXISTS public.host_game_requests (
    id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    host_id      UUID         NOT NULL REFERENCES public.show_hosts(id) ON DELETE CASCADE,
    game_id      UUID         NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
    status       TEXT         NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending','approved','rejected','cancelled')),
    host_note    TEXT,
    admin_note   TEXT,
    reviewed_by  UUID         REFERENCES public.admin_users(id),
    reviewed_at  TIMESTAMPTZ,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (host_id, game_id)
);
CREATE INDEX IF NOT EXISTS idx_host_game_requests_host_id ON public.host_game_requests(host_id);
CREATE INDEX IF NOT EXISTS idx_host_game_requests_game_id ON public.host_game_requests(game_id);
CREATE INDEX IF NOT EXISTS idx_host_game_requests_status  ON public.host_game_requests(status);
ALTER TABLE public.host_game_requests ENABLE ROW LEVEL SECURITY;

-- ─── 4. host_invitations ─────────────────────────────────────────────────────
-- Admin invites a host to host a game; host accepts/rejects.
CREATE TABLE IF NOT EXISTS public.host_invitations (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    host_id         UUID         NOT NULL REFERENCES public.show_hosts(id) ON DELETE CASCADE,
    game_id         UUID         NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
    invited_by      UUID         NOT NULL REFERENCES public.admin_users(id),
    status          TEXT         NOT NULL DEFAULT 'sent'
                                 CHECK (status IN ('sent','accepted','rejected','expired','cancelled')),
    admin_message   TEXT,
    expires_at      TIMESTAMPTZ,
    responded_at    TIMESTAMPTZ,
    response_note   TEXT,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (host_id, game_id)
);
CREATE INDEX IF NOT EXISTS idx_host_invitations_host_id ON public.host_invitations(host_id);
CREATE INDEX IF NOT EXISTS idx_host_invitations_game_id ON public.host_invitations(game_id);
CREATE INDEX IF NOT EXISTS idx_host_invitations_status  ON public.host_invitations(status);
ALTER TABLE public.host_invitations ENABLE ROW LEVEL SECURITY;

-- ─── 5. host_stream_sessions ─────────────────────────────────────────────────
-- Per-game stream-readiness state machine. LiveKit token minted on `live`.
CREATE TABLE IF NOT EXISTS public.host_stream_sessions (
    id                       UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    host_id                  UUID         NOT NULL REFERENCES public.show_hosts(id) ON DELETE CASCADE,
    game_id                  UUID         NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
    status                   TEXT         NOT NULL DEFAULT 'created'
                                          CHECK (status IN ('created','testing','ready','live','ended','failed')),
    camera_ok                BOOLEAN      NOT NULL DEFAULT FALSE,
    mic_ok                   BOOLEAN      NOT NULL DEFAULT FALSE,
    connection_ok            BOOLEAN      NOT NULL DEFAULT FALSE,
    livekit_token_minted_at  TIMESTAMPTZ,
    started_at               TIMESTAMPTZ,
    ended_at                 TIMESTAMPTZ,
    failure_reason           TEXT,
    created_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (host_id, game_id)
);
CREATE INDEX IF NOT EXISTS idx_host_stream_sessions_host_id ON public.host_stream_sessions(host_id);
CREATE INDEX IF NOT EXISTS idx_host_stream_sessions_game_id ON public.host_stream_sessions(game_id);
CREATE INDEX IF NOT EXISTS idx_host_stream_sessions_status  ON public.host_stream_sessions(status);
ALTER TABLE public.host_stream_sessions ENABLE ROW LEVEL SECURITY;

-- ─── 6. host_earnings (INV-16 reservation layer) ─────────────────────────────
-- pending: earning recorded post-game, awaiting admin approval. No money has moved.
-- approved: admin approved → atomic block inserts transactions(type='host_earning')
--           + credits profiles.wallet_balance + sets transaction_id here.
-- paid: covered when host_payout transaction lands (or via existing withdrawals).
-- cancelled: pending earnings only; approved earnings need compensating admin_adjustment (R-05).
CREATE TABLE IF NOT EXISTS public.host_earnings (
    id                 UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    host_id            UUID          NOT NULL REFERENCES public.show_hosts(id) ON DELETE RESTRICT,
    game_id            UUID          NOT NULL REFERENCES public.games(id) ON DELETE RESTRICT,
    amount             NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
    currency           TEXT          NOT NULL DEFAULT 'USD',
    status             TEXT          NOT NULL DEFAULT 'pending'
                                     CHECK (status IN ('pending','approved','paid','cancelled')),
    approved_by        UUID          REFERENCES public.admin_users(id),
    approved_at        TIMESTAMPTZ,
    paid_at            TIMESTAMPTZ,
    cancelled_reason   TEXT,
    transaction_id     UUID          REFERENCES public.transactions(id),
    note               TEXT,
    created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    UNIQUE (host_id, game_id)
);
CREATE INDEX IF NOT EXISTS idx_host_earnings_host_id ON public.host_earnings(host_id);
CREATE INDEX IF NOT EXISTS idx_host_earnings_game_id ON public.host_earnings(game_id);
CREATE INDEX IF NOT EXISTS idx_host_earnings_status  ON public.host_earnings(status);
ALTER TABLE public.host_earnings ENABLE ROW LEVEL SECURITY;

-- ─── 7. host_payment_methods ─────────────────────────────────────────────────
-- Host's payout destinations. account_details is JSONB validated per method_type
-- in the Edge Function; admin verifies before status flips to 'active'.
CREATE TABLE IF NOT EXISTS public.host_payment_methods (
    id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    host_id            UUID         NOT NULL REFERENCES public.show_hosts(id) ON DELETE CASCADE,
    method_type        TEXT         NOT NULL
                                    CHECK (method_type IN ('iban','bank_account','paypal',
                                                           'usdt_trc20','usdt_erc20','btc','other')),
    label              TEXT,
    account_details    JSONB        NOT NULL,
    status             TEXT         NOT NULL DEFAULT 'pending_verification'
                                    CHECK (status IN ('pending_verification','active','inactive','rejected')),
    is_default         BOOLEAN      NOT NULL DEFAULT FALSE,
    verified_at        TIMESTAMPTZ,
    verified_by        UUID         REFERENCES public.admin_users(id),
    rejected_reason    TEXT,
    created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_host_payment_methods_host_id ON public.host_payment_methods(host_id);
CREATE INDEX IF NOT EXISTS idx_host_payment_methods_status  ON public.host_payment_methods(status);
ALTER TABLE public.host_payment_methods ENABLE ROW LEVEL SECURITY;

-- ─── 8. host_uploaded_files ──────────────────────────────────────────────────
-- Verification files (selfie, id_document, intro_video, etc.). Stored on the
-- shared S3 bucket (DO Spaces) via _shared/s3.ts; admin reviews before approval.
CREATE TABLE IF NOT EXISTS public.host_uploaded_files (
    id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    host_id             UUID         NOT NULL REFERENCES public.show_hosts(id) ON DELETE CASCADE,
    file_type           TEXT         NOT NULL
                                     CHECK (file_type IN ('avatar','selfie','id_document','intro_video','screenshot','other')),
    s3_key              TEXT         NOT NULL,
    url                 TEXT         NOT NULL,
    mime_type           TEXT         NOT NULL,
    file_size_bytes     BIGINT,
    status              TEXT         NOT NULL DEFAULT 'pending'
                                     CHECK (status IN ('pending','approved','rejected')),
    reviewed_by         UUID         REFERENCES public.admin_users(id),
    reviewed_at         TIMESTAMPTZ,
    rejection_reason    TEXT,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_host_uploaded_files_host_id ON public.host_uploaded_files(host_id);
CREATE INDEX IF NOT EXISTS idx_host_uploaded_files_status  ON public.host_uploaded_files(status);
ALTER TABLE public.host_uploaded_files ENABLE ROW LEVEL SECURITY;

-- ─── 9. check_host_schedule_conflict — INV-17 ────────────────────────────────
-- Returns TRUE if the host has any other active commitment whose live window
-- overlaps [scheduled_at, scheduled_at + 90 minutes) of p_game_id. Used by
-- Phase 3 (request approval) and Phase 4 (invitation accept).
CREATE OR REPLACE FUNCTION public.check_host_schedule_conflict(
    p_host_id UUID,
    p_game_id UUID
) RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_scheduled_at TIMESTAMPTZ;
    v_window       INTERVAL := INTERVAL '90 minutes';
    v_start        TIMESTAMPTZ;
    v_end          TIMESTAMPTZ;
BEGIN
    SELECT scheduled_at INTO v_scheduled_at FROM public.games WHERE id = p_game_id;
    IF v_scheduled_at IS NULL THEN RETURN FALSE; END IF;
    v_start := v_scheduled_at;
    v_end   := v_scheduled_at + v_window;

    -- Existing assigned games (games.host_id) overlapping
    IF EXISTS (
        SELECT 1 FROM public.games g
        WHERE g.host_id = p_host_id
          AND g.id <> p_game_id
          AND g.status IN ('upcoming','open','live')
          AND g.scheduled_at IS NOT NULL
          AND tstzrange(g.scheduled_at, g.scheduled_at + v_window) && tstzrange(v_start, v_end)
    ) THEN RETURN TRUE; END IF;

    -- Accepted invitations overlapping
    IF EXISTS (
        SELECT 1 FROM public.host_invitations hi
        JOIN public.games g ON g.id = hi.game_id
        WHERE hi.host_id = p_host_id
          AND hi.status = 'accepted'
          AND hi.game_id <> p_game_id
          AND g.scheduled_at IS NOT NULL
          AND tstzrange(g.scheduled_at, g.scheduled_at + v_window) && tstzrange(v_start, v_end)
    ) THEN RETURN TRUE; END IF;

    -- Approved game requests overlapping
    IF EXISTS (
        SELECT 1 FROM public.host_game_requests hr
        JOIN public.games g ON g.id = hr.game_id
        WHERE hr.host_id = p_host_id
          AND hr.status = 'approved'
          AND hr.game_id <> p_game_id
          AND g.scheduled_at IS NOT NULL
          AND tstzrange(g.scheduled_at, g.scheduled_at + v_window) && tstzrange(v_start, v_end)
    ) THEN RETURN TRUE; END IF;

    RETURN FALSE;
END;
$$;

COMMENT ON FUNCTION public.check_host_schedule_conflict(UUID, UUID) IS
  'INV-17 host schedule conflict check. Returns TRUE if the host has any other '
  'active commitment overlapping the 90-minute window from games.scheduled_at.';

COMMIT;
