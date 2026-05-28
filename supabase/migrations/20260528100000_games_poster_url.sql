-- Add `poster_url` to public.games for the large promotional poster image.
-- Stored as a public S3 URL (uploaded via POST /admin/games/:id/asset with
-- field="poster_url"). Nullable: legacy games may not have a poster yet.

ALTER TABLE public.games
    ADD COLUMN IF NOT EXISTS poster_url TEXT;
