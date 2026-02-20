-- Radar RPC Sync Hotfix
-- Date: 2026-02-20
-- Purpose:
-- 1) Normalize legacy join_radar_event RPC behavior to match mobile baseline.
-- 2) Prevent ambiguous-column regressions in join flow.
-- 3) Keep grant state explicit for authenticated clients.

begin;

create or replace function public.join_radar_event(
  p_radar_id uuid,
  p_user_id uuid
)
returns table(status text, chat_room_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := coalesce(p_user_id, auth.uid());
  v_event record;
  v_existing record;
  v_joined_count int;
  v_new_status text;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  if auth.uid() is not null and auth.uid() <> v_uid then
    raise exception 'forbidden_user';
  end if;

  select *
  into v_event
  from public.radar_events
  where id = p_radar_id;

  if not found then
    raise exception 'Radar tidak ditemukan';
  end if;

  if v_event.status not in ('PUBLISHED', 'UPDATED') then
    raise exception 'Radar tidak aktif';
  end if;

  if v_event.event_time < now() then
    raise exception 'Radar sudah lewat';
  end if;

  if v_event.max_participants is not null and v_event.max_participants > 0 then
    select count(*)
    into v_joined_count
    from public.radar_participants rp
    where rp.radar_id = p_radar_id
      and rp.status = 'JOINED';

    if v_joined_count >= v_event.max_participants then
      raise exception 'Kuota penuh';
    end if;
  end if;

  select *
  into v_existing
  from public.radar_participants rp
  where rp.radar_id = p_radar_id
    and rp.user_id = v_uid
  limit 1;

  if found then
    if v_existing.status = 'JOINED' then
      return query select 'JOINED', v_event.chat_room_id;
      return;
    elsif v_existing.status = 'PENDING' then
      return query select 'PENDING', null::uuid;
      return;
    end if;
  end if;

  if coalesce(v_event.require_host_approval, false) then
    v_new_status := 'PENDING';
  else
    v_new_status := 'JOINED';
  end if;

  insert into public.radar_participants as rp (radar_id, user_id, status, role)
  values (p_radar_id, v_uid, v_new_status, 'MEMBER')
  on conflict (radar_id, user_id) do update
  set status = excluded.status,
      role = excluded.role;

  insert into public.radar_change_logs (radar_id, changed_by, change_type, description)
  values (
    p_radar_id,
    v_uid,
    case when v_new_status = 'PENDING' then 'REQUEST_JOIN' else 'JOIN' end,
    case when v_new_status = 'PENDING' then 'Mengajukan permintaan join' else 'Bergabung ke Radar' end
  );

  if v_new_status = 'JOINED' and v_event.chat_room_id is not null then
    insert into public.chat_members (chat_id, user_id)
    values (v_event.chat_room_id, v_uid)
    on conflict (chat_id, user_id) do nothing;

    return query select 'JOINED', v_event.chat_room_id;
    return;
  end if;

  return query select 'PENDING', null::uuid;
end;
$$;

revoke all on function public.join_radar_event(uuid, uuid) from public;
grant execute on function public.join_radar_event(uuid, uuid) to authenticated;

-- Refresh PostgREST schema cache.
do $$
begin
  perform pg_notify('pgrst', 'reload schema');
exception
  when others then
    null;
end;
$$;

commit;
