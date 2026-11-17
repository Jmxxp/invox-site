-- Explicit replacement pauses one revision; bytes are released via Storage API.
begin;
alter table public.invox_multipart_uploads add column storage_released_at timestamptz;
create table public.invox_installer_replacements(
  history_id uuid primary key references public.invox_installer_history(id),
  platform text not null check(platform in('windows','macos','android')),
  kind text not null check(kind in('legacy','multipart')),path text,upload_id uuid references public.invox_multipart_uploads(id),
  file_name text not null,size bigint not null check(size>0),
  replacement_file_name text not null,replacement_size bigint not null check(replacement_size between 1 and 1610612736),replacement_version text not null,
  reservation_bytes bigint not null check(reservation_bytes>0),started_at timestamptz not null,cleanup_after timestamptz not null,
  completed_at timestamptz,released_bytes bigint not null default 0 check(released_bytes>=0),created_by uuid references auth.users(id) on delete set null,
  check((kind='legacy' and path is not null and upload_id is null) or(kind='multipart' and path is null and upload_id is not null))
);
alter table public.invox_installer_replacements enable row level security;
revoke all on public.invox_installer_replacements from public,anon,authenticated,service_role;
grant select,insert,update on public.invox_installer_replacements to service_role;
create function public.invox_installer_replacement_output(p_job public.invox_installer_replacements) returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('platform',p_job.platform,'historyId',p_job.history_id,'fileName',p_job.file_name,'size',p_job.size,'kind',p_job.kind,
    'startedAt',p_job.started_at,'completedAt',p_job.completed_at,'replacement',jsonb_build_object('fileName',p_job.replacement_file_name,'size',p_job.replacement_size,'version',p_job.replacement_version));
$$;
create function public.invox_installer_replacement_plan(p_job public.invox_installer_replacements) returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('replacement',public.invox_installer_replacement_output(p_job),'releasedBytes',p_job.released_bytes,
    'replacementPending',p_job.completed_at is null,'bucket',case when p_job.kind='multipart' then 'invox-installer-parts' else 'invox-installers' end,
    'uploadId',p_job.upload_id,'paths',case when p_job.kind='multipart' then coalesce((select jsonb_agg(path order by part_index) from public.invox_multipart_parts where upload_id=p_job.upload_id),'[]'::jsonb)
      else jsonb_build_array(p_job.path) end);
$$;
create or replace function public.invox_storage_status(p_budget_bytes bigint) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare v_used bigint;v_reserved bigint;v_cleanup bigint;
begin
  if p_budget_bytes is null or p_budget_bytes not between 1 and 9007199254740991 then raise exception 'Invalid storage budget' using errcode='22023';end if;
  if exists(select 1 from storage.objects where metadata->>'size' is null or metadata->>'size'!~'^[0-9]{1,16}$') then raise exception 'Storage accounting unavailable';end if;
  select coalesce(sum((metadata->>'size')::bigint),0) into v_used from storage.objects;
  with reserved_paths as(
    select 'invox-installer-parts'::text bucket,p.path,20971520::bigint capacity,u.status in('cancelled','retired') cleanup
    from public.invox_multipart_parts p join public.invox_multipart_uploads u on u.id=p.upload_id where u.status<>'purged' and u.storage_released_at is null
    union all
    select 'invox-installers',u.path,52428800::bigint,false from public.invox_uploads u where u.created_at>statement_timestamp()-interval '25 hours'
  ) select coalesce(sum(greatest(r.capacity-coalesce((o.metadata->>'size')::bigint,0),0)),0),
    coalesce(sum(case when r.cleanup then greatest(r.capacity,coalesce((o.metadata->>'size')::bigint,0)) else 0 end),0)
    into v_reserved,v_cleanup from reserved_paths r left join storage.objects o on o.bucket_id=r.bucket and o.name=r.path;
  return jsonb_build_object('capacityBytes',p_budget_bytes,'usedBytes',v_used,'reservedBytes',v_reserved,
    'availableBytes',greatest(p_budget_bytes-v_used-v_reserved,0),'cleanupPendingBytes',v_cleanup);
end; $$;
create function public.invox_prepare_installer_replacement(p_admin_id uuid,p_platform text,p_history_id uuid,p_file_name text,p_size bigint,p_version text,p_budget_bytes bigint) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare i public.invox_installers%rowtype;u public.invox_multipart_uploads%rowtype;j public.invox_installer_replacements%rowtype;
  q jsonb;v_required bigint;v_reclaim bigint;v_count bigint;v_after timestamptz;v_now timestamptz:=clock_timestamp();
begin
  perform public.invox_multipart_admin(p_admin_id);
  if p_platform is null or p_platform not in('windows','macos','android') or p_history_id is null or p_file_name is null or char_length(p_file_name) not between 1 and 180 or p_file_name~'[\\/[:cntrl:]]'
    or p_size is null or p_size not between 1 and 1610612736 or p_version is null or char_length(p_version)>64 or p_version!~'^[0-9]+\.[0-9]+\.[0-9]+([-+][0-9A-Za-z.-]+)*$'
    or not((p_platform='windows' and p_file_name~*'\.(exe|msi|zip)$') or(p_platform='macos' and p_file_name~*'\.(dmg|pkg|zip)$') or(p_platform='android' and p_file_name~*'\.apk$')) then
    raise exception 'Invalid replacement' using errcode='22023';end if;
  perform id from public.invox_site_settings where id=true for update;
  perform pg_advisory_xact_lock(hashtextextended('invox-installer-quota',0));
  select * into j from public.invox_installer_replacements where history_id=p_history_id for update;
  if found then
    if j.platform is distinct from p_platform or j.replacement_file_name is distinct from p_file_name or j.replacement_size is distinct from p_size or j.replacement_version is distinct from p_version then raise exception 'invox_replacement_conflict';end if;
    return public.invox_installer_replacement_plan(j);
  end if;
  select * into i from public.invox_installers where platform=p_platform for update;
  if not found or i.current_history_id is distinct from p_history_id then raise exception 'invox_installer_changed';end if;
  q:=public.invox_storage_status(p_budget_bytes);
  v_required:=case when p_size>52428800 then((p_size+20971519)/20971520)*20971520 else 52428800 end;
  if i.multipart_upload_id is not null then
    select * into strict u from public.invox_multipart_uploads where id=i.multipart_upload_id for update;
    if u.status<>'published' or u.storage_released_at is not null then raise exception 'invox_installer_changed';end if;
    select count(*),coalesce(sum(greatest(20971520,coalesce((o.metadata->>'size')::bigint,0))),0) into v_count,v_reclaim
      from public.invox_multipart_parts p left join storage.objects o on o.bucket_id='invox-installer-parts' and o.name=p.path where p.upload_id=u.id;
    v_after:=greatest(v_now+interval '5 minutes',coalesce(u.last_ticket_at,u.created_at)+interval '25 hours');
  else
    v_count:=1;
    select greatest(coalesce((select(metadata->>'size')::bigint from storage.objects where bucket_id='invox-installers' and name=i.path),0),
      case when exists(select 1 from public.invox_uploads where path=i.path and created_at>statement_timestamp()-interval '25 hours') then 52428800 else 0 end) into v_reclaim;
    v_after:=greatest(v_now+interval '5 minutes',coalesce((select created_at from public.invox_uploads where path=i.path),v_now)+interval '25 hours');
  end if;
  if v_count<1 or p_budget_bytes-(q->>'usedBytes')::bigint-(q->>'reservedBytes')::bigint+v_reclaim-v_count<v_required then raise exception 'invox_storage_quota_exceeded';end if;
  insert into public.invox_installer_replacements(history_id,platform,kind,path,upload_id,file_name,size,replacement_file_name,replacement_size,replacement_version,reservation_bytes,started_at,cleanup_after,created_by)
    values(i.current_history_id,i.platform,case when i.multipart_upload_id is null then 'legacy' else 'multipart' end,i.path,i.multipart_upload_id,i.file_name,i.size,p_file_name,p_size,p_version,v_required,v_now,v_after,p_admin_id) returning * into j;
  delete from public.invox_installers where platform=i.platform and current_history_id=p_history_id;
  if i.multipart_upload_id is not null then update public.invox_multipart_uploads set status='cancelled',cleanup_after=v_after,updated_at=v_now where id=i.multipart_upload_id;
  else delete from public.invox_uploads where path=i.path;end if;
  return public.invox_installer_replacement_plan(j);
end; $$;
create function public.invox_finish_installer_replacement(p_admin_id uuid,p_history_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare j public.invox_installer_replacements%rowtype;v_paths jsonb;v_count bigint;
begin
  perform public.invox_multipart_admin(p_admin_id);
  perform pg_advisory_xact_lock(hashtextextended('invox-installer-quota',0));
  select * into strict j from public.invox_installer_replacements where history_id=p_history_id for update;
  if j.completed_at is not null then return public.invox_installer_replacement_plan(j);end if;
  if exists(select 1 from public.invox_installers where multipart_upload_id=j.upload_id or path=j.path) then raise exception 'invox_installer_changed';end if;
  v_paths:=public.invox_installer_replacement_plan(j)->'paths';v_count:=jsonb_array_length(v_paths);
  if v_count<1 or exists(select 1 from jsonb_array_elements_text(v_paths) p left join storage.objects o
    on o.bucket_id=case when j.kind='multipart' then 'invox-installer-parts' else 'invox-installers' end and o.name=p.value
    where o.id is null or(o.metadata->>'size')::bigint is distinct from 1) then return public.invox_installer_replacement_plan(j);end if;
  if j.upload_id is not null then update public.invox_multipart_uploads set storage_released_at=clock_timestamp(),updated_at=clock_timestamp() where id=j.upload_id and status='cancelled';end if;
  update public.invox_installer_replacements set completed_at=clock_timestamp(),released_bytes=greatest(size-v_count,0) where history_id=p_history_id returning * into j;
  return public.invox_installer_replacement_plan(j);
end; $$;
create function public.invox_installer_replacements_list(p_admin_id uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare v_result jsonb;
begin
  perform public.invox_multipart_admin(p_admin_id);
  select coalesce(jsonb_agg(public.invox_installer_replacement_output(j) order by(j.completed_at is not null),j.started_at desc),'[]'::jsonb) into v_result
    from(select * from public.invox_installer_replacements order by(completed_at is not null),started_at desc limit 20)j;
  return v_result;
end; $$;
create function public.invox_assert_code_installer(p_installer jsonb) returns void
language plpgsql stable security invoker set search_path='' as $$
begin
  if exists(select 1 from public.invox_installer_replacements where upload_id=(p_installer->>'multipart_upload_id')::uuid or path=p_installer->>'path') then raise exception 'invox_download_ticket_expired';end if;
  if p_installer->>'multipart_upload_id' is not null then
    if not exists(select 1 from public.invox_multipart_uploads where id=(p_installer->>'multipart_upload_id')::uuid and status in('published','retired'))
      or not public.invox_multipart_complete((p_installer->>'multipart_upload_id')::uuid) then raise exception 'invox_download_ticket_expired';end if;
  elsif not exists(select 1 from storage.objects where bucket_id='invox-installers' and name=p_installer->>'path' and(metadata->>'size')::bigint=(p_installer->>'size')::bigint) then raise exception 'invox_download_ticket_expired';end if;
end; $$;
create or replace function public.invox_code_download_result(p_attempt public.invox_code_downloads) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
begin
  perform public.invox_assert_code_installer(p_attempt.installer);
  return case when p_attempt.installer->>'multipart_upload_id' is not null then
    jsonb_build_object('kind','multipart','fileName',p_attempt.installer->>'file_name','size',(p_attempt.installer->>'size')::bigint,
      'sha256',p_attempt.installer->>'sha256','expiresAt',p_attempt.expires_at,
      'parts',(select jsonb_agg(jsonb_build_object('index',part_index,'size',size,'sha256',sha256) order by part_index)
        from public.invox_multipart_parts where upload_id=(p_attempt.installer->>'multipart_upload_id')::uuid))
    else jsonb_build_object('kind','legacy','fileName',p_attempt.installer->>'file_name','expiresAt',p_attempt.expires_at) end;
end; $$;

create or replace function public.invox_prepare_code_download(p_code_hash text,p_request_id uuid,p_platform text) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare s public.invox_site_settings%rowtype;c public.invox_download_codes%rowtype;a public.invox_code_downloads%rowtype;i jsonb;p jsonb;
begin
  if p_code_hash is null or p_code_hash!~'^[a-f0-9]{64}$' or p_request_id is null or p_platform is null or p_platform not in('windows','macos','android') then
    raise exception 'Invalid code download' using errcode='22023';end if;
  select * into strict s from public.invox_site_settings where id=true;
  if s.visibility<>'private' then raise exception 'invox_download_mode_changed';end if;
  select * into c from public.invox_download_codes where code_hash=p_code_hash;
  if not found then raise exception 'invox_invalid_code';end if;
  select * into a from public.invox_code_downloads where id=p_request_id;
  if found then
    if a.code_id<>c.id or a.platform<>p_platform then raise exception 'invox_code_attempt_conflict';end if;
    if a.expires_at<=statement_timestamp() or a.mode_generation<>s.download_mode_generation then raise exception 'invox_download_ticket_expired';end if;
    i:=a.installer;
    perform public.invox_assert_code_installer(i);
  else
    if c.revoked_at is not null then raise exception 'invox_code_revoked';end if;
    if c.expires_at<=statement_timestamp() then raise exception 'invox_code_expired';end if;
    if c.used_count>=c.max_uses then raise exception 'invox_code_exhausted';end if;
    select jsonb_build_object('platform',platform,'path',path,'file_name',file_name,'size',size,'version',version,
      'multipart_upload_id',multipart_upload_id,'sha256',sha256) into i from public.invox_installers where platform=p_platform;
    if i is null then raise exception 'Installer unavailable' using errcode='P0002';end if;
  end if;
  if i->>'multipart_upload_id' is not null then
    select jsonb_build_object('path',path,'index',part_index,'size',size,'sha256',sha256) into p from public.invox_multipart_parts
      where upload_id=(i->>'multipart_upload_id')::uuid and part_index=0;
    if p is null then raise exception 'Installer unavailable' using errcode='P0002';end if;
  end if;
  return jsonb_build_object('committed',a.id is not null,'codeId',c.id,'requestId',p_request_id,'modeGeneration',s.download_mode_generation,
    'installer',i,'firstPart',p,'ticketHash',a.ticket_hash,'expiresAt',a.expires_at);
end; $$;

do $$ declare f regprocedure;begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(array[
    'invox_installer_replacement_output','invox_installer_replacement_plan','invox_prepare_installer_replacement','invox_finish_installer_replacement',
    'invox_installer_replacements_list','invox_assert_code_installer','invox_prepare_code_download','invox_code_download_result','invox_storage_status']) loop
    execute format('revoke all on function %s from public,anon,authenticated',f);
    execute format('grant execute on function %s to service_role',f);
  end loop;
end; $$;
commit;
