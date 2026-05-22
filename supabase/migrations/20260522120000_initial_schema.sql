-- =============================================================================
-- Quiz4Win Backend — Initial Schema
-- Migration: 20260522120000_initial_schema.sql
-- Author:    A-01 (Augment Code Agent)
-- Date:      2026-05-22
-- Source:    Google Sheet "Data Schema" (truth) + "Schema Description"
-- =============================================================================
-- NOTE ON MONETARY TYPES:
--   The Data Schema sheet defines all money columns as numeric(10,2) / (12,2).
--   This conflicts with Rule R-02 (integer cents). The sheet is treated as the
--   source of truth for this migration. The conflict is logged in
--   Change_Log_AI.md and a P0 task is open in Open_Tasks_AI.md.
-- NOTE ON RLS:
--   Per R-04, RLS is enabled on every table created here. Concrete policies
--   are NOT included in this initial migration; they will be added in a
--   subsequent migration after A-05 review.
-- =============================================================================

BEGIN;

-- Extensions ------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =============================================================================
-- 1. IDENTITY
-- =============================================================================

-- profiles --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
    id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    email               TEXT         NOT NULL UNIQUE,
    full_name           TEXT,
    avatar_url          TEXT,
    wallet_balance      NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    kyc_status          TEXT         NOT NULL DEFAULT 'pending'
                                     CHECK (kyc_status IN ('pending','verified','rejected')),
    language            TEXT         NOT NULL DEFAULT 'en'
                                     CHECK (language IN ('en','ar','fa','tr')),
    referral_code       TEXT         UNIQUE,
    status              TEXT         NOT NULL DEFAULT 'active'
                                     CHECK (status IN ('active','suspended','banned')),
    suspension_reason   TEXT,
    email_verified      BOOLEAN      NOT NULL DEFAULT FALSE,
    total_deposited     NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    total_withdrawn     NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    total_games_played  INTEGER      NOT NULL DEFAULT 0,
    total_prizes_won    NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    country             TEXT,
    aml_flagged         BOOLEAN      NOT NULL DEFAULT FALSE,
    fraud_suspected     BOOLEAN      NOT NULL DEFAULT FALSE,
    last_seen_at        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_profiles_email          ON public.profiles(email);
CREATE INDEX IF NOT EXISTS idx_profiles_kyc_status     ON public.profiles(kyc_status);
CREATE INDEX IF NOT EXISTS idx_profiles_referral_code  ON public.profiles(referral_code);
CREATE INDEX IF NOT EXISTS idx_profiles_status         ON public.profiles(status);
CREATE INDEX IF NOT EXISTS idx_profiles_country        ON public.profiles(country);
CREATE INDEX IF NOT EXISTS idx_profiles_aml_flagged    ON public.profiles(aml_flagged);
CREATE INDEX IF NOT EXISTS idx_profiles_fraud_suspected ON public.profiles(fraud_suspected);
CREATE INDEX IF NOT EXISTS idx_profiles_last_seen_at   ON public.profiles(last_seen_at);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- user_settings ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_settings (
    user_id          UUID         PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
    theme            TEXT         NOT NULL DEFAULT 'dark'
                                  CHECK (theme IN ('dark','light','system')),
    sound_enabled    BOOLEAN      NOT NULL DEFAULT TRUE,
    haptics_enabled  BOOLEAN      NOT NULL DEFAULT TRUE,
    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

-- push_tokens -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.push_tokens (
    id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID         NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    token       TEXT         NOT NULL,
    platform    TEXT         NOT NULL CHECK (platform IN ('ios','android')),
    device_id   TEXT         NOT NULL UNIQUE,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_push_tokens_user_id   ON public.push_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_push_tokens_device_id ON public.push_tokens(device_id);
ALTER TABLE public.push_tokens ENABLE ROW LEVEL SECURITY;

-- notification_preferences ----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notification_preferences (
    user_id         UUID         PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
    game_reminders  BOOLEAN      NOT NULL DEFAULT TRUE,
    promotions      BOOLEAN      NOT NULL DEFAULT FALSE,
    kyc_updates     BOOLEAN      NOT NULL DEFAULT TRUE,
    system          BOOLEAN      NOT NULL DEFAULT TRUE,
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- 2. ADMIN
-- =============================================================================

-- admin_users -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.admin_users (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    email           TEXT         NOT NULL UNIQUE,
    name            TEXT         NOT NULL,
    role            TEXT         NOT NULL
                                 CHECK (role IN ('super_admin','admin','moderator','finance','support')),
    status          TEXT         NOT NULL DEFAULT 'active'
                                 CHECK (status IN ('active','disabled')),
    mfa_enabled     BOOLEAN      NOT NULL DEFAULT FALSE,
    mfa_secret      TEXT,
    last_login_at   TIMESTAMPTZ,
    last_login_ip   TEXT,
    invited_by      UUID         REFERENCES public.admin_users(id),
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_admin_users_role   ON public.admin_users(role);
CREATE INDEX IF NOT EXISTS idx_admin_users_status ON public.admin_users(status);
ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;

-- admin_audit_log -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.admin_audit_log (
    id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    admin_id     UUID         NOT NULL REFERENCES public.admin_users(id),
    action       TEXT         NOT NULL,
    entity_type  TEXT,
    entity_id    TEXT,
    details      JSONB,
    ip_address   TEXT,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_admin_id     ON public.admin_audit_log(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_action       ON public.admin_audit_log(action);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_entity_type  ON public.admin_audit_log(entity_type);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_entity_id    ON public.admin_audit_log(entity_id);
CREATE INDEX IF NOT EXISTS idx_admin_audit_log_created_at   ON public.admin_audit_log(created_at);
ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;


-- =============================================================================
-- 3. SHOW HOSTS & GAMES
-- =============================================================================

-- show_hosts ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.show_hosts (
    id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    name          TEXT         NOT NULL UNIQUE,
    bio           TEXT,
    avatar_url    TEXT,
    social_links  JSONB,
    shows_hosted  INTEGER      NOT NULL DEFAULT 0,
    avg_rating    NUMERIC(3,2),
    status        TEXT         NOT NULL DEFAULT 'active'
                               CHECK (status IN ('active','inactive')),
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_show_hosts_status ON public.show_hosts(status);
ALTER TABLE public.show_hosts ENABLE ROW LEVEL SECURITY;

-- games -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.games (
    id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    show_id               TEXT,
    title                 TEXT          NOT NULL,
    subtitle              TEXT,
    mode                  TEXT          NOT NULL
                                        CHECK (mode IN ('timed','battle','daily','tournament','live')),
    category              TEXT,
    difficulty            TEXT          CHECK (difficulty IN ('Easy','Medium','Hard') OR difficulty IS NULL),
    entry_fee             NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    prize_pool            NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    max_players           INTEGER,
    questions_count       INTEGER       NOT NULL DEFAULT 0,
    time_per_question     INTEGER       NOT NULL DEFAULT 15,
    scheduled_at          TIMESTAMPTZ,
    started_at            TIMESTAMPTZ,
    ended_at              TIMESTAMPTZ,
    status                TEXT          NOT NULL DEFAULT 'upcoming'
                                        CHECK (status IN ('upcoming','open','live','completed','cancelled')),
    prize_breakdown       JSONB,
    prize_distribution    JSONB,
    rules                 TEXT[],
    icon                  TEXT,
    thumbnail_url         TEXT,
    description           TEXT,
    cancelled_reason      TEXT,
    host_id               UUID          REFERENCES public.show_hosts(id),
    host_name             TEXT,
    host_avatar_url       TEXT,
    host_title            TEXT,
    allowed_wrong_answers INTEGER,
    livekit_room_name     TEXT,
    livekit_egress_id     TEXT,
    stream_url            TEXT,
    hls_url               TEXT,
    recording_url         TEXT,
    viewer_count          INTEGER       NOT NULL DEFAULT 0,
    sponsor               TEXT,
    accent_color          TEXT,
    glow_color            TEXT,
    gradient_colors       TEXT[],
    tags                  TEXT[],
    live_audience         INTEGER,
    total_winners         INTEGER,
    total_participants    INTEGER,
    created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_games_show_id           ON public.games(show_id);
CREATE INDEX IF NOT EXISTS idx_games_mode              ON public.games(mode);
CREATE INDEX IF NOT EXISTS idx_games_category          ON public.games(category);
CREATE INDEX IF NOT EXISTS idx_games_status            ON public.games(status);
CREATE INDEX IF NOT EXISTS idx_games_scheduled_at      ON public.games(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_games_started_at        ON public.games(started_at);
CREATE INDEX IF NOT EXISTS idx_games_host_id           ON public.games(host_id);
CREATE INDEX IF NOT EXISTS idx_games_livekit_room_name ON public.games(livekit_room_name);
ALTER TABLE public.games ENABLE ROW LEVEL SECURITY;

-- questions -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.questions (
    id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    text          TEXT         NOT NULL,
    options       TEXT[]       NOT NULL CHECK (array_length(options, 1) = 4),
    correct_index INTEGER      NOT NULL CHECK (correct_index BETWEEN 0 AND 3),
    category      TEXT         NOT NULL,
    difficulty    TEXT         NOT NULL CHECK (difficulty IN ('Easy','Medium','Hard')),
    language      TEXT         NOT NULL DEFAULT 'en'
                               CHECK (language IN ('en','ar','fa','tr')),
    media_url     TEXT,
    explanation   TEXT,
    source        TEXT,
    used_count    INTEGER      NOT NULL DEFAULT 0,
    active        BOOLEAN      NOT NULL DEFAULT TRUE,
    deleted_at    TIMESTAMPTZ,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_questions_category   ON public.questions(category);
CREATE INDEX IF NOT EXISTS idx_questions_difficulty ON public.questions(difficulty);
CREATE INDEX IF NOT EXISTS idx_questions_language   ON public.questions(language);
CREATE INDEX IF NOT EXISTS idx_questions_active     ON public.questions(active);
CREATE INDEX IF NOT EXISTS idx_questions_deleted_at ON public.questions(deleted_at);
ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;

-- game_questions --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.game_questions (
    game_id      UUID    NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
    question_id  UUID    NOT NULL REFERENCES public.questions(id),
    "order"      INTEGER NOT NULL,
    PRIMARY KEY (game_id, question_id)
);
CREATE INDEX IF NOT EXISTS idx_game_questions_game_id ON public.game_questions(game_id);
ALTER TABLE public.game_questions ENABLE ROW LEVEL SECURITY;


-- game_participants -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.game_participants (
    id                 UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    game_id            UUID          NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
    user_id            UUID          NOT NULL REFERENCES public.profiles(id),
    role               TEXT          NOT NULL DEFAULT 'player'
                                     CHECK (role IN ('player','viewer','host')),
    livekit_identity   TEXT,
    score              INTEGER       NOT NULL DEFAULT 0,
    rank               INTEGER,
    correct_answers    INTEGER       NOT NULL DEFAULT 0,
    wrong_answers      INTEGER       NOT NULL DEFAULT 0,
    entry_fee_paid     NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    prize_earned       NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    lives_remaining    INTEGER,
    eliminated         BOOLEAN       NOT NULL DEFAULT FALSE,
    status             TEXT          NOT NULL DEFAULT 'active'
                                     CHECK (status IN ('active','completed','disqualified')),
    joined_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    completed_at       TIMESTAMPTZ,
    UNIQUE (game_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_game_participants_game_id          ON public.game_participants(game_id);
CREATE INDEX IF NOT EXISTS idx_game_participants_user_id          ON public.game_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_game_participants_role             ON public.game_participants(role);
CREATE INDEX IF NOT EXISTS idx_game_participants_rank             ON public.game_participants(rank);
CREATE INDEX IF NOT EXISTS idx_game_participants_status           ON public.game_participants(status);
CREATE INDEX IF NOT EXISTS idx_game_participants_livekit_identity ON public.game_participants(livekit_identity);
ALTER TABLE public.game_participants ENABLE ROW LEVEL SECURITY;

-- game_answers ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.game_answers (
    id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    game_id          UUID         NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,
    participant_id   UUID         NOT NULL REFERENCES public.game_participants(id) ON DELETE CASCADE,
    question_id      UUID         NOT NULL REFERENCES public.questions(id),
    round_number     INTEGER,
    answer_index     INTEGER,
    is_correct       BOOLEAN      NOT NULL DEFAULT FALSE,
    response_time_ms INTEGER,
    points_earned    INTEGER      NOT NULL DEFAULT 0,
    submitted_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (participant_id, question_id)
);
CREATE INDEX IF NOT EXISTS idx_game_answers_game_id        ON public.game_answers(game_id);
CREATE INDEX IF NOT EXISTS idx_game_answers_participant_id ON public.game_answers(participant_id);
CREATE INDEX IF NOT EXISTS idx_game_answers_question_id    ON public.game_answers(question_id);
CREATE INDEX IF NOT EXISTS idx_game_answers_round_number   ON public.game_answers(round_number);
CREATE INDEX IF NOT EXISTS idx_game_answers_is_correct     ON public.game_answers(is_correct);
ALTER TABLE public.game_answers ENABLE ROW LEVEL SECURITY;

-- show_host_ratings -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.show_host_ratings (
    id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    host_id    UUID         NOT NULL REFERENCES public.show_hosts(id) ON DELETE CASCADE,
    game_id    UUID         REFERENCES public.games(id),
    user_id    UUID         NOT NULL REFERENCES public.profiles(id),
    rating     INTEGER      NOT NULL CHECK (rating BETWEEN 1 AND 5),
    created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (host_id, game_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_show_host_ratings_host_id ON public.show_host_ratings(host_id);
CREATE INDEX IF NOT EXISTS idx_show_host_ratings_game_id ON public.show_host_ratings(game_id);
CREATE INDEX IF NOT EXISTS idx_show_host_ratings_user_id ON public.show_host_ratings(user_id);
ALTER TABLE public.show_host_ratings ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- 4. FINANCE
-- =============================================================================

-- transactions ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.transactions (
    id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID          NOT NULL REFERENCES public.profiles(id),
    type         TEXT          NOT NULL
                               CHECK (type IN ('topup','withdrawal','game_entry_fee','prize',
                                               'referral_bonus','refund','admin_adjustment')),
    amount       NUMERIC(12,2) NOT NULL,
    status       TEXT          NOT NULL DEFAULT 'pending'
                               CHECK (status IN ('pending','completed','failed')),
    reference    TEXT,
    description  TEXT,
    game_id      UUID          REFERENCES public.games(id),
    admin_id     UUID          REFERENCES public.admin_users(id),
    metadata     JSONB,
    created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_transactions_user_id    ON public.transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_type       ON public.transactions(type);
CREATE INDEX IF NOT EXISTS idx_transactions_status     ON public.transactions(status);
CREATE INDEX IF NOT EXISTS idx_transactions_game_id    ON public.transactions(game_id);
CREATE INDEX IF NOT EXISTS idx_transactions_admin_id   ON public.transactions(admin_id);
CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON public.transactions(created_at);
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

-- withdrawals -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.withdrawals (
    id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id               UUID          NOT NULL REFERENCES public.profiles(id),
    amount                NUMERIC(12,2) NOT NULL,
    method                TEXT          NOT NULL
                                        CHECK (method IN ('bank_transfer','crypto','paypal')),
    account_details       JSONB         NOT NULL,
    status                TEXT          NOT NULL DEFAULT 'pending'
                                        CHECK (status IN ('pending','processing','completed','rejected')),
    rejection_reason      TEXT,
    transaction_id        UUID          REFERENCES public.transactions(id),
    transaction_reference TEXT,
    aml_flagged           BOOLEAN       NOT NULL DEFAULT FALSE,
    reviewed_by           UUID          REFERENCES public.admin_users(id),
    reviewed_at           TIMESTAMPTZ,
    internal_note         TEXT,
    requested_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    completed_at          TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_withdrawals_user_id      ON public.withdrawals(user_id);
CREATE INDEX IF NOT EXISTS idx_withdrawals_status       ON public.withdrawals(status);
CREATE INDEX IF NOT EXISTS idx_withdrawals_aml_flagged  ON public.withdrawals(aml_flagged);
CREATE INDEX IF NOT EXISTS idx_withdrawals_reviewed_by  ON public.withdrawals(reviewed_by);
CREATE INDEX IF NOT EXISTS idx_withdrawals_requested_at ON public.withdrawals(requested_at);
ALTER TABLE public.withdrawals ENABLE ROW LEVEL SECURITY;


-- kyc_requests ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.kyc_requests (
    id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID         NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    doc_type         TEXT         NOT NULL
                                  CHECK (doc_type IN ('national_id','passport','drivers_license')),
    front_image_url  TEXT         NOT NULL,
    back_image_url   TEXT,
    selfie_url       TEXT         NOT NULL,
    status           TEXT         NOT NULL DEFAULT 'pending'
                                  CHECK (status IN ('pending','verified','rejected')),
    rejection_reason TEXT,
    attempt_number   INTEGER      NOT NULL DEFAULT 1 CHECK (attempt_number BETWEEN 1 AND 3),
    reviewed_by      UUID         REFERENCES public.admin_users(id),
    submitted_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    reviewed_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_kyc_requests_user_id      ON public.kyc_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_kyc_requests_status       ON public.kyc_requests(status);
CREATE INDEX IF NOT EXISTS idx_kyc_requests_reviewed_by  ON public.kyc_requests(reviewed_by);
CREATE INDEX IF NOT EXISTS idx_kyc_requests_submitted_at ON public.kyc_requests(submitted_at);
ALTER TABLE public.kyc_requests ENABLE ROW LEVEL SECURITY;

-- aml_flags -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.aml_flags (
    id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID          NOT NULL REFERENCES public.profiles(id),
    withdrawal_id   UUID          REFERENCES public.withdrawals(id),
    total_24h_usd   NUMERIC(12,2) NOT NULL,
    status          TEXT          NOT NULL DEFAULT 'open'
                                  CHECK (status IN ('open','cleared','escalated')),
    reviewed_by     UUID          REFERENCES public.admin_users(id),
    review_note     TEXT,
    flagged_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    reviewed_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_aml_flags_user_id       ON public.aml_flags(user_id);
CREATE INDEX IF NOT EXISTS idx_aml_flags_withdrawal_id ON public.aml_flags(withdrawal_id);
CREATE INDEX IF NOT EXISTS idx_aml_flags_status        ON public.aml_flags(status);
CREATE INDEX IF NOT EXISTS idx_aml_flags_flagged_at    ON public.aml_flags(flagged_at);
ALTER TABLE public.aml_flags ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- 5. REFERRALS
-- =============================================================================

-- referral_codes --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.referral_codes (
    code           TEXT          PRIMARY KEY,
    owner_id       UUID          NOT NULL REFERENCES public.profiles(id),
    type           TEXT          NOT NULL DEFAULT 'user'
                                 CHECK (type IN ('user','promo','campaign')),
    expires_at     TIMESTAMPTZ,
    max_uses       INTEGER,
    use_count      INTEGER       NOT NULL DEFAULT 0,
    bonus_amount   NUMERIC(10,2) NOT NULL DEFAULT 5.00,
    campaign_name  TEXT,
    created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_referral_codes_owner_id ON public.referral_codes(owner_id);
CREATE INDEX IF NOT EXISTS idx_referral_codes_type     ON public.referral_codes(type);
ALTER TABLE public.referral_codes ENABLE ROW LEVEL SECURITY;

-- Now that referral_codes exists, add the FK from profiles.referral_code
ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_referral_code_fkey
    FOREIGN KEY (referral_code) REFERENCES public.referral_codes(code) DEFERRABLE INITIALLY DEFERRED;

-- referral_uses ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.referral_uses (
    id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    code              TEXT         NOT NULL REFERENCES public.referral_codes(code),
    referred_user_id  UUID         NOT NULL UNIQUE REFERENCES public.profiles(id),
    referrer_user_id  UUID         NOT NULL REFERENCES public.profiles(id),
    bonus_paid        BOOLEAN      NOT NULL DEFAULT FALSE,
    bonus_paid_at     TIMESTAMPTZ,
    used_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_referral_uses_code             ON public.referral_uses(code);
CREATE INDEX IF NOT EXISTS idx_referral_uses_referred_user_id ON public.referral_uses(referred_user_id);
CREATE INDEX IF NOT EXISTS idx_referral_uses_referrer_user_id ON public.referral_uses(referrer_user_id);
ALTER TABLE public.referral_uses ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- 6. VOUCHERS
-- =============================================================================

-- vouchers --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.vouchers (
    id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    code                  TEXT          NOT NULL UNIQUE,
    name                  TEXT          NOT NULL,
    description           TEXT,
    type                  TEXT          NOT NULL
                                        CHECK (type IN ('platform','affiliate')),
    reward_type           TEXT          CHECK (reward_type IN ('topup_bonus_pct','topup_bonus_fixed',
                                                               'free_entry','wallet_credit',
                                                               'affiliate_redirect')
                                               OR reward_type IS NULL),
    reward_value          NUMERIC(10,2),
    reward_description    TEXT          NOT NULL,
    display_text          TEXT          NOT NULL,
    usage_type            TEXT          NOT NULL DEFAULT 'multi_user_single_use'
                                        CHECK (usage_type IN ('single_use_single_user',
                                                              'multi_user_single_use',
                                                              'multi_user_multi_use',
                                                              'unlimited')),
    user_id_restriction   UUID          REFERENCES public.profiles(id),
    per_user_limit        INTEGER,
    max_redemptions       INTEGER,
    redemption_count      INTEGER       NOT NULL DEFAULT 0,
    valid_from            TIMESTAMPTZ,
    valid_until           TIMESTAMPTZ,
    min_wallet_balance_usd NUMERIC(10,2),
    kyc_required          BOOLEAN       NOT NULL DEFAULT FALSE,
    eligible_countries    TEXT[],
    partner_name          TEXT,
    partner_logo_url      TEXT,
    partner_url           TEXT,
    show_duration_sec     INTEGER       NOT NULL DEFAULT 30
                                        CHECK (show_duration_sec BETWEEN 10 AND 120),
    is_case_sensitive     BOOLEAN       NOT NULL DEFAULT FALSE,
    rate_limit_per_ip     INTEGER,
    rate_limit_per_user   INTEGER,
    status                TEXT          NOT NULL DEFAULT 'active'
                                        CHECK (status IN ('active','paused','exhausted',
                                                          'expired','cancelled')),
    cancellation_reason   TEXT,
    created_by            UUID          NOT NULL REFERENCES public.admin_users(id),
    updated_by            UUID          REFERENCES public.admin_users(id),
    created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_vouchers_code                ON public.vouchers(code);
CREATE INDEX IF NOT EXISTS idx_vouchers_type                ON public.vouchers(type);
CREATE INDEX IF NOT EXISTS idx_vouchers_reward_type         ON public.vouchers(reward_type);
CREATE INDEX IF NOT EXISTS idx_vouchers_usage_type          ON public.vouchers(usage_type);
CREATE INDEX IF NOT EXISTS idx_vouchers_status              ON public.vouchers(status);
CREATE INDEX IF NOT EXISTS idx_vouchers_valid_from          ON public.vouchers(valid_from);
CREATE INDEX IF NOT EXISTS idx_vouchers_valid_until         ON public.vouchers(valid_until);
CREATE INDEX IF NOT EXISTS idx_vouchers_user_id_restriction ON public.vouchers(user_id_restriction);
CREATE INDEX IF NOT EXISTS idx_vouchers_redemption_count    ON public.vouchers(redemption_count);
CREATE INDEX IF NOT EXISTS idx_vouchers_max_redemptions     ON public.vouchers(max_redemptions);
CREATE INDEX IF NOT EXISTS idx_vouchers_created_by          ON public.vouchers(created_by);
ALTER TABLE public.vouchers ENABLE ROW LEVEL SECURITY;


-- voucher_announcements -------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.voucher_announcements (
    id                       UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    voucher_id               UUID         NOT NULL REFERENCES public.vouchers(id) ON DELETE CASCADE,
    game_id                  UUID         NOT NULL REFERENCES public.games(id),
    announced_by             UUID         NOT NULL REFERENCES public.admin_users(id),
    announced_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    round_number             INTEGER,
    expired_at               TIMESTAMPTZ,
    expiry_reason            TEXT         CHECK (expiry_reason IN ('time_expired','max_reached',
                                                                    'admin_cancelled')
                                                 OR expiry_reason IS NULL),
    redemptions_during_show  INTEGER      NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_voucher_announcements_voucher_id   ON public.voucher_announcements(voucher_id);
CREATE INDEX IF NOT EXISTS idx_voucher_announcements_game_id      ON public.voucher_announcements(game_id);
CREATE INDEX IF NOT EXISTS idx_voucher_announcements_announced_at ON public.voucher_announcements(announced_at);
ALTER TABLE public.voucher_announcements ENABLE ROW LEVEL SECURITY;

-- voucher_redemptions ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.voucher_redemptions (
    id                        UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    voucher_id                UUID          NOT NULL REFERENCES public.vouchers(id),
    user_id                   UUID          NOT NULL REFERENCES public.profiles(id),
    game_id                   UUID          REFERENCES public.games(id),
    announcement_id           UUID          REFERENCES public.voucher_announcements(id),
    attempt_ip                TEXT,
    user_agent                TEXT,
    reward_applied            BOOLEAN       NOT NULL DEFAULT FALSE,
    reward_value_applied_usd  NUMERIC(10,2),
    transaction_id            UUID          REFERENCES public.transactions(id),
    redeemed_at               TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_voucher_redemptions_voucher_id      ON public.voucher_redemptions(voucher_id);
CREATE INDEX IF NOT EXISTS idx_voucher_redemptions_user_id         ON public.voucher_redemptions(user_id);
CREATE INDEX IF NOT EXISTS idx_voucher_redemptions_game_id         ON public.voucher_redemptions(game_id);
CREATE INDEX IF NOT EXISTS idx_voucher_redemptions_announcement_id ON public.voucher_redemptions(announcement_id);
CREATE INDEX IF NOT EXISTS idx_voucher_redemptions_redeemed_at     ON public.voucher_redemptions(redeemed_at);
CREATE INDEX IF NOT EXISTS idx_voucher_redemptions_reward_applied  ON public.voucher_redemptions(reward_applied);
ALTER TABLE public.voucher_redemptions ENABLE ROW LEVEL SECURITY;

-- voucher_attempt_log ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.voucher_attempt_log (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    code_attempted  TEXT         NOT NULL,
    user_id         UUID         REFERENCES public.profiles(id),
    ip_address      TEXT         NOT NULL,
    result          TEXT         NOT NULL
                                 CHECK (result IN ('success','not_found','expired','exhausted',
                                                   'already_redeemed','per_user_limit_reached',
                                                   'not_eligible','rate_limited','invalid_user',
                                                   'kyc_required','country_restricted')),
    attempted_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_voucher_attempt_log_code_attempted ON public.voucher_attempt_log(code_attempted);
CREATE INDEX IF NOT EXISTS idx_voucher_attempt_log_user_id        ON public.voucher_attempt_log(user_id);
CREATE INDEX IF NOT EXISTS idx_voucher_attempt_log_ip_address     ON public.voucher_attempt_log(ip_address);
CREATE INDEX IF NOT EXISTS idx_voucher_attempt_log_result         ON public.voucher_attempt_log(result);
CREATE INDEX IF NOT EXISTS idx_voucher_attempt_log_attempted_at   ON public.voucher_attempt_log(attempted_at);
ALTER TABLE public.voucher_attempt_log ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- 7. COMMUNICATIONS
-- =============================================================================

-- notification_broadcasts -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notification_broadcasts (
    id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    title             TEXT         NOT NULL,
    body              TEXT         NOT NULL,
    type              TEXT         NOT NULL CHECK (type IN ('system','promotion')),
    segment           JSONB        NOT NULL DEFAULT '{}'::jsonb,
    data              JSONB,
    scheduled_at      TIMESTAMPTZ,
    sent_at           TIMESTAMPTZ,
    recipients_count  INTEGER      NOT NULL DEFAULT 0,
    delivered_count   INTEGER      NOT NULL DEFAULT 0,
    failed_count      INTEGER      NOT NULL DEFAULT 0,
    sent_by           UUID         NOT NULL REFERENCES public.admin_users(id),
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notification_broadcasts_type         ON public.notification_broadcasts(type);
CREATE INDEX IF NOT EXISTS idx_notification_broadcasts_scheduled_at ON public.notification_broadcasts(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_notification_broadcasts_sent_at      ON public.notification_broadcasts(sent_at);
CREATE INDEX IF NOT EXISTS idx_notification_broadcasts_sent_by      ON public.notification_broadcasts(sent_by);
ALTER TABLE public.notification_broadcasts ENABLE ROW LEVEL SECURITY;

-- notifications ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notifications (
    id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        UUID         NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    type           TEXT         NOT NULL
                                CHECK (type IN ('prize','game_invite','show_reminder','kyc_update',
                                                'withdrawal','system','promotion')),
    title          TEXT         NOT NULL,
    body           TEXT         NOT NULL,
    read           BOOLEAN      NOT NULL DEFAULT FALSE,
    data           JSONB,
    sent_via_push  BOOLEAN      NOT NULL DEFAULT FALSE,
    broadcast_id   UUID         REFERENCES public.notification_broadcasts(id),
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id      ON public.notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_type         ON public.notifications(type);
CREATE INDEX IF NOT EXISTS idx_notifications_read         ON public.notifications(read);
CREATE INDEX IF NOT EXISTS idx_notifications_broadcast_id ON public.notifications(broadcast_id);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at   ON public.notifications(created_at);
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- support_tickets -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.support_tickets (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID         NOT NULL REFERENCES public.profiles(id),
    ticket_number   TEXT         NOT NULL UNIQUE,
    category        TEXT         NOT NULL
                                 CHECK (category IN ('payment','kyc','game','account','other')),
    subject         TEXT         NOT NULL,
    description     TEXT         NOT NULL,
    transaction_id  UUID         REFERENCES public.transactions(id),
    assigned_to     UUID         REFERENCES public.admin_users(id),
    status          TEXT         NOT NULL DEFAULT 'open'
                                 CHECK (status IN ('open','in_progress','resolved','closed')),
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_support_tickets_user_id       ON public.support_tickets(user_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_ticket_number ON public.support_tickets(ticket_number);
CREATE INDEX IF NOT EXISTS idx_support_tickets_category      ON public.support_tickets(category);
CREATE INDEX IF NOT EXISTS idx_support_tickets_assigned_to   ON public.support_tickets(assigned_to);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status        ON public.support_tickets(status);
CREATE INDEX IF NOT EXISTS idx_support_tickets_created_at    ON public.support_tickets(created_at);
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;

-- support_ticket_messages -----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.support_ticket_messages (
    id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id    UUID         NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
    sender_type  TEXT         NOT NULL CHECK (sender_type IN ('user','admin')),
    sender_id    UUID         NOT NULL,
    content      TEXT         NOT NULL,
    attachments  JSONB,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_support_ticket_messages_ticket_id   ON public.support_ticket_messages(ticket_id);
CREATE INDEX IF NOT EXISTS idx_support_ticket_messages_sender_type ON public.support_ticket_messages(sender_type);
CREATE INDEX IF NOT EXISTS idx_support_ticket_messages_sender_id   ON public.support_ticket_messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_support_ticket_messages_created_at  ON public.support_ticket_messages(created_at);
ALTER TABLE public.support_ticket_messages ENABLE ROW LEVEL SECURITY;


-- =============================================================================
-- 8. CONTENT & CONFIG
-- =============================================================================

-- app_config ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.app_config (
    key         TEXT         PRIMARY KEY,
    value       TEXT         NOT NULL,
    value_type  TEXT         NOT NULL DEFAULT 'string'
                             CHECK (value_type IN ('string','number','boolean','json')),
    updated_by  UUID         REFERENCES public.admin_users(id),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;

-- help_articles ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.help_articles (
    id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    title         TEXT         NOT NULL,
    content       TEXT         NOT NULL,
    category      TEXT         NOT NULL
                               CHECK (category IN ('payments','kyc','games','account','general')),
    language      TEXT         NOT NULL DEFAULT 'en'
                               CHECK (language IN ('en','ar','fa','tr')),
    is_published  BOOLEAN      NOT NULL DEFAULT FALSE,
    created_by    UUID         NOT NULL REFERENCES public.admin_users(id),
    updated_by    UUID         REFERENCES public.admin_users(id),
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_help_articles_category     ON public.help_articles(category);
CREATE INDEX IF NOT EXISTS idx_help_articles_language     ON public.help_articles(language);
CREATE INDEX IF NOT EXISTS idx_help_articles_is_published ON public.help_articles(is_published);
ALTER TABLE public.help_articles ENABLE ROW LEVEL SECURITY;

-- tos_versions ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tos_versions (
    version                TEXT         NOT NULL,
    type                   TEXT         NOT NULL CHECK (type IN ('tos','privacy')),
    content_en             TEXT         NOT NULL,
    content_ar             TEXT,
    content_fa             TEXT,
    content_tr             TEXT,
    effective_date         DATE         NOT NULL,
    require_re_acceptance  BOOLEAN      NOT NULL DEFAULT FALSE,
    published_by           UUID         NOT NULL REFERENCES public.admin_users(id),
    created_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    PRIMARY KEY (version, type)
);
ALTER TABLE public.tos_versions ENABLE ROW LEVEL SECURITY;

-- tos_acceptances -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tos_acceptances (
    id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID         NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    tos_version  TEXT         NOT NULL,
    accepted_at  TIMESTAMPTZ  NOT NULL,
    UNIQUE (user_id, tos_version)
);
CREATE INDEX IF NOT EXISTS idx_tos_acceptances_user_id ON public.tos_acceptances(user_id);
ALTER TABLE public.tos_acceptances ENABLE ROW LEVEL SECURITY;

COMMIT;

-- =============================================================================
-- END OF INITIAL SCHEMA
-- =============================================================================
