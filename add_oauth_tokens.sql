-- ============================================================
-- TICKK: Add OAuth token columns to profiles table
-- Run this script in Supabase Dashboard -> SQL Editor
-- ============================================================

-- Add Google OAuth columns
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS google_access_token TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS google_refresh_token TEXT;

-- Add Outlook OAuth columns
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS outlook_access_token TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS outlook_refresh_token TEXT;

-- Add generic auth_provider tracking
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS auth_provider TEXT DEFAULT 'none';

-- Security: Ensure these new columns can be updated by the service role
GRANT ALL ON public.profiles TO service_role;
GRANT ALL ON public.profiles TO postgres;
GRANT ALL ON public.profiles TO authenticated;

-- Note: Because access tokens are sensitive, consider enabling Column Level Security (CLS) 
-- or wrapping them in a secure RPC later if they shouldn't be read by authenticated users themselves.
