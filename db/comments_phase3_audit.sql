-- Comments Phase-3 Audit Checklist
-- Date: 2026-02-19
-- Purpose:
-- 1) Verify threaded comments schema and integrity.
-- 2) Verify comment image and comment likes readiness.
-- 3) Verify RLS and policy canonical state for comments and comment_likes.

-- A. Table presence
select
  to_regclass('public.comments') as comments_table,
  to_regclass('public.comment_likes') as comment_likes_table;

-- B. Canonical column presence
select
  c.table_name,
  c.column_name,
  c.data_type,
  c.is_nullable
from information_schema.columns c
where c.table_schema = 'public'
  and c.table_name in ('comments', 'comment_likes')
  and (
    (c.table_name = 'comments' and c.column_name in (
      'id', 'user_id', 'post_id', 'parent_id', 'content', 'image_url', 'created_at'
    ))
    or
    (c.table_name = 'comment_likes' and c.column_name in (
      'id', 'user_id', 'comment_id', 'post_id', 'created_at'
    ))
  )
order by c.table_name, c.column_name;

-- C. Comments integrity checks
select
  count(*) filter (where user_id is null) as null_user_id,
  count(*) filter (where post_id is null) as null_post_id,
  count(*) filter (where parent_id is not null and parent_id = id) as self_parent_rows,
  count(*) filter (
    where parent_id is not null
      and not exists (
        select 1
        from public.comments p
        where p.id = c.parent_id
      )
  ) as orphan_parent_rows,
  count(*) filter (
    where parent_id is not null
      and exists (
        select 1
        from public.comments p
        where p.id = c.parent_id
          and p.post_id is distinct from c.post_id
      )
  ) as cross_post_parent_rows
from public.comments c;

-- D. Comment likes integrity checks
select
  count(*) filter (where cl.user_id is null) as null_user_id,
  count(*) filter (where cl.comment_id is null) as null_comment_id,
  count(*) filter (where cl.post_id is null) as null_post_id,
  count(*) filter (where c.id is null) as orphan_comment_like_rows,
  count(*) filter (where p.id is null) as orphan_user_like_rows,
  count(*) filter (where c.id is not null and c.post_id is distinct from cl.post_id) as mismatched_post_rows
from public.comment_likes cl
left join public.comments c on c.id = cl.comment_id
left join public.profiles p on p.id = cl.user_id;

select
  user_id,
  comment_id,
  count(*) as duplicate_count
from public.comment_likes
group by user_id, comment_id
having count(*) > 1
order by duplicate_count desc;

-- E. Constraint inventory (comments + comment_likes)
select
  cls.relname as table_name,
  con.conname as constraint_name,
  con.contype as constraint_type,
  pg_get_constraintdef(con.oid) as definition
from pg_constraint con
join pg_class cls on cls.oid = con.conrelid
join pg_namespace nsp on nsp.oid = cls.relnamespace
where nsp.nspname = 'public'
  and cls.relname in ('comments', 'comment_likes')
order by cls.relname, con.contype, con.conname;

-- E2. Legacy comment_likes constraint residue (expect: 0 rows)
select
  con.conname as constraint_name,
  con.contype as constraint_type,
  pg_get_constraintdef(con.oid) as definition
from pg_constraint con
where con.conrelid = 'public.comment_likes'::regclass
  and con.conname in (
    'comment_likes_comment_id_fkey',
    'comment_likes_comment_id_fk',
    'comment_likes_user_id_fkey',
    'comment_likes_comment_id_user_id_key'
  )
order by con.conname;

-- E3. Canonical constraint readiness snapshot (expect all = true)
select
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.comments'::regclass
      and conname = 'comments_no_self_parent'
  ) as has_comments_no_self_parent,
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.comments'::regclass
      and conname = 'comments_parent_same_post_fkey'
  ) as has_comments_parent_same_post_fkey,
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.comments'::regclass
      and conname = 'comments_id_post_id_unique'
  ) as has_comments_id_post_id_unique,
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.comment_likes'::regclass
      and conname = 'comment_likes_user_comment_unique'
  ) as has_comment_likes_user_comment_unique,
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.comment_likes'::regclass
      and conname = 'comment_likes_user_fk'
  ) as has_comment_likes_user_fk,
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.comment_likes'::regclass
      and conname = 'comment_likes_comment_fk'
  ) as has_comment_likes_comment_fk;

-- E4. Comment likes RPC availability (recommended for performance)
select
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as args
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('get_comment_likes_summary')
order by p.proname;

-- F. Policy inventory
select
  tablename,
  policyname,
  cmd as command,
  roles,
  permissive,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('comments', 'comment_likes')
order by tablename, command, policyname;

-- F2. Non-canonical policies (expect: 0 rows unless intentionally customized)
select
  tablename,
  policyname,
  cmd as command,
  permissive
from pg_policies
where schemaname = 'public'
  and tablename in ('comments', 'comment_likes')
  and (
    (tablename = 'comments' and policyname not in (
      'Public read comments',
      'comments_auth_select',
      'comments_auth_insert_self',
      'comments_auth_update_self',
      'comments_auth_delete_self',
      'comments_block_restrict_select',
      'comments_block_restrict_insert'
    ))
    or
    (tablename = 'comment_likes' and policyname not in (
      'comment_likes_auth_select',
      'comment_likes_auth_insert_self',
      'comment_likes_auth_delete_self'
    ))
  )
order by tablename, command, policyname;

-- G. RLS status
select
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  c.relforcerowsecurity as force_rls
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('comments', 'comment_likes')
order by c.relname;

-- H. Index inventory
select
  tablename,
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in ('comments', 'comment_likes')
order by tablename, indexname;

-- I. Runtime smoke queries under current session user
-- Expect: zero or more rows, no error.
select c.id, c.post_id, c.parent_id, c.image_url, c.created_at
from public.comments c
order by c.created_at desc
limit 20;

select cl.id, cl.comment_id, cl.post_id, cl.created_at
from public.comment_likes cl
order by cl.created_at desc
limit 20;

-- J. Production readiness summary (single-row verdict)
with comments_integrity as (
  select
    count(*) filter (where user_id is null) as null_user_id,
    count(*) filter (where post_id is null) as null_post_id,
    count(*) filter (where parent_id is not null and parent_id = id) as self_parent_rows,
    count(*) filter (
      where parent_id is not null
        and not exists (
          select 1
          from public.comments p
          where p.id = c.parent_id
        )
    ) as orphan_parent_rows,
    count(*) filter (
      where parent_id is not null
        and exists (
          select 1
          from public.comments p
          where p.id = c.parent_id
            and p.post_id is distinct from c.post_id
        )
    ) as cross_post_parent_rows
  from public.comments c
),
likes_integrity as (
  select
    count(*) filter (where cl.user_id is null) as null_user_id,
    count(*) filter (where cl.comment_id is null) as null_comment_id,
    count(*) filter (where cl.post_id is null) as null_post_id,
    count(*) filter (where c.id is null) as orphan_comment_like_rows,
    count(*) filter (where p.id is null) as orphan_user_like_rows,
    count(*) filter (where c.id is not null and c.post_id is distinct from cl.post_id) as mismatched_post_rows
  from public.comment_likes cl
  left join public.comments c on c.id = cl.comment_id
  left join public.profiles p on p.id = cl.user_id
),
likes_duplicates as (
  select count(*) as duplicate_pairs
  from (
    select user_id, comment_id
    from public.comment_likes
    group by user_id, comment_id
    having count(*) > 1
  ) d
),
legacy_constraints as (
  select count(*) as legacy_constraint_count
  from pg_constraint con
  where con.conrelid = 'public.comment_likes'::regclass
    and con.conname in (
      'comment_likes_comment_id_fkey',
      'comment_likes_comment_id_fk',
      'comment_likes_user_id_fkey',
      'comment_likes_comment_id_user_id_key'
    )
),
canonical_constraints as (
  select
    bool_and(flag) as all_canonical_constraints_present
  from (
    select exists (
      select 1 from pg_constraint
      where conrelid = 'public.comments'::regclass
        and conname = 'comments_no_self_parent'
    ) as flag
    union all
    select exists (
      select 1 from pg_constraint
      where conrelid = 'public.comments'::regclass
        and conname = 'comments_parent_same_post_fkey'
    )
    union all
    select exists (
      select 1 from pg_constraint
      where conrelid = 'public.comments'::regclass
        and conname = 'comments_id_post_id_unique'
    )
    union all
    select exists (
      select 1 from pg_constraint
      where conrelid = 'public.comment_likes'::regclass
        and conname = 'comment_likes_user_comment_unique'
    )
    union all
    select exists (
      select 1 from pg_constraint
      where conrelid = 'public.comment_likes'::regclass
        and conname = 'comment_likes_user_fk'
    )
    union all
    select exists (
      select 1 from pg_constraint
      where conrelid = 'public.comment_likes'::regclass
        and conname = 'comment_likes_comment_fk'
    )
  ) t
),
non_canonical_policies as (
  select count(*) as non_canonical_policy_count
  from pg_policies
  where schemaname = 'public'
    and tablename in ('comments', 'comment_likes')
    and (
      (tablename = 'comments' and policyname not in (
        'Public read comments',
        'comments_auth_select',
        'comments_auth_insert_self',
        'comments_auth_update_self',
        'comments_auth_delete_self',
        'comments_block_restrict_select',
        'comments_block_restrict_insert'
      ))
      or
      (tablename = 'comment_likes' and policyname not in (
        'comment_likes_auth_select',
        'comment_likes_auth_insert_self',
        'comment_likes_auth_delete_self'
      ))
    )
),
rpc_readiness as (
  select exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'get_comment_likes_summary'
  ) as has_comment_like_summary_rpc
),
rls_state as (
  select
    coalesce(bool_and(c.relrowsecurity), false) as all_rls_enabled
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in ('comments', 'comment_likes')
)
select
  (ci.null_user_id = 0
    and ci.null_post_id = 0
    and ci.self_parent_rows = 0
    and ci.orphan_parent_rows = 0
    and ci.cross_post_parent_rows = 0) as comments_integrity_ok,
  (li.null_user_id = 0
    and li.null_comment_id = 0
    and li.null_post_id = 0
    and li.orphan_comment_like_rows = 0
    and li.orphan_user_like_rows = 0
    and li.mismatched_post_rows = 0
    and ld.duplicate_pairs = 0) as comment_likes_integrity_ok,
  (lc.legacy_constraint_count = 0) as no_legacy_comment_likes_constraints,
  coalesce(cc.all_canonical_constraints_present, false) as canonical_constraints_ok,
  (ncp.non_canonical_policy_count = 0) as canonical_policies_ok,
  rr.has_comment_like_summary_rpc as comment_likes_summary_rpc_ok,
  rs.all_rls_enabled as rls_ok,
  (
    (ci.null_user_id = 0
      and ci.null_post_id = 0
      and ci.self_parent_rows = 0
      and ci.orphan_parent_rows = 0
      and ci.cross_post_parent_rows = 0)
    and
    (li.null_user_id = 0
      and li.null_comment_id = 0
      and li.null_post_id = 0
      and li.orphan_comment_like_rows = 0
      and li.orphan_user_like_rows = 0
      and li.mismatched_post_rows = 0
      and ld.duplicate_pairs = 0)
    and lc.legacy_constraint_count = 0
    and coalesce(cc.all_canonical_constraints_present, false)
    and ncp.non_canonical_policy_count = 0
    and rr.has_comment_like_summary_rpc
    and rs.all_rls_enabled
  ) as production_ready
from comments_integrity ci
cross join likes_integrity li
cross join likes_duplicates ld
cross join legacy_constraints lc
cross join canonical_constraints cc
cross join non_canonical_policies ncp
cross join rpc_readiness rr
cross join rls_state rs;
