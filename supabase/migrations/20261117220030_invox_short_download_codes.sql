-- Recoverable six-character tokens: only hashes, format and derivation nonce persist.
begin;
alter table public.invox_download_codes
  add column code_format smallint not null default 0 check(code_format in(0,1)),
  add column derivation_nonce integer not null default 0 check(derivation_nonce between 0 and 1024);
create index invox_download_codes_unused_short_idx on public.invox_download_codes(created_at,id)
  where code_format=1 and used_count=0 and revoked_at is null;
create or replace function public.invox_download_code_output(p_code public.invox_download_codes) returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('id',p_code.id,'label',p_code.label,'maxUses',p_code.max_uses,'usedCount',p_code.used_count,
    'remainingUses',greatest(0,p_code.max_uses-p_code.used_count),'createdAt',p_code.created_at,'expiresAt',p_code.expires_at,'revokedAt',p_code.revoked_at,
    'codeFormat',case when p_code.code_format=1 then 'short' else 'legacy' end,
    'status',case when p_code.revoked_at is not null then 'revoked' when p_code.expires_at<=statement_timestamp() then 'expired'
      when p_code.used_count>=p_code.max_uses then 'exhausted' else 'active' end);
$$;
create function public.invox_code_secret_metadata(p_code public.invox_download_codes) returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('entry',public.invox_download_code_output(p_code),'formatVersion',p_code.code_format,
    'nonce',p_code.derivation_nonce,'hash',p_code.code_hash);
$$;
create function public.invox_lookup_code_creation(p_admin_id uuid,p_id uuid,p_label text,p_max_uses integer,p_valid_for_hours integer) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare c public.invox_download_codes%rowtype;
begin
  perform public.invox_multipart_admin(p_admin_id);
  select * into c from public.invox_download_codes where id=p_id;
  if not found then return jsonb_build_object('found',false);end if;
  if c.label is distinct from p_label or c.max_uses is distinct from p_max_uses or c.valid_for_hours is distinct from p_valid_for_hours then raise exception 'invox_code_creation_conflict';end if;
  return jsonb_build_object('found',true,'metadata',public.invox_code_secret_metadata(c));
end; $$;
create function public.invox_batch_secret_metadata(p_batch public.invox_download_code_batches) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare v_result jsonb;
begin
  select jsonb_agg(public.invox_code_secret_metadata(c) order by e.ordinality) into v_result
    from jsonb_array_elements(p_batch.code_manifest) with ordinality e(value,ordinality)
    join public.invox_download_codes c on c.id=(e.value->>'id')::uuid and c.code_hash=e.value->>'hash';
  if v_result is null or jsonb_array_length(v_result)<>p_batch.code_count then raise exception 'Code batch incomplete';end if;
  return v_result;
end; $$;
create function public.invox_lookup_code_batch(p_admin_id uuid,p_id uuid,p_label text,p_count integer,p_max_uses integer,p_valid_for_hours integer) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare b public.invox_download_code_batches%rowtype;
begin
  perform public.invox_multipart_admin(p_admin_id);
  select * into b from public.invox_download_code_batches where id=p_id;
  if not found then return jsonb_build_object('found',false);end if;
  if b.label is distinct from p_label or b.code_count is distinct from p_count or b.max_uses is distinct from p_max_uses or b.valid_for_hours is distinct from p_valid_for_hours then raise exception 'invox_code_creation_conflict';end if;
  return jsonb_build_object('found',true,'metadata',public.invox_batch_secret_metadata(b));
end; $$;
create function public.invox_create_short_code(p_admin_id uuid,p_id uuid,p_code_hash text,p_label text,p_max_uses integer,p_valid_for_hours integer,p_nonce integer) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare c public.invox_download_codes%rowtype;v_now timestamptz;
begin
  perform public.invox_multipart_admin(p_admin_id);
  if p_id is null or p_code_hash is null or p_code_hash!~'^[a-f0-9]{64}$' or p_label is null or char_length(p_label)>80 or p_label<>btrim(p_label) or p_label~'[[:cntrl:]]'
    or p_max_uses is null or p_max_uses not between 1 and 1000 or(p_valid_for_hours is not null and p_valid_for_hours not between 1 and 8760)
    or p_nonce is null or p_nonce not between 0 and 1024 then raise exception 'Invalid short code' using errcode='22023';end if;
  perform pg_advisory_xact_lock(hashtextextended('invox-code-create:'||p_id::text,0));
  select * into c from public.invox_download_codes where id=p_id;
  if found then
    if c.label is distinct from p_label or c.max_uses is distinct from p_max_uses or c.valid_for_hours is distinct from p_valid_for_hours then raise exception 'invox_code_creation_conflict';end if;
  else
    v_now:=clock_timestamp();
    begin
      insert into public.invox_download_codes(id,code_hash,label,max_uses,valid_for_hours,created_at,expires_at,created_by,code_format,derivation_nonce)
        values(p_id,p_code_hash,p_label,p_max_uses,p_valid_for_hours,v_now,case when p_valid_for_hours is not null then v_now+make_interval(hours=>p_valid_for_hours) else null end,p_admin_id,1,p_nonce) returning * into c;
    exception when unique_violation then raise exception 'invox_code_collision';end;
  end if;
  return jsonb_build_object('metadata',public.invox_code_secret_metadata(c),'downloadCodes',public.invox_download_codes_list(p_admin_id));
end; $$;
create function public.invox_create_short_codes(p_admin_id uuid,p_id uuid,p_label text,p_count integer,p_max_uses integer,p_valid_for_hours integer,p_codes jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare b public.invox_download_code_batches%rowtype;v_now timestamptz;v_item jsonb;
begin
  perform public.invox_multipart_admin(p_admin_id);
  if p_id is null or p_label is null or char_length(p_label)>80 or p_label<>btrim(p_label) or p_label~'[[:cntrl:]]'
    or p_count is null or p_count not between 1 and 100 or p_max_uses is null or p_max_uses not between 1 and 1000
    or(p_valid_for_hours is not null and p_valid_for_hours not between 1 and 8760) then raise exception 'Invalid short code batch' using errcode='22023';end if;
  perform pg_advisory_xact_lock(hashtextextended('invox-code-batch:'||p_id::text,0));
  select * into b from public.invox_download_code_batches where id=p_id;
  if found then
    if b.label is distinct from p_label or b.code_count is distinct from p_count or b.max_uses is distinct from p_max_uses or b.valid_for_hours is distinct from p_valid_for_hours then raise exception 'invox_code_creation_conflict';end if;
  else
    if p_codes is null or jsonb_typeof(p_codes)<>'array' then raise exception 'Invalid short code manifest' using errcode='22023';end if;
    if jsonb_array_length(p_codes)<>p_count or exists(select 1 from jsonb_array_elements(p_codes) e where jsonb_typeof(e)<>'object'
      or e->>'id' is null or e->>'id'!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
      or e->>'hash' is null or e->>'hash'!~'^[a-f0-9]{64}$' or not(case when jsonb_typeof(e->'nonce')='number' and(e->>'nonce')~'^[0-9]{1,4}$'
        then(e->>'nonce')::integer between 0 and 1024 else false end) or e-'id'-'hash'-'nonce'<>'{}'::jsonb)
      or(select count(distinct e->>'id') from jsonb_array_elements(p_codes) e)<>p_count then raise exception 'Invalid short code manifest' using errcode='22023';end if;
    if(select count(distinct e->>'hash') from jsonb_array_elements(p_codes) e)<>p_count then raise exception 'invox_code_collision';end if;
    for v_item in select value from jsonb_array_elements(p_codes) order by value->>'id' loop
      perform pg_advisory_xact_lock(hashtextextended('invox-code-create:'||(v_item->>'id'),0));
    end loop;
    if exists(select 1 from public.invox_download_codes c join jsonb_array_elements(p_codes) e on c.id=(e->>'id')::uuid) then raise exception 'invox_code_creation_conflict';end if;
    if exists(select 1 from public.invox_download_codes c join jsonb_array_elements(p_codes) e on c.code_hash=e->>'hash') then raise exception 'invox_code_collision';end if;
    v_now:=clock_timestamp();
    insert into public.invox_download_code_batches(id,label,code_count,max_uses,valid_for_hours,code_manifest,created_at,created_by)
      values(p_id,p_label,p_count,p_max_uses,p_valid_for_hours,p_codes,v_now,p_admin_id) returning * into b;
    begin
      insert into public.invox_download_codes(id,code_hash,label,max_uses,valid_for_hours,created_at,expires_at,created_by,code_format,derivation_nonce)
      select e.id,e.hash,p_label,p_max_uses,p_valid_for_hours,v_now,case when p_valid_for_hours is not null then v_now+make_interval(hours=>p_valid_for_hours) else null end,p_admin_id,1,e.nonce
      from jsonb_to_recordset(p_codes) as e(id uuid,hash text,nonce integer);
    exception when unique_violation then raise exception 'invox_code_collision';end;
  end if;
  return jsonb_build_object('metadata',public.invox_batch_secret_metadata(b),'downloadCodes',public.invox_download_codes_list(p_admin_id));
end; $$;
create function public.invox_admin_code_pool(p_admin_id uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare v_valid jsonb;v_used jsonb;v_inactive jsonb;v_legacy jsonb;v_totals jsonb;
begin
  perform public.invox_multipart_admin(p_admin_id);
  with selected as(select c as entry from public.invox_download_codes c where code_format=1 and used_count=0 and revoked_at is null
    and(expires_at is null or expires_at>statement_timestamp()) order by created_at,id limit 100)
    select coalesce(jsonb_agg(public.invox_code_secret_metadata(entry) order by(entry).created_at,(entry).id),'[]'::jsonb) into v_valid from selected;
  with selected as(select c as entry from public.invox_download_codes c where code_format=1 and used_count>0 order by created_at desc,id desc limit 100)
    select coalesce(jsonb_agg(public.invox_code_secret_metadata(entry) order by(entry).created_at desc,(entry).id desc),'[]'::jsonb) into v_used from selected;
  with selected as(select c as entry from public.invox_download_codes c where code_format=1 and used_count=0 and(revoked_at is not null or expires_at<=statement_timestamp()) order by created_at desc,id desc limit 100)
    select coalesce(jsonb_agg(public.invox_code_secret_metadata(entry) order by(entry).created_at desc,(entry).id desc),'[]'::jsonb) into v_inactive from selected;
  with selected as(select c as entry from public.invox_download_codes c where code_format=0 order by created_at desc,id desc limit 100)
    select coalesce(jsonb_agg(public.invox_download_code_output(entry) order by(entry).created_at desc,(entry).id desc),'[]'::jsonb) into v_legacy from selected;
  select jsonb_build_object('valid',count(*) filter(where code_format=1 and used_count=0 and revoked_at is null and(expires_at is null or expires_at>statement_timestamp())),
    'used',count(*) filter(where code_format=1 and used_count>0),'inactive',count(*) filter(where code_format=1 and used_count=0 and(revoked_at is not null or expires_at<=statement_timestamp())),
    'legacy',count(*) filter(where code_format=0)) into v_totals from public.invox_download_codes;
  return jsonb_build_object('valid',v_valid,'used',v_used,'inactive',v_inactive,'legacy',v_legacy,'totals',v_totals,'evaluatedAt',statement_timestamp());
end; $$;
create function public.invox_select_copy_download_codes(p_admin_id uuid,p_count integer,p_exclude_ids uuid[] default '{}') returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare v_selected jsonb;v_available bigint;v_total bigint;
begin
  perform public.invox_multipart_admin(p_admin_id);
  if p_count is null or p_count not between 1 and 100 or p_exclude_ids is null or cardinality(p_exclude_ids)>500 or array_position(p_exclude_ids,null) is not null then
    raise exception 'Invalid code selection' using errcode='22023';end if;
  select count(*),count(*) filter(where not(id=any(p_exclude_ids))) into v_total,v_available from public.invox_download_codes
    where code_format=1 and used_count=0 and revoked_at is null and(expires_at is null or expires_at>statement_timestamp());
  with selected as(select c as entry from public.invox_download_codes c where code_format=1 and used_count=0 and revoked_at is null
    and(expires_at is null or expires_at>statement_timestamp()) and not(id=any(p_exclude_ids)) order by created_at,id limit p_count)
    select coalesce(jsonb_agg(public.invox_code_secret_metadata(entry) order by(entry).created_at,(entry).id),'[]'::jsonb) into v_selected from selected;
  return jsonb_build_object('metadata',v_selected,'evaluatedAt',statement_timestamp(),'availableCount',v_available,'totalEligible',v_total);
end; $$;
do $$ declare f regprocedure;begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(array[
    'invox_download_code_output','invox_code_secret_metadata','invox_lookup_code_creation','invox_batch_secret_metadata','invox_lookup_code_batch',
    'invox_create_short_code','invox_create_short_codes','invox_admin_code_pool','invox_select_copy_download_codes']) loop
    execute format('revoke all on function %s from public,anon,authenticated',f);
    execute format('grant execute on function %s to service_role',f);
  end loop;
end; $$;
commit;
