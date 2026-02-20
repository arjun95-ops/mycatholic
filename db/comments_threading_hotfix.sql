-- Comments Threading Hotfix
-- Date: 2026-02-19
-- Purpose:
-- 1) Enable comment-reply threading with parent_id.
-- 2) Enforce safe self-reference constraints for nested comments.
-- 3) Improve query performance for threaded comment reads.

DO $$
BEGIN
  IF to_regclass('public.comments') IS NULL THEN
    RAISE NOTICE 'public.comments not found, skipping comments_threading_hotfix';
    RETURN;
  END IF;

  ALTER TABLE public.comments
    ADD COLUMN IF NOT EXISTS parent_id uuid;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.comments'::regclass
      AND conname = 'comments_parent_id_fkey'
  ) THEN
    ALTER TABLE public.comments
      ADD CONSTRAINT comments_parent_id_fkey
      FOREIGN KEY (parent_id)
      REFERENCES public.comments(id)
      ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.comments'::regclass
      AND conname = 'comments_no_self_parent'
  ) THEN
    ALTER TABLE public.comments
      ADD CONSTRAINT comments_no_self_parent
      CHECK (parent_id IS NULL OR parent_id <> id);
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_comments_parent_id
  ON public.comments(parent_id);

CREATE INDEX IF NOT EXISTS idx_comments_post_parent_created_at
  ON public.comments(post_id, parent_id, created_at);

-- Refresh PostgREST schema cache.
DO $$
BEGIN
  PERFORM pg_notify('pgrst', 'reload schema');
EXCEPTION
  WHEN OTHERS THEN
    NULL;
END;
$$;
