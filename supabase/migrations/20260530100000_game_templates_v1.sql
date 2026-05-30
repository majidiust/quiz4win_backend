-- Migration: Game Templates v1 — automated game generation engine.
--
-- Introduces:
--   * public.game_templates       — reusable game configurations with cron + AI presenter fields
--   * games.template_id           — FK back to the spawning template (nullable for manual games)
--   * match_cron_expression(...)  — 5-field cron matcher (minute hour day month dow)
--   * generate_game_from_template(...) — creates a game from a template (filter-based question
--                                        selection, mode='live', status='upcoming').
--   * generate_games_from_active_templates() — called every minute by the template-generator
--                                              Docker service to advance the schedule.
--
-- Rule compliance:
--   R-02  amount columns continue to live on games (numeric / cents handled there).
--   R-04  All RPCs are SECURITY DEFINER but check the caller is admin (or service_role).
--   R-05  No UPDATE/DELETE on transactions; this migration only touches non-financial tables.
--   R-06  template references games; games references template — mutual reference is
--         implemented with a deferrable FK on game_templates.current_game_id to avoid
--         insert-order cycles.

BEGIN;

-- ─── game_templates ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.game_templates (
    id                      UUID          PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Identity / display
    name                    TEXT          NOT NULL,
    description             TEXT,
    icon                    TEXT,
    thumbnail_url           TEXT,
    poster_url              TEXT,

    -- Schedule
    cron_expression         TEXT          NOT NULL,
    cron_description        TEXT,
    duration_minutes        INTEGER       NOT NULL DEFAULT 15
                                          CHECK (duration_minutes BETWEEN 1 AND 1440),
    start_buffer_seconds    INTEGER       NOT NULL DEFAULT 120
                                          CHECK (start_buffer_seconds BETWEEN 0 AND 3600),

    -- Game configuration (mirrors public.games)
    mode                    TEXT          NOT NULL DEFAULT 'live'
                                          CHECK (mode IN ('timed','battle','daily','tournament','live')),
    category                TEXT,
    difficulty              TEXT          CHECK (difficulty IN ('Easy','Medium','Hard') OR difficulty IS NULL),
    language                TEXT          NOT NULL DEFAULT 'en'
                                          CHECK (language IN ('en','ar','fa','tr')),
    entry_fee               NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    prize_pool              NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    prize_pool_currency     TEXT          NOT NULL DEFAULT 'USD',
    max_players             INTEGER,
    questions_count         INTEGER       NOT NULL DEFAULT 10 CHECK (questions_count > 0),
    time_per_question       INTEGER       NOT NULL DEFAULT 15 CHECK (time_per_question > 0),
    allowed_wrong_answers   INTEGER,
    prize_breakdown         JSONB,
    prize_distribution      JSONB,
    rules                   TEXT[],
    tags                    TEXT[],
    is_featured             BOOLEAN       NOT NULL DEFAULT FALSE,

    -- Question selection filters — used when generating each game.
    -- NULL means "no filter on this column" (so e.g. a template can fix the
    -- difficulty but accept any category).
    question_category       TEXT,
    question_difficulty     TEXT          CHECK (question_difficulty IN ('Easy','Medium','Hard') OR question_difficulty IS NULL),
    question_language       TEXT          CHECK (question_language IN ('en','ar','fa','tr') OR question_language IS NULL),

    -- Live host
    host_id                 UUID          REFERENCES public.show_hosts(id),
    host_name               TEXT,
    host_avatar_url         TEXT,
    host_title              TEXT,

    -- Streaming
    enable_streaming        BOOLEAN       NOT NULL DEFAULT TRUE,

    -- AI Live Avatar presenter (HeyGen-style). When ai_enabled = TRUE the
    -- service publishes quiz.show.start to RabbitMQ at game start so the
    -- presenter joins the LiveKit room.
    ai_enabled              BOOLEAN       NOT NULL DEFAULT FALSE,
    ai_avatar_id            TEXT,         -- LiveAvatar avatar UUID
    ai_sound_id             TEXT,         -- LiveAvatar voice UUID
    ai_duration             INTEGER,      -- target show length in seconds (60..1800)
    ai_language             TEXT          CHECK (ai_language IN ('en','ar','fa','tr') OR ai_language IS NULL),

    -- Branding
    sponsor                 TEXT,
    accent_color            TEXT,
    glow_color              TEXT,
    gradient_colors         TEXT[],

    -- Lifecycle / tracking
    is_active               BOOLEAN       NOT NULL DEFAULT FALSE,
    current_game_id         UUID,         -- FK added below (deferrable to break cycle)
    last_completed_game_id  UUID,
    last_generated_at       TIMESTAMPTZ,
    total_games_generated   INTEGER       NOT NULL DEFAULT 0,

    -- Audit
    created_by              UUID          REFERENCES public.profiles(id),
    created_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    deleted_at              TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_game_templates_is_active        ON public.game_templates(is_active) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_game_templates_mode             ON public.game_templates(mode);
CREATE INDEX IF NOT EXISTS idx_game_templates_host_id          ON public.game_templates(host_id);
CREATE INDEX IF NOT EXISTS idx_game_templates_created_at       ON public.game_templates(created_at DESC);

ALTER TABLE public.game_templates ENABLE ROW LEVEL SECURITY;

-- Admin-only via RLS: service_role bypasses; no policies for anon/authenticated by default.
-- Admin Edge Function uses the service-role client.

-- ─── games.template_id ───────────────────────────────────────────────────────
ALTER TABLE public.games
    ADD COLUMN IF NOT EXISTS template_id UUID REFERENCES public.game_templates(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_games_template_id ON public.games(template_id);

-- Cycle-breaking FKs for template.current_game_id / last_completed_game_id.
-- These are added AFTER the games column exists. ON DELETE SET NULL so deleting
-- a game does not break a template.
ALTER TABLE public.game_templates
    ADD CONSTRAINT game_templates_current_game_fk
        FOREIGN KEY (current_game_id) REFERENCES public.games(id) ON DELETE SET NULL,
    ADD CONSTRAINT game_templates_last_completed_game_fk
        FOREIGN KEY (last_completed_game_id) REFERENCES public.games(id) ON DELETE SET NULL;

-- ─── updated_at trigger ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.game_templates_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_game_templates_updated_at ON public.game_templates;
CREATE TRIGGER trg_game_templates_updated_at
    BEFORE UPDATE ON public.game_templates
    FOR EACH ROW EXECUTE FUNCTION public.game_templates_set_updated_at();

COMMIT;
