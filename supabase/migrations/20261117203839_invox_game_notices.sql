-- Administration only: no public feed or game delivery channel is installed.
begin;
create table public.invox_game_notices(
  id uuid primary key,
  title text not null check(char_length(title) between 1 and 100 and title=btrim(title) and title!~'[[:cntrl:]]'),
  message text not null check(char_length(message) between 1 and 1200 and message=btrim(message)),
  kind text not null check(kind in('info','update','maintenance')),
  duration_seconds integer not null check(duration_seconds between 5 and 60),
  target text not null default 'lobby' check(target='lobby'),
  status text not null check(status in('draft','published','archived')),
  revision integer not null check(revision between 1 and 2147483647),
  created_at timestamptz not null,updated_at timestamptz not null,
  published_at timestamptz,archived_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  check((status='draft' and published_at is null and archived_at is null)
    or(status='published' and published_at is not null and archived_at is null)
    or(status='archived' and archived_at is not null))
);
create index invox_game_notices_recent_idx on public.invox_game_notices(updated_at desc,id desc);
alter table public.invox_game_notices enable row level security;
revoke all on public.invox_game_notices from public,anon,authenticated,service_role;
grant select,insert,update on public.invox_game_notices to service_role;

create function public.invox_game_notice_output(p_notice public.invox_game_notices) returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('id',p_notice.id,'revision',p_notice.revision,'title',p_notice.title,'message',p_notice.message,
    'kind',p_notice.kind,'durationSeconds',p_notice.duration_seconds,'target',p_notice.target,'status',p_notice.status,
    'createdAt',p_notice.created_at,'updatedAt',p_notice.updated_at,'publishedAt',p_notice.published_at,'archivedAt',p_notice.archived_at);
$$;
create function public.invox_game_notices_list(p_admin_id uuid,p_limit integer default 100) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare v_result jsonb;
begin
  perform public.invox_multipart_admin(p_admin_id);
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'Invalid notices limit' using errcode='22023';end if;
  with selected as(select n as notice from public.invox_game_notices n order by updated_at desc,id desc limit p_limit)
  select coalesce(jsonb_agg(public.invox_game_notice_output(notice) order by(notice).updated_at desc,(notice).id desc),'[]'::jsonb)
    into v_result from selected;
  return v_result;
end; $$;

create function public.invox_guard_game_notice() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  -- Auth account deletion may clear audit references without changing the notice.
  if (to_jsonb(new)-'created_by'-'updated_by') is not distinct from(to_jsonb(old)-'created_by'-'updated_by')
    and(new.created_by is not distinct from old.created_by or new.created_by is null)
    and(new.updated_by is not distinct from old.updated_by or new.updated_by is null) then return new;end if;
  if new.id is distinct from old.id or new.target is distinct from old.target or new.created_at is distinct from old.created_at
    or new.created_by is distinct from old.created_by or new.revision<>old.revision+1 then
    raise exception 'invox_notice_conflict' using errcode='40001';end if;
  if old.status='archived' or(old.status='published' and(new.status<>'archived'
    or row(new.title,new.message,new.kind,new.duration_seconds,new.published_at)
      is distinct from row(old.title,old.message,old.kind,old.duration_seconds,old.published_at))) then
    raise exception 'invox_notice_conflict' using errcode='40001';end if;
  return new;
end; $$;
create trigger invox_game_notice_guard before update on public.invox_game_notices
for each row execute function public.invox_guard_game_notice();

create or replace function invox_private.emit_invalidation(p_scope text,p_site boolean default false) returns void
language plpgsql security invoker set search_path='' as $$
begin
  if p_scope is null or p_scope not in('feedback','analytics','settings','installers','notices','all') or p_site is null
    or(p_site and p_scope not in('settings','installers')) then
    raise exception 'Invalid INVOX notification scope' using errcode='22023';end if;
  begin
    perform realtime.send(jsonb_build_object('scope',p_scope),'invalidate','invox:admin',true);
  exception when others then raise warning 'INVOX realtime notification unavailable';end;
  if p_site then
    begin perform realtime.send(jsonb_build_object('scope',p_scope),'invalidate','invox:site',false);
    exception when others then raise warning 'INVOX realtime notification unavailable';end;
  end if;
end; $$;
create function invox_private.notify_game_notices() returns trigger
language plpgsql security invoker set search_path='' as $$
begin perform invox_private.emit_invalidation('notices');return null;end; $$;
create trigger invox_game_notices_realtime after insert or update on public.invox_game_notices
for each row execute function invox_private.notify_game_notices();

create function public.invox_save_game_notice(p_admin_id uuid,p_id uuid,p_expected_revision integer,p_title text,p_message text,p_kind text,p_duration_seconds integer,p_publish boolean default false) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare v_notice public.invox_game_notices%rowtype;v_now timestamptz;v_same boolean;v_target_status text;
begin
  perform public.invox_multipart_admin(p_admin_id);
  if p_id is null or p_expected_revision is null or p_expected_revision not between 0 and 2147483646 or p_title is null
    or char_length(p_title) not between 1 and 100 or p_title<>btrim(p_title) or p_title~'[[:cntrl:]]' or p_message is null
    or char_length(p_message) not between 1 and 1200 or p_message<>btrim(p_message) or p_kind is null or p_kind not in('info','update','maintenance')
    or p_duration_seconds is null or p_duration_seconds not between 5 and 60 or p_publish is null then
    raise exception 'Invalid game notice' using errcode='22023';end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('invox-game-notice:'||p_id::text,0));
  select * into v_notice from public.invox_game_notices where id=p_id for update;
  v_target_status:=case when p_publish then 'published' else 'draft' end;
  if found then
    v_same:=row(v_notice.title,v_notice.message,v_notice.kind,v_notice.duration_seconds)
      is not distinct from row(p_title,p_message,p_kind,p_duration_seconds);
    -- An exact retry never emits another notification or changes timestamps.
    if v_same and v_notice.status=v_target_status and(p_expected_revision>0 or v_notice.created_by=p_admin_id) then
      return jsonb_build_object('notice',public.invox_game_notice_output(v_notice),'notices',public.invox_game_notices_list(p_admin_id));end if;
    if v_notice.status<>'draft' or v_notice.revision<>p_expected_revision or v_notice.revision>=2147483647 then
      raise exception 'invox_notice_conflict' using errcode='40001';end if;
    v_now:=clock_timestamp();
    update public.invox_game_notices set title=p_title,message=p_message,kind=p_kind,duration_seconds=p_duration_seconds,
      status=v_target_status,revision=revision+1,updated_at=v_now,updated_by=p_admin_id,published_at=case when p_publish then v_now else null end
      where id=p_id returning * into v_notice;
  else
    if p_expected_revision<>0 then raise exception 'Game notice not found' using errcode='P0002';end if;
    v_now:=clock_timestamp();
    insert into public.invox_game_notices(id,title,message,kind,duration_seconds,status,revision,created_at,updated_at,published_at,created_by,updated_by)
      values(p_id,p_title,p_message,p_kind,p_duration_seconds,v_target_status,1,v_now,v_now,case when p_publish then v_now else null end,p_admin_id,p_admin_id)
      returning * into v_notice;
  end if;
  return jsonb_build_object('notice',public.invox_game_notice_output(v_notice),'notices',public.invox_game_notices_list(p_admin_id));
end; $$;

create function public.invox_transition_game_notice(p_admin_id uuid,p_id uuid,p_expected_revision integer,p_action text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare v_notice public.invox_game_notices%rowtype;v_status text;v_now timestamptz;
begin
  perform public.invox_multipart_admin(p_admin_id);
  if p_id is null or p_expected_revision is null or p_expected_revision not between 1 and 2147483646 or p_action is null or p_action not in('publish','archive') then
    raise exception 'Invalid game notice transition' using errcode='22023';end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('invox-game-notice:'||p_id::text,0));
  select * into v_notice from public.invox_game_notices where id=p_id for update;
  if not found then raise exception 'Game notice not found' using errcode='P0002';end if;
  v_status:=case when p_action='publish' then 'published' else 'archived' end;
  if v_notice.status=v_status then
    return jsonb_build_object('notice',public.invox_game_notice_output(v_notice),'notices',public.invox_game_notices_list(p_admin_id));end if;
  if v_notice.status='archived' or(p_action='publish' and v_notice.status<>'draft') or v_notice.revision<>p_expected_revision or v_notice.revision>=2147483647 then
    raise exception 'invox_notice_conflict' using errcode='40001';end if;
  v_now:=clock_timestamp();
  update public.invox_game_notices set status=v_status,revision=revision+1,updated_at=v_now,updated_by=p_admin_id,
    published_at=case when p_action='publish' then v_now else published_at end,
    archived_at=case when p_action='archive' then v_now else null end where id=p_id returning * into v_notice;
  return jsonb_build_object('notice',public.invox_game_notice_output(v_notice),'notices',public.invox_game_notices_list(p_admin_id));
end; $$;

revoke all on function public.invox_game_notice_output(public.invox_game_notices),public.invox_game_notices_list(uuid,integer),
  public.invox_guard_game_notice(),public.invox_save_game_notice(uuid,uuid,integer,text,text,text,integer,boolean),
  public.invox_transition_game_notice(uuid,uuid,integer,text),invox_private.notify_game_notices() from public,anon,authenticated,service_role;
grant execute on function public.invox_game_notice_output(public.invox_game_notices),public.invox_game_notices_list(uuid,integer),
  public.invox_guard_game_notice(),public.invox_save_game_notice(uuid,uuid,integer,text,text,text,integer,boolean),
  public.invox_transition_game_notice(uuid,uuid,integer,text),invox_private.notify_game_notices() to service_role;
-- CREATE OR REPLACE keeps these grants; restate them explicitly for the snapshot.
revoke all on function invox_private.emit_invalidation(text,boolean) from public,anon,authenticated;
grant execute on function invox_private.emit_invalidation(text,boolean) to service_role;
commit;
