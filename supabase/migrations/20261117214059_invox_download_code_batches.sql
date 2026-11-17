-- Atomic, idempotent batches contain metadata and hashes only.
begin;
create table public.invox_download_code_batches(
  id uuid primary key,
  label text not null check(char_length(label)<=80 and label=btrim(label) and label!~'[[:cntrl:]]'),
  code_count integer not null check(code_count between 1 and 100),
  max_uses integer not null check(max_uses between 1 and 1000),
  valid_for_hours integer check(valid_for_hours between 1 and 8760),
  code_manifest jsonb not null check(jsonb_typeof(code_manifest)='array' and jsonb_array_length(code_manifest)=code_count),
  created_at timestamptz not null,
  created_by uuid references auth.users(id) on delete set null
);
alter table public.invox_download_code_batches enable row level security;
revoke all on public.invox_download_code_batches from public,anon,authenticated,service_role;
grant select,insert on public.invox_download_code_batches to service_role;
create function public.invox_create_download_codes(p_admin_id uuid,p_id uuid,p_label text,p_count integer,p_max_uses integer,p_valid_for_hours integer,p_codes jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare b public.invox_download_code_batches%rowtype;v_now timestamptz;v_item jsonb;v_entries jsonb;
begin
  perform public.invox_multipart_admin(p_admin_id);
  if p_id is null or p_label is null or char_length(p_label)>80 or p_label<>btrim(p_label) or p_label~'[[:cntrl:]]'
    or p_count is null or p_count not between 1 and 100 or p_max_uses is null or p_max_uses not between 1 and 1000
    or(p_valid_for_hours is not null and p_valid_for_hours not between 1 and 8760)
    or p_codes is null or jsonb_typeof(p_codes)<>'array' then raise exception 'Invalid code batch' using errcode='22023';end if;
  if jsonb_array_length(p_codes)<>p_count or exists(select 1 from jsonb_array_elements(p_codes) e where jsonb_typeof(e)<>'object'
      or e->>'id' is null or e->>'id'!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
      or e->>'hash' is null or e->>'hash'!~'^[a-f0-9]{64}$' or e- 'id'- 'hash'<>'{}'::jsonb)
    or(select count(distinct e->>'id') from jsonb_array_elements(p_codes) e)<>p_count
    or(select count(distinct e->>'hash') from jsonb_array_elements(p_codes) e)<>p_count then
    raise exception 'Invalid code batch manifest' using errcode='22023';end if;
  perform pg_advisory_xact_lock(hashtextextended('invox-code-batch:'||p_id::text,0));
  select * into b from public.invox_download_code_batches where id=p_id;
  if found then
    if b.label is distinct from p_label or b.code_count is distinct from p_count or b.max_uses is distinct from p_max_uses
      or b.valid_for_hours is distinct from p_valid_for_hours or b.code_manifest is distinct from p_codes then raise exception 'invox_code_creation_conflict';end if;
  else
    -- The same child ID cannot be attached to a legacy request or another batch.
    -- Deterministic lock order also avoids deadlocks between overlapping manifests.
    for v_item in select value from jsonb_array_elements(p_codes) order by value->>'id' loop
      perform pg_advisory_xact_lock(hashtextextended('invox-code-create:'||(v_item->>'id'),0));
    end loop;
    if exists(select 1 from public.invox_download_codes c join jsonb_array_elements(p_codes) e on c.id=(e->>'id')::uuid or c.code_hash=e->>'hash') then
      raise exception 'invox_code_creation_conflict';end if;
    v_now:=clock_timestamp();
    insert into public.invox_download_code_batches(id,label,code_count,max_uses,valid_for_hours,code_manifest,created_at,created_by)
      values(p_id,p_label,p_count,p_max_uses,p_valid_for_hours,p_codes,v_now,p_admin_id) returning * into b;
    begin
      insert into public.invox_download_codes(id,code_hash,label,max_uses,valid_for_hours,created_at,expires_at,created_by)
      select e.id,e.hash,p_label,p_max_uses,p_valid_for_hours,v_now,
        case when p_valid_for_hours is not null then v_now+make_interval(hours=>p_valid_for_hours) else null end,p_admin_id
      from jsonb_to_recordset(p_codes) as e(id uuid,hash text);
    exception when unique_violation then raise exception 'invox_code_creation_conflict';end;
  end if;
  select jsonb_agg(public.invox_download_code_output(c) order by e.ordinality) into v_entries
    from jsonb_array_elements(b.code_manifest) with ordinality e(value,ordinality)
    join public.invox_download_codes c on c.id=(e.value->>'id')::uuid and c.code_hash=e.value->>'hash';
  if v_entries is null or jsonb_array_length(v_entries)<>p_count then raise exception 'Code batch incomplete';end if;
  return jsonb_build_object('entries',v_entries,'downloadCodes',public.invox_download_codes_list(p_admin_id));
end; $$;
revoke all on function public.invox_create_download_codes(uuid,uuid,text,integer,integer,integer,jsonb) from public,anon,authenticated;
grant execute on function public.invox_create_download_codes(uuid,uuid,text,integer,integer,integer,jsonb) to service_role;
-- One private invalidation per statement, including a batch of 100 codes.
drop trigger invox_download_codes_realtime on public.invox_download_codes;
create or replace function invox_private.notify_download_codes() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='INSERT' then
    if exists(select 1 from new_codes) then perform invox_private.emit_invalidation('settings');end if;
  elsif exists(select 1 from new_codes n join old_codes o using(id)
    where row(n.used_count,n.revoked_at) is distinct from row(o.used_count,o.revoked_at)) then
    perform invox_private.emit_invalidation('settings');
  end if;
  return null;
end; $$;
create trigger invox_download_codes_insert_realtime after insert on public.invox_download_codes
referencing new table as new_codes for each statement execute function invox_private.notify_download_codes();
create trigger invox_download_codes_update_realtime after update on public.invox_download_codes
referencing old table as old_codes new table as new_codes for each statement execute function invox_private.notify_download_codes();
revoke all on function invox_private.notify_download_codes() from public,anon,authenticated;
grant execute on function invox_private.notify_download_codes() to service_role;
commit;
