-- Migration: add 'loser' to app_sounds usage check constraint
-- Drops and recreates the check constraint to include the new 'loser' slot.

ALTER TABLE public.app_sounds
  DROP CONSTRAINT app_sounds_usage_check;

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
      'loser',
      'announcement',
      'livestream'
    )
  );

COMMENT ON COLUMN public.app_sounds.usage IS
  'Placement identifier: splash | home | home_before_start | register | '
  'game_details | correct_answer | incorrect_answer | countdown | '
  'pregame_music | winner | loser | announcement | livestream';
