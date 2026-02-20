-- Comments Image Hotfix
-- Date: 2026-02-19
-- Purpose:
-- 1) Enable image attachment field for comments.
-- 2) Keep migration idempotent.

DO $$
BEGIN
  IF to_regclass('public.comments') IS NULL THEN
    RAISE NOTICE 'public.comments not found, skipping comments_image_hotfix';
    RETURN;
  END IF;

  ALTER TABLE public.comments
    ADD COLUMN IF NOT EXISTS image_url text;
END;
$$;

-- Refresh PostgREST schema cache.
DO $$
BEGIN
  PERFORM pg_notify('pgrst', 'reload schema');
EXCEPTION
  WHEN OTHERS THEN
    NULL;
END;
$$;
