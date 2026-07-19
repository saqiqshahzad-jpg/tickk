-- ============================================================
-- TICKK: Create tickets table for backend feedback endpoint
-- Run this ENTIRE script in Supabase Dashboard → SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS public.tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    subject TEXT NOT NULL,
    category TEXT NOT NULL,
    message TEXT NOT NULL,
    status TEXT DEFAULT 'submitted' CHECK (status IN ('submitted', 'approved', 'resolved')),
    reward_claimed BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Fix permissions (optional if using service_role, but   good for completeness)
GRANT ALL ON public.tickets TO service_role;
GRANT ALL ON public.tickets TO postgres;
GRANT ALL ON public.tickets TO authenticated;

-- Enable RLS (Service role will still bypass it)
ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;
