-- Migration: feature_host_applications
-- Adds the feature_host_applications config key to app_config.
-- When false, POST /host/apply (and the onboarding avatar-temp upload) returns
-- 403 feature_disabled so the admin can open/close host recruitment from the
-- admin panel Config page without a code deploy.

INSERT INTO public.app_config (key, value, value_type)
VALUES ('feature_host_applications', 'true', 'boolean')
ON CONFLICT (key) DO NOTHING;
