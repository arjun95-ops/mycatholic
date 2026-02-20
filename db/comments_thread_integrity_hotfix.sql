-- Comments Thread Integrity Hotfix
-- Date: 2026-02-19
-- Purpose:
-- 1) Enforce parent reply relation inside the same post.
-- 2) Clean invalid legacy parent references safely.
-- 3) Keep migration idempotent.

DO $$
BEGIN
  IF to_regclass('public.comments') IS NULL THEN
    RAISE NOTICE 'public.comments not found, skipping comments_thread_integrity_hotfix';
    RETURN;
  END IF;

  -- Ensure parent_id exists even if older environments missed threading migration.
  ALTER TABLE public.comments
    ADD COLUMN IF NOT EXISTS parent_id uuid;

  -- Normalize invalid legacy parent references before adding stricter constraints.
  UPDATE public.comments c
  SET parent_id = NULL
  WHERE c.parent_id IS NOT NULL
    AND (
      c.parent_id = c.id
      OR NOT EXISTS (
        SELECT 1
        FROM public.comments p
        WHERE p.id = c.parent_id
      )
      OR EXISTS (
        SELECT 1
        FROM public.comments p
        WHERE p.id = c.parent_id
          AND p.post_id IS DISTINCT FROM c.post_id
      )
    );

  -- Support composite foreign key target for (id, post_id).
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.comments'::regclass
      AND conname = 'comments_id_post_id_unique'
  ) THEN
    ALTER TABLE public.comments
      ADD CONSTRAINT comments_id_post_id_unique
      UNIQUE (id, post_id);
  END IF;

  -- Replace old parent-only FK with same-post FK.
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.comments'::regclass
      AND conname = 'comments_parent_id_fkey'
  ) THEN
    ALTER TABLE public.comments
      DROP CONSTRAINT comments_parent_id_fkey;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.comments'::regclass
      AND conname = 'comments_parent_same_post_fkey'
  ) THEN
    ALTER TABLE public.comments
      ADD CONSTRAINT comments_parent_same_post_fkey
      FOREIGN KEY (parent_id, post_id)
      REFERENCES public.comments(id, post_id)
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
