-- Comments Like Summary RPC Hotfix
-- Date: 2026-02-19
-- Purpose:
-- 1) Add RPC for aggregated comment-like summary in one query.
-- 2) Reduce payload/processing on client for comment like counts.
-- 3) Keep migration idempotent.

DO $$
BEGIN
  IF to_regclass('public.comment_likes') IS NULL THEN
    RAISE NOTICE 'public.comment_likes not found, skipping comments_like_summary_rpc_hotfix';
    RETURN;
  END IF;

  CREATE OR REPLACE FUNCTION public.get_comment_likes_summary(
    p_comment_ids uuid[],
    p_user_id uuid DEFAULT NULL
  )
  RETURNS TABLE (
    comment_id uuid,
    likes_count bigint,
    is_liked boolean
  )
  LANGUAGE sql
  STABLE
  AS $func$
    SELECT
      cl.comment_id,
      count(*)::bigint AS likes_count,
      bool_or(p_user_id IS NOT NULL AND cl.user_id = p_user_id) AS is_liked
    FROM public.comment_likes cl
    WHERE cl.comment_id = ANY(COALESCE(p_comment_ids, '{}'::uuid[]))
    GROUP BY cl.comment_id
  $func$;

  GRANT EXECUTE ON FUNCTION public.get_comment_likes_summary(uuid[], uuid) TO authenticated;
  GRANT EXECUTE ON FUNCTION public.get_comment_likes_summary(uuid[], uuid) TO anon;
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
