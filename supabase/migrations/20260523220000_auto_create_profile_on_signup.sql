-- =============================================================================
-- Auto-create public.profiles row on auth.users insert
-- =============================================================================
-- When a user signs up via supabase.auth.signUp(), Supabase only creates a row
-- in auth.users. The admin panel and all business logic read from
-- public.profiles, which left newly-signed-up users invisible.
--
-- This migration installs a trigger that mirrors every new auth.users row into
-- public.profiles (id = auth.users.id, email = auth.users.email, full_name and
-- referral_code pulled from raw_user_meta_data set by the signup function).
--
-- Also backfills any existing auth.users that have no matching profile.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.profiles (id, email, full_name, referral_code, email_verified)
    VALUES (
        NEW.id,
        NEW.email,
        NULLIF(NEW.raw_user_meta_data->>'full_name', ''),
        NULLIF(NEW.raw_user_meta_data->>'referral_code', ''),
        NEW.email_confirmed_at IS NOT NULL
    )
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_auth_user();

-- Backfill: insert profiles for any existing auth.users without one
INSERT INTO public.profiles (id, email, full_name, referral_code, email_verified)
SELECT
    u.id,
    u.email,
    NULLIF(u.raw_user_meta_data->>'full_name', ''),
    NULLIF(u.raw_user_meta_data->>'referral_code', ''),
    u.email_confirmed_at IS NOT NULL
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE p.id IS NULL
  AND u.email IS NOT NULL
ON CONFLICT (id) DO NOTHING;
