-- Radar comments + likes hotfix
-- Date: 2026-02-20
-- Purpose:
-- 1) Add native radar comments table with reply support.
-- 2) Add radar comment likes table.
-- 3) Add summary RPC for fast likes lookup.
-- 4) Apply RLS and grants for web/mobile parity.

begin;

create table if not exists public.radar_comments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  radar_id uuid not null,
  parent_id uuid references public.radar_comments(id) on delete cascade,
  content text not null,
  image_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.radar_comments
  add column if not exists parent_id uuid references public.radar_comments(id) on delete cascade;
alter table public.radar_comments
  add column if not exists image_url text;
alter table public.radar_comments
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.radar_comments'::regclass
      and conname = 'radar_comments_content_not_blank'
  ) then
    alter table public.radar_comments
      add constraint radar_comments_content_not_blank
      check (length(trim(content)) > 0);
  end if;
exception
  when others then
    -- Keep migration resilient if environment has incompatible legacy rows.
    null;
end
$$;

create index if not exists idx_radar_comments_radar_created
  on public.radar_comments(radar_id, created_at desc);
create index if not exists idx_radar_comments_parent
  on public.radar_comments(parent_id);
create index if not exists idx_radar_comments_user
  on public.radar_comments(user_id);

create or replace function public.radar_comments_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end
$$;

drop trigger if exists radar_comments_set_updated_at on public.radar_comments;
create trigger radar_comments_set_updated_at
before update on public.radar_comments
for each row
execute function public.radar_comments_set_updated_at();

create table if not exists public.radar_comment_likes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  radar_comment_id uuid not null references public.radar_comments(id) on delete cascade,
  radar_id uuid not null,
  created_at timestamptz not null default now()
);

alter table public.radar_comment_likes
  add column if not exists radar_id uuid not null default '00000000-0000-0000-0000-000000000000';

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'radar_comment_likes'
      and column_name = 'radar_id'
      and column_default = '''00000000-0000-0000-0000-000000000000''::uuid'
  ) then
    alter table public.radar_comment_likes
      alter column radar_id drop default;
  end if;
exception
  when others then
    null;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.radar_comment_likes'::regclass
      and conname = 'radar_comment_likes_user_comment_unique'
  ) then
    alter table public.radar_comment_likes
      add constraint radar_comment_likes_user_comment_unique
      unique (user_id, radar_comment_id);
  end if;
exception
  when others then
    null;
end
$$;

create index if not exists idx_radar_comment_likes_comment
  on public.radar_comment_likes(radar_comment_id);
create index if not exists idx_radar_comment_likes_radar
  on public.radar_comment_likes(radar_id);
create index if not exists idx_radar_comment_likes_user
  on public.radar_comment_likes(user_id);

create or replace function public.get_radar_comment_likes_summary(
  p_comment_ids uuid[],
  p_user_id uuid default null
)
returns table (
  comment_id uuid,
  likes_count bigint,
  is_liked boolean
)
language sql
stable
set search_path = public
as $$
  with selected_comments as (
    select unnest(coalesce(p_comment_ids, array[]::uuid[])) as id
  ),
  likes_agg as (
    select
      rcl.radar_comment_id as comment_id,
      count(*)::bigint as likes_count
    from public.radar_comment_likes rcl
    join selected_comments sc on sc.id = rcl.radar_comment_id
    group by rcl.radar_comment_id
  ),
  user_likes as (
    select rcl.radar_comment_id as comment_id
    from public.radar_comment_likes rcl
    join selected_comments sc on sc.id = rcl.radar_comment_id
    where p_user_id is not null
      and rcl.user_id = p_user_id
  )
  select
    sc.id as comment_id,
    coalesce(la.likes_count, 0)::bigint as likes_count,
    (ul.comment_id is not null) as is_liked
  from selected_comments sc
  left join likes_agg la on la.comment_id = sc.id
  left join user_likes ul on ul.comment_id = sc.id;
$$;

grant select, insert, update, delete on table public.radar_comments to authenticated;
grant select, insert, delete on table public.radar_comment_likes to authenticated;
grant execute on function public.get_radar_comment_likes_summary(uuid[], uuid) to authenticated, anon;

alter table public.radar_comments enable row level security;
alter table public.radar_comment_likes enable row level security;

drop policy if exists radar_comments_public_select on public.radar_comments;
create policy radar_comments_public_select
  on public.radar_comments
  for select
  using (true);

drop policy if exists radar_comments_auth_insert_self on public.radar_comments;
create policy radar_comments_auth_insert_self
  on public.radar_comments
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists radar_comments_auth_update_self on public.radar_comments;
create policy radar_comments_auth_update_self
  on public.radar_comments
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists radar_comments_auth_delete_self on public.radar_comments;
create policy radar_comments_auth_delete_self
  on public.radar_comments
  for delete
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists radar_comment_likes_public_select on public.radar_comment_likes;
create policy radar_comment_likes_public_select
  on public.radar_comment_likes
  for select
  using (true);

drop policy if exists radar_comment_likes_auth_insert_self on public.radar_comment_likes;
create policy radar_comment_likes_auth_insert_self
  on public.radar_comment_likes
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists radar_comment_likes_auth_delete_self on public.radar_comment_likes;
create policy radar_comment_likes_auth_delete_self
  on public.radar_comment_likes
  for delete
  to authenticated
  using (auth.uid() = user_id);

commit;
