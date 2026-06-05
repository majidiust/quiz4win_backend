-- Migration: LLM Prompt Templates — editable question-generation config.
--
-- Introduces a small store for the OpenAI prompt/model used by the game
-- orchestrator's question generator, resolved as a 3-tier cascade:
--
--   games.llm_template_id            (per-game override, highest priority)
--     └─ game_templates.llm_template_id   (template override)
--          └─ llm_prompt_templates.is_active = TRUE   (global default)
--               └─ hardcoded prompt + OPENAI_MODEL     (orchestrator safety net)
--
-- Notes:
--   * Provider is OpenAI-only for now; no API key is ever stored here (R-01) —
--     the orchestrator continues to read OPENAI_API_KEY from the environment.
--   * Exactly one row may be is_active = TRUE (enforced by a partial unique idx).
--   * R-12: applied by the db-maintainer container only.

BEGIN;

CREATE TABLE IF NOT EXISTS public.llm_prompt_templates (
    id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT          NOT NULL,
    description     TEXT,
    provider        TEXT          NOT NULL DEFAULT 'openai'
                                  CHECK (provider IN ('openai')),
    model           TEXT          NOT NULL DEFAULT 'gpt-4o-mini',
    system_prompt   TEXT          NOT NULL,
    temperature     NUMERIC(3,2)  NOT NULL DEFAULT 0.80
                                  CHECK (temperature BETWEEN 0 AND 2),
    max_tokens      INTEGER       NOT NULL DEFAULT 1500
                                  CHECK (max_tokens BETWEEN 256 AND 8192),
    is_active       BOOLEAN       NOT NULL DEFAULT FALSE,
    created_by      UUID          REFERENCES public.profiles(id),
    updated_by      UUID          REFERENCES public.profiles(id),
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ
);

-- Only one active default at a time (ignoring soft-deleted rows).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_llm_prompt_templates_active
    ON public.llm_prompt_templates(is_active)
    WHERE is_active = TRUE AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_llm_prompt_templates_created_at
    ON public.llm_prompt_templates(created_at DESC);

ALTER TABLE public.llm_prompt_templates ENABLE ROW LEVEL SECURITY;
-- Admin-only via the service-role client; no anon/authenticated policies.

-- ─── updated_at trigger ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.llm_prompt_templates_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_llm_prompt_templates_updated_at ON public.llm_prompt_templates;
CREATE TRIGGER trg_llm_prompt_templates_updated_at
    BEFORE UPDATE ON public.llm_prompt_templates
    FOR EACH ROW EXECUTE FUNCTION public.llm_prompt_templates_set_updated_at();

-- ─── override FKs on game_templates / games ─────────────────────────────────
ALTER TABLE public.game_templates
    ADD COLUMN IF NOT EXISTS llm_template_id UUID
        REFERENCES public.llm_prompt_templates(id) ON DELETE SET NULL;

ALTER TABLE public.games
    ADD COLUMN IF NOT EXISTS llm_template_id UUID
        REFERENCES public.llm_prompt_templates(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_game_templates_llm_template_id ON public.game_templates(llm_template_id);
CREATE INDEX IF NOT EXISTS idx_games_llm_template_id          ON public.games(llm_template_id);

-- ─── set_active_llm_template ─────────────────────────────────────────────────
-- Atomically promotes one row to the single active default.
CREATE OR REPLACE FUNCTION public.set_active_llm_template(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.llm_prompt_templates
                    WHERE id = p_id AND deleted_at IS NULL) THEN
        RAISE EXCEPTION 'llm_template_not_found' USING ERRCODE = 'P0002';
    END IF;
    UPDATE public.llm_prompt_templates SET is_active = FALSE
     WHERE is_active = TRUE AND id <> p_id;
    UPDATE public.llm_prompt_templates SET is_active = TRUE
     WHERE id = p_id;
END;
$$;

REVOKE ALL ON FUNCTION public.set_active_llm_template(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_active_llm_template(UUID) TO service_role;

-- ─── seed the global default from the orchestrator's hardcoded guidance ──────
INSERT INTO public.llm_prompt_templates (name, description, model, system_prompt, temperature, max_tokens, is_active)
SELECT 'Default OpenAI generator',
       'Built-in default mirroring the orchestrator''s hardcoded question-generation guidance.',
       'gpt-4o-mini',
       'You are a multilingual quiz question generator acting as a live game-show host. '
       || 'Honour the category, description and difficulty in the user message exactly. '
       || 'Produce ONE question with FOUR options (A, B, C, D) and EXACTLY ONE unambiguously '
       || 'correct answer that is verifiably true; the other three must be clearly wrong. '
       || 'Write canonicalText and its options in baseLanguage and provide one localizedPayloads '
       || 'entry per targetLanguages code. The question MUST be original and clearly different '
       || 'from every entry in the avoid list. Avoid political/hate/sexual/religious/illegal/'
       || 'ambiguous content. Never use the game title as the subject.',
       0.80, 1500, TRUE
WHERE NOT EXISTS (
    SELECT 1 FROM public.llm_prompt_templates WHERE deleted_at IS NULL
);

COMMIT;
