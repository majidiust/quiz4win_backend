-- Migration: ar_backgrounds
-- Stores admin-managed background images for the host AR streaming feature.
-- Applied by db-maintainer (R-12). Never run manually.

CREATE TABLE IF NOT EXISTS public.ar_backgrounds (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT        NOT NULL,
  url         TEXT        NOT NULL,          -- public S3 URL
  s3_key      TEXT        NOT NULL,          -- S3 object key for deletion
  is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
  sort_order  INT         NOT NULL DEFAULT 0,
  uploaded_by UUID        REFERENCES public.admin_users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.ar_backgrounds ENABLE ROW LEVEL SECURITY;

-- Admins (service_role client used by Edge Functions) bypass RLS.
-- Allow authenticated admin panel users to read all rows.
CREATE POLICY "admin_all" ON public.ar_backgrounds
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Hosts and public endpoints read only active backgrounds.
-- (Host Edge Functions use the admin client which bypasses RLS,
--  but this policy ensures correctness if accessed via anon/auth key.)
CREATE POLICY "anon_read_active" ON public.ar_backgrounds
  FOR SELECT
  TO anon
  USING (is_active = true);

-- Record this migration in the schema_migrations tracker.
INSERT INTO public.schema_migrations (version) VALUES ('20260625120000')
  ON CONFLICT DO NOTHING;
