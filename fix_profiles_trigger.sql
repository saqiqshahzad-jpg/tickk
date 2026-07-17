-- ============================================================
-- TICKK: Fix profiles table trigger for new user sign-ups
-- Run this ENTIRE script in Supabase Dashboard → SQL Editor
-- ============================================================

-- ─── STEP 1: Create/Replace the trigger function ────────────
-- SECURITY DEFINER = runs with owner (postgres) permissions
-- This bypasses any RLS or permission issues
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, plan, credits, created_at)
  VALUES (
    NEW.id,
    NEW.email,
    'free',          -- default free tier
    301,             -- beta starter credits
    NOW()
  );
  RETURN NEW;
END;
$$;


-- ─── STEP 2: Attach trigger to auth.users ───────────────────
-- Drop first to avoid "already exists" error
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();


-- ─── STEP 3: Fix permissions ────────────────────────────────
GRANT ALL ON public.profiles TO service_role;
GRANT ALL ON public.profiles TO postgres;
GRANT ALL ON public.profiles TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;
GRANT USAGE ON SCHEMA public TO authenticated;


-- ─── STEP 4: Backfill existing users who have no profile ────
-- (Safe: ON CONFLICT DO NOTHING prevents duplicates)
INSERT INTO public.profiles (id, email, plan, credits, created_at)
SELECT id, email, 'free', 301, created_at
FROM auth.users
WHERE id NOT IN (SELECT id FROM public.profiles)
ON CONFLICT (id) DO NOTHING;


-- ─── STEP 5: Verify everything is set up correctly ──────────
-- Check function exists
SELECT routine_name, routine_type
FROM information_schema.routines
WHERE routine_name = 'handle_new_user' AND routine_schema = 'public';

-- Check trigger exists
SELECT trigger_name, event_manipulation, action_statement
FROM information_schema.triggers
WHERE trigger_name = 'on_auth_user_created';

-- Check profiles data
SELECT id, email, plan, credits FROM public.profiles LIMIT 10;
