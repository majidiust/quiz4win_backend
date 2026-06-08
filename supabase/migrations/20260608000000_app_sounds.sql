-- Migration: app_sounds
-- Stores in-app sound assets uploaded by admins and served to the mobile app.
-- Each sound has a designated usage slot (splash, home, correct_answer, etc.)
-- and is hosted on the same S3 bucket as other platform assets.

CREATE TABLE public.app_sounds (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT        NOT NULL,
  usage            TEXT        NOT NULL,
  url              TEXT        NOT NULL,
  s3_key           TEXT        NOT NULL,
  mime_type        TEXT        NOT NULL DEFAULT 'audio/mpeg',
  file_size_bytes  BIGINT,
  duration_seconds NUMERIC(6,2),
  is_active        BOOLEAN     NOT NULL DEFAULT true,
  uploaded_by      UUID        REFERENCES public.admin_users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Valid placement / usage identifiers
ALTER TABLE public.app_sounds
  ADD CONSTRAINT app_sounds_usage_check CHECK (
    usage IN (
      'splash',
      'home',
      'home_before_start',
      'register',
      'game_details',
      'correct_answer',
      'incorrect_answer',
      'countdown',
      'pregame_music',
      'winner',
      'announcement',
      'livestream'
    )
  );

-- Index for common filter patterns
CREATE INDEX idx_app_sounds_usage    ON public.app_sounds(usage);
CREATE INDEX idx_app_sounds_active   ON public.app_sounds(is_active);

-- Enable RLS
ALTER TABLE public.app_sounds ENABLE ROW LEVEL SECURITY;

-- Anon and authenticated users can read active sounds (mobile app consumption)
CREATE POLICY "sounds_select_active_anon"
  ON public.app_sounds FOR SELECT TO anon
  USING (is_active = true);

CREATE POLICY "sounds_select_active_authenticated"
  ON public.app_sounds FOR SELECT TO authenticated
  USING (is_active = true);

-- Only the service role (admin panel server actions) may write
-- No additional service_role policy needed — it bypasses RLS by design.

COMMENT ON TABLE public.app_sounds IS
  'In-app sound assets managed via the admin panel. '
  'Usage column determines where in the mobile app each sound plays.';

COMMENT ON COLUMN public.app_sounds.usage IS
  'Placement identifier: splash | home | home_before_start | register | '
  'game_details | correct_answer | incorrect_answer | countdown | '
  'pregame_music | winner | announcement | livestream';
