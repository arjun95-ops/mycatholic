-- Comments Policies Canonical Hotfix
-- Date: 2026-02-19
-- Purpose:
-- 1) Remove legacy/duplicate policies on comments + comment_likes.
-- 2) Recreate canonical policy set used by web/mobile feed.
-- 3) Keep migration idempotent and compatible across schema variants.

DO $$
DECLARE
  pol record;
  has_block_function boolean;
BEGIN
  IF to_regclass('public.comments') IS NULL THEN
    RAISE NOTICE 'public.comments not found, skipping comments policy canonicalization';
  ELSE
    SELECT EXISTS (
      SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = 'has_block_relation_with_auth'
    ) INTO has_block_function;

    ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.comments TO authenticated;
    GRANT SELECT ON TABLE public.comments TO anon;

    FOR pol IN
      SELECT policyname
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'comments'
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.comments', pol.policyname);
    END LOOP;

    CREATE POLICY "Public read comments"
    ON public.comments
    FOR SELECT
    TO public
    USING (true);

    CREATE POLICY comments_auth_select
    ON public.comments
    FOR SELECT
    TO authenticated
    USING (true);

    CREATE POLICY comments_auth_insert_self
    ON public.comments
    FOR INSERT
    TO authenticated
    WITH CHECK (user_id = auth.uid());

    CREATE POLICY comments_auth_update_self
    ON public.comments
    FOR UPDATE
    TO authenticated
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

    CREATE POLICY comments_auth_delete_self
    ON public.comments
    FOR DELETE
    TO authenticated
    USING (user_id = auth.uid());

    IF has_block_function THEN
      CREATE POLICY comments_block_restrict_select
      ON public.comments
      AS RESTRICTIVE
      FOR SELECT
      TO authenticated
      USING (
        NOT public.has_block_relation_with_auth(user_id)
        AND EXISTS (
          SELECT 1
          FROM public.posts p
          WHERE p.id = post_id
            AND NOT public.has_block_relation_with_auth(p.user_id)
        )
      );

      CREATE POLICY comments_block_restrict_insert
      ON public.comments
      AS RESTRICTIVE
      FOR INSERT
      TO authenticated
      WITH CHECK (
        user_id = auth.uid()
        AND EXISTS (
          SELECT 1
          FROM public.posts p
          WHERE p.id = post_id
            AND NOT public.has_block_relation_with_auth(p.user_id)
        )
      );
    ELSE
      -- Fallback when block function is unavailable: keep restrictive guards minimal.
      CREATE POLICY comments_block_restrict_select
      ON public.comments
      AS RESTRICTIVE
      FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1
          FROM public.posts p
          WHERE p.id = post_id
        )
      );

      CREATE POLICY comments_block_restrict_insert
      ON public.comments
      AS RESTRICTIVE
      FOR INSERT
      TO authenticated
      WITH CHECK (
        user_id = auth.uid()
        AND EXISTS (
          SELECT 1
          FROM public.posts p
          WHERE p.id = post_id
        )
      );
    END IF;
  END IF;
END;
$$;

DO $$
DECLARE
  pol record;
  has_comments_post_id boolean;
BEGIN
  IF to_regclass('public.comment_likes') IS NULL THEN
    RAISE NOTICE 'public.comment_likes not found, skipping comment_likes policy canonicalization';
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'comments'
      AND column_name = 'post_id'
  ) INTO has_comments_post_id;

  ALTER TABLE public.comment_likes ENABLE ROW LEVEL SECURITY;
  GRANT SELECT, INSERT, DELETE ON TABLE public.comment_likes TO authenticated;

  FOR pol IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'comment_likes'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.comment_likes', pol.policyname);
  END LOOP;

  CREATE POLICY comment_likes_auth_select
  ON public.comment_likes
  FOR SELECT
  TO authenticated
  USING (true);

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

  CREATE POLICY comment_likes_auth_delete_self
  ON public.comment_likes
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());
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
