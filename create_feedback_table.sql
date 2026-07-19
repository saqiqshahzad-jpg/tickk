-- ============================================================
-- TICKK: Create feedback table for beta program
-- Run this ENTIRE script in Supabase Dashboard → SQL Editor
-- ============================================================

CREATE TABLE public.feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    subject TEXT NOT NULL,
    category TEXT NOT NULL,
    message TEXT NOT NULL,
    status TEXT DEFAULT 'submitted' CHECK (status IN ('submitted', 'approved', 'resolved')),
    reward_claimed BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Fix permissions
GRANT ALL ON public.feedback TO service_role;
GRANT ALL ON public.feedback TO postgres;
GRANT ALL ON public.feedback TO authenticated;
