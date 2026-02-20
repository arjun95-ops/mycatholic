-- Comments Likes Hotfix
-- Date: 2026-02-19
-- Purpose:
-- 1) Add canonical table for comment likes.
-- 2) Enforce one-like-per-user-per-comment.
-- 3) Enable RLS policies for authenticated users.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
DECLARE
  has_comments_post_id boolean;
BEGIN
  IF to_regclass('public.comments') IS NULL THEN
    RAISE NOTICE 'public.comments not found, skipping comments_likes_hotfix';
    RETURN;
  END IF;

  CREATE TABLE IF NOT EXISTS public.comment_likes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL,
    comment_id uuid NOT NULL,
    post_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  );

  -- Existing deployments may already have comment_likes without post_id.
  ALTER TABLE public.comment_likes
    ADD COLUMN IF NOT EXISTS post_id uuid;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'comments'
      AND column_name = 'post_id'
  ) INTO has_comments_post_id;

  IF has_comments_post_id THEN
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

    -- Fill missing post_id on existing comment_likes rows.
    UPDATE public.comment_likes cl
    SET post_id = c.post_id
    FROM public.comments c
    WHERE c.id = cl.comment_id
      AND cl.post_id IS NULL;
  END IF;

  -- Legacy unique name from earlier schema attempts.
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.comment_likes'::regclass
      AND conname = 'comment_likes_comment_id_user_id_key'
  ) THEN
    ALTER TABLE public.comment_likes
      DROP CONSTRAINT comment_likes_comment_id_user_id_key;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.comment_likes'::regclass
      AND contype = 'u'
      AND (
        pg_get_constraintdef(oid) ILIKE '%UNIQUE (user_id, comment_id)%'
        OR pg_get_constraintdef(oid) ILIKE '%UNIQUE (comment_id, user_id)%'
      )
  ) THEN
    ALTER TABLE public.comment_likes
      ADD CONSTRAINT comment_likes_user_comment_unique
      UNIQUE (user_id, comment_id);
  END IF;

  -- Legacy default user fk name from previous attempts.
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.comment_likes'::regclass
      AND conname = 'comment_likes_user_id_fkey'
  ) THEN
    ALTER TABLE public.comment_likes
      DROP CONSTRAINT comment_likes_user_id_fkey;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.comment_likes'::regclass
      AND conname = 'comment_likes_user_fk'
  ) THEN
    ALTER TABLE public.comment_likes
      ADD CONSTRAINT comment_likes_user_fk
      FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.comment_likes'::regclass
      AND conname = 'comment_likes_comment_fk'
  ) THEN
    ALTER TABLE public.comment_likes
      DROP CONSTRAINT comment_likes_comment_fk;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.comment_likes'::regclass
      AND conname = 'comment_likes_comment_id_fk'
  ) THEN
    ALTER TABLE public.comment_likes
      DROP CONSTRAINT comment_likes_comment_id_fk;
  END IF;

  -- Legacy default name from earlier schema attempts.
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.comment_likes'::regclass
      AND conname = 'comment_likes_comment_id_fkey'
  ) THEN
    ALTER TABLE public.comment_likes
      DROP CONSTRAINT comment_likes_comment_id_fkey;
  END IF;

  IF has_comments_post_id THEN
    ALTER TABLE public.comment_likes
      ADD CONSTRAINT comment_likes_comment_fk
      FOREIGN KEY (comment_id, post_id)
      REFERENCES public.comments(id, post_id)
      ON DELETE CASCADE;
  ELSE
    ALTER TABLE public.comment_likes
      ADD CONSTRAINT comment_likes_comment_id_fk
      FOREIGN KEY (comment_id)
      REFERENCES public.comments(id)
      ON DELETE CASCADE;
  END IF;

  ALTER TABLE public.comment_likes ENABLE ROW LEVEL SECURITY;
  GRANT SELECT, INSERT, DELETE ON TABLE public.comment_likes TO authenticated;

  DROP POLICY IF EXISTS comment_likes_auth_select ON public.comment_likes;
  CREATE POLICY comment_likes_auth_select
  ON public.comment_likes
  FOR SELECT
  TO authenticated
  USING (true);

  DROP POLICY IF EXISTS comment_likes_auth_insert_self ON public.comment_likes;
  IF has_comments_post_id THEN
    CREATE POLICY comment_likes_auth_insert_self
    ON public.comment_likes
    FOR INSERT
    TO authenticated
    WITH CHECK (
      user_id = auth.uid()
      AND post_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.comments c
        WHERE c.id = comment_id
          AND c.post_id = post_id
      )
    );
  ELSE
    CREATE POLICY comment_likes_auth_insert_self
    ON public.comment_likes
    FOR INSERT
    TO authenticated
    WITH CHECK (
      user_id = auth.uid()
      AND EXISTS (
        SELECT 1
        FROM public.comments c
        WHERE c.id = comment_id
      )
    );
  END IF;

  DROP POLICY IF EXISTS comment_likes_auth_delete_self ON public.comment_likes;
  CREATE POLICY comment_likes_auth_delete_self
  ON public.comment_likes
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());
END;
$$;

CREATE INDEX IF NOT EXISTS idx_comment_likes_comment_id
  ON public.comment_likes(comment_id);

CREATE INDEX IF NOT EXISTS idx_comment_likes_user_id
  ON public.comment_likes(user_id);

CREATE INDEX IF NOT EXISTS idx_comment_likes_post_id
  ON public.comment_likes(post_id);

-- Refresh PostgREST schema cache.
DO $$
BEGIN
  PERFORM pg_notify('pgrst', 'reload schema');
EXCEPTION
  WHEN OTHERS THEN
    NULL;
END;
$$;
