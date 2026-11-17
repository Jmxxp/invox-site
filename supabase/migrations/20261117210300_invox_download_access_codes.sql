-- Universal grants and bounded-use codes authorize distinct logical downloads.
begin;
alter table public.invox_site_settings
  add column download_universal_enabled boolean not null default true,
  add column download_mode_generation bigint not null default 1 check(download_mode_generation>0),
  drop constraint invox_private_requires_password;
alter table public.invox_site_settings add constraint invox_private_access_gate check(
  visibility<>'private' or not download_universal_enabled or coalesce(char_length(download_password_hash),0)>=32);
create or replace function public.invox_bump_download_access() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if new.visibility is distinct from old.visibility then new.download_mode_generation:=old.download_mode_generation+1;end if;
  if new.visibility is distinct from old.visibility or new.download_password_hash is distinct from old.download_password_hash
    or new.download_universal_enabled is distinct from old.download_universal_enabled then
    new.download_access_generation:=old.download_access_generation+1;
  end if;
  return new;
end; $$;
drop trigger invox_download_access_revision on public.invox_site_settings;
create trigger invox_download_access_revision before update of visibility,download_password_hash,download_universal_enabled on public.invox_site_settings
for each row execute function public.invox_bump_download_access();
alter table public.invox_download_sessions add column access_generation bigint;
update public.invox_download_sessions set access_generation=(select download_access_generation from public.invox_site_settings where id=true);
alter table public.invox_download_sessions alter column access_generation set not null;
alter table public.invox_download_sessions add constraint invox_session_generation_check check(access_generation>0);
create function public.invox_issue_universal_session(p_token_hash text,p_password_fingerprint text,p_access_generation bigint) returns timestamptz
language plpgsql security invoker set search_path='' as $$
declare s public.invox_site_settings%rowtype;v_now timestamptz:=clock_timestamp();v_expiry timestamptz:=v_now+interval '30 days';
begin
  if p_token_hash is null or p_token_hash!~'^[a-f0-9]{64}$' or p_password_fingerprint is null or p_password_fingerprint!~'^[a-f0-9]{64}$' then
    raise exception 'Invalid session hashes' using errcode='22023';end if;
  select * into strict s from public.invox_site_settings where id=true for share;
  if s.visibility<>'private' or not s.download_universal_enabled or s.download_access_generation is distinct from p_access_generation then
    raise exception 'invox_universal_changed';end if;
  insert into public.invox_download_sessions(token_hash,password_fingerprint,access_generation,created_at,expires_at)
    values(p_token_hash,p_password_fingerprint,p_access_generation,v_now,v_expiry);
  delete from public.invox_download_sessions where token_hash in(select token_hash from public.invox_download_sessions where expires_at<=v_now order by expires_at limit 1000);
  return v_expiry;
end; $$;
create or replace function public.invox_create_download_session(p_token_hash text,p_password_fingerprint text) returns timestamptz
language plpgsql security invoker set search_path='' as $$
begin return public.invox_issue_universal_session(p_token_hash,p_password_fingerprint,(select download_access_generation from public.invox_site_settings where id=true));end; $$;
create function public.invox_authorize_universal_legacy(p_access_generation bigint,p_platform text) returns boolean
language plpgsql security invoker set search_path='' as $$
declare s public.invox_site_settings%rowtype;
begin
  select * into strict s from public.invox_site_settings where id=true for share;
  if s.visibility<>'private' or not s.download_universal_enabled or s.download_access_generation is distinct from p_access_generation then raise exception 'invox_universal_changed';end if;
  return public.invox_record_analytics('download',null,p_platform);
end; $$;
create table public.invox_download_codes(
  id uuid primary key,code_hash text not null unique check(code_hash~'^[a-f0-9]{64}$'),
  label text not null default '' check(char_length(label)<=80 and label=btrim(label) and label!~'[[:cntrl:]]'),
  max_uses integer not null check(max_uses between 1 and 1000),used_count integer not null default 0 check(used_count>=0 and used_count<=max_uses),
  valid_for_hours integer check(valid_for_hours between 1 and 8760),created_at timestamptz not null,expires_at timestamptz,revoked_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  check((valid_for_hours is null and expires_at is null) or(valid_for_hours is not null and expires_at>created_at))
);
create index invox_download_codes_recent_idx on public.invox_download_codes(created_at desc,id desc);
alter table public.invox_download_codes enable row level security;
revoke all on public.invox_download_codes from public,anon,authenticated,service_role;
grant select,insert,update on public.invox_download_codes to service_role;
create function public.invox_download_code_output(p_code public.invox_download_codes) returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('id',p_code.id,'label',p_code.label,'maxUses',p_code.max_uses,'usedCount',p_code.used_count,
    'remainingUses',greatest(0,p_code.max_uses-p_code.used_count),'createdAt',p_code.created_at,'expiresAt',p_code.expires_at,'revokedAt',p_code.revoked_at,
    'status',case when p_code.revoked_at is not null then 'revoked' when p_code.expires_at<=statement_timestamp() then 'expired'
      when p_code.used_count>=p_code.max_uses then 'exhausted' else 'active' end);
$$;
create function public.invox_download_codes_list(p_admin_id uuid,p_limit integer default 100) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare v_result jsonb;
begin
  perform public.invox_multipart_admin(p_admin_id);
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'Invalid code list limit' using errcode='22023';end if;
  with selected as(select c as entry from public.invox_download_codes c order by created_at desc,id desc limit p_limit)
  select coalesce(jsonb_agg(public.invox_download_code_output(entry) order by(entry).created_at desc,(entry).id desc),'[]'::jsonb) into v_result from selected;
  return v_result;
end; $$;
create function public.invox_create_download_code(p_admin_id uuid,p_id uuid,p_code_hash text,p_label text,p_max_uses integer,p_valid_for_hours integer default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare c public.invox_download_codes%rowtype;v_now timestamptz;
begin
  perform public.invox_multipart_admin(p_admin_id);
  if p_id is null or p_code_hash is null or p_code_hash!~'^[a-f0-9]{64}$' or p_label is null or char_length(p_label)>80 or p_label<>btrim(p_label) or p_label~'[[:cntrl:]]'
    or p_max_uses is null or p_max_uses not between 1 and 1000 or(p_valid_for_hours is not null and p_valid_for_hours not between 1 and 8760) then
    raise exception 'Invalid download code' using errcode='22023';end if;
  perform pg_advisory_xact_lock(hashtextextended('invox-code-create:'||p_id::text,0));
  select * into c from public.invox_download_codes where id=p_id for update;
  if found then
    if c.code_hash is distinct from p_code_hash or c.label is distinct from p_label or c.max_uses is distinct from p_max_uses or c.valid_for_hours is distinct from p_valid_for_hours then
      raise exception 'invox_code_creation_conflict';end if;
  else
    v_now:=clock_timestamp();
    insert into public.invox_download_codes(id,code_hash,label,max_uses,valid_for_hours,created_at,expires_at,created_by)
      values(p_id,p_code_hash,p_label,p_max_uses,p_valid_for_hours,v_now,case when p_valid_for_hours is not null then v_now+make_interval(hours=>p_valid_for_hours) else null end,p_admin_id)
      returning * into c;
  end if;
  return jsonb_build_object('entry',public.invox_download_code_output(c),'downloadCodes',public.invox_download_codes_list(p_admin_id));
end; $$;
create function public.invox_revoke_download_code(p_admin_id uuid,p_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
begin
  perform public.invox_multipart_admin(p_admin_id);
  update public.invox_download_codes set revoked_at=coalesce(revoked_at,clock_timestamp()) where id=p_id;
  if not found then raise exception 'Download code not found' using errcode='P0002';end if;
  return jsonb_build_object('downloadCodes',public.invox_download_codes_list(p_admin_id));
end; $$;
create function invox_private.notify_download_codes() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='INSERT' or row(new.used_count,new.revoked_at) is distinct from row(old.used_count,old.revoked_at) then
    perform invox_private.emit_invalidation('settings');end if;
  return null;
end; $$;
create trigger invox_download_codes_realtime after insert or update on public.invox_download_codes
for each row execute function invox_private.notify_download_codes();
create table public.invox_code_downloads(
  id uuid primary key,code_id uuid not null references public.invox_download_codes(id),
  platform text not null check(platform in('windows','macos','android')),
  installer jsonb not null check(jsonb_typeof(installer)='object' and installer->>'platform'=platform),
  mode_generation bigint not null check(mode_generation>0),
  created_at timestamptz not null,expires_at timestamptz not null,
  ticket_hash text unique check(ticket_hash~'^[a-f0-9]{64}$'),
  check(expires_at>created_at and expires_at<=created_at+interval '8 hours')
);
create index invox_code_downloads_code_idx on public.invox_code_downloads(code_id,created_at desc);
alter table public.invox_code_downloads enable row level security;
revoke all on public.invox_code_downloads from public,anon,authenticated,service_role;
grant select,insert on public.invox_code_downloads to service_role;
alter table public.invox_multipart_downloads
  add column auth_source text not null default 'standard' check(auth_source in('standard','code')),
  add column mode_generation bigint,
  add column code_attempt_id uuid references public.invox_code_downloads(id),
  add constraint invox_multipart_authorization_kind check((auth_source='standard' and code_attempt_id is null)
    or(auth_source='code' and code_attempt_id is not null and mode_generation is not null and mode_generation>0));

create function public.invox_code_download_result(p_attempt public.invox_code_downloads) returns jsonb
language sql stable security invoker set search_path='' as $$
  select case when p_attempt.installer->>'multipart_upload_id' is not null then
    jsonb_build_object('kind','multipart','fileName',p_attempt.installer->>'file_name','size',(p_attempt.installer->>'size')::bigint,
      'sha256',p_attempt.installer->>'sha256','expiresAt',p_attempt.expires_at,
      'parts',(select jsonb_agg(jsonb_build_object('index',part_index,'size',size,'sha256',sha256) order by part_index)
        from public.invox_multipart_parts where upload_id=(p_attempt.installer->>'multipart_upload_id')::uuid))
  else jsonb_build_object('kind','legacy','fileName',p_attempt.installer->>'file_name','expiresAt',p_attempt.expires_at) end;
$$;
create function public.invox_prepare_code_download(p_code_hash text,p_request_id uuid,p_platform text) returns jsonb
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
create function public.invox_commit_code_download(p_code_hash text,p_request_id uuid,p_platform text,p_mode_generation bigint,p_installer jsonb,p_ticket_hash text default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare s public.invox_site_settings%rowtype;c public.invox_download_codes%rowtype;a public.invox_code_downloads%rowtype;i jsonb;v_now timestamptz;v_minted jsonb;
begin
  if p_code_hash is null or p_code_hash!~'^[a-f0-9]{64}$' or p_request_id is null or p_platform is null or p_platform not in('windows','macos','android')
    or p_mode_generation is null or p_installer is null or jsonb_typeof(p_installer)<>'object' then raise exception 'Invalid code download' using errcode='22023';end if;
  select * into strict s from public.invox_site_settings where id=true for share;
  if s.visibility<>'private' or s.download_mode_generation<>p_mode_generation then raise exception 'invox_download_mode_changed';end if;
  perform pg_advisory_xact_lock(hashtextextended('invox-code-attempt:'||p_request_id::text,0));
  select * into c from public.invox_download_codes where code_hash=p_code_hash for update;
  if not found then raise exception 'invox_invalid_code';end if;
  select * into a from public.invox_code_downloads where id=p_request_id;
  if found then
    if a.code_id<>c.id or a.platform<>p_platform or a.installer is distinct from p_installer then raise exception 'invox_code_attempt_conflict';end if;
    if a.expires_at<=clock_timestamp() or a.mode_generation<>s.download_mode_generation then raise exception 'invox_download_ticket_expired';end if;
    if a.ticket_hash is distinct from p_ticket_hash then raise exception 'invox_code_attempt_conflict';end if;
    return public.invox_code_download_result(a);
  end if;
  if c.revoked_at is not null then raise exception 'invox_code_revoked';end if;
  if c.expires_at<=clock_timestamp() then raise exception 'invox_code_expired';end if;
  if c.used_count>=c.max_uses then raise exception 'invox_code_exhausted';end if;
  select jsonb_build_object('platform',platform,'path',path,'file_name',file_name,'size',size,'version',version,
    'multipart_upload_id',multipart_upload_id,'sha256',sha256) into i from public.invox_installers where platform=p_platform for share;
  if i is null then raise exception 'Installer unavailable' using errcode='P0002';end if;
  if i is distinct from p_installer then raise exception 'invox_download_changed';end if;
  if i->>'multipart_upload_id' is not null then
    if p_ticket_hash is null or p_ticket_hash!~'^[a-f0-9]{64}$' or not public.invox_multipart_complete((i->>'multipart_upload_id')::uuid) then
      raise exception 'Installer unavailable' using errcode='P0002';end if;
  else
    if p_ticket_hash is not null then raise exception 'Invalid legacy ticket' using errcode='22023';end if;
    perform id from storage.objects where bucket_id='invox-installers' and name=i->>'path' and(metadata->>'size')::bigint=(i->>'size')::bigint for share;
    if not found then raise exception 'Installer unavailable' using errcode='P0002';end if;
  end if;
  v_now:=clock_timestamp();
  insert into public.invox_code_downloads(id,code_id,platform,installer,mode_generation,created_at,expires_at,ticket_hash)
    values(p_request_id,c.id,p_platform,i,s.download_mode_generation,v_now,v_now+interval '8 hours',p_ticket_hash) returning * into a;
  if i->>'multipart_upload_id' is not null then
    v_minted:=public.invox_mint_multipart_download((i->>'multipart_upload_id')::uuid,p_ticket_hash,s.download_access_generation,false,null);
    update public.invox_multipart_downloads set auth_source='code',mode_generation=s.download_mode_generation,code_attempt_id=p_request_id where token_hash=p_ticket_hash;
  else
    if not public.invox_record_analytics('download',null,p_platform) then raise exception 'Code download counter unavailable';end if;
  end if;
  update public.invox_download_codes set used_count=used_count+1 where id=c.id;
  return public.invox_code_download_result(a);
end; $$;
create function public.invox_multipart_ticket_valid(p_ticket public.invox_multipart_downloads) returns boolean
language plpgsql stable security invoker set search_path='' as $$
declare s public.invox_site_settings%rowtype;v_status text;
begin
  if p_ticket.token_hash is null or p_ticket.expires_at<=statement_timestamp() then return false;end if;
  select * into strict s from public.invox_site_settings where id=true;
  if p_ticket.auth_source='code' then
    if s.visibility<>'private' or p_ticket.mode_generation is distinct from s.download_mode_generation or not exists(
      select 1 from public.invox_code_downloads a where a.id=p_ticket.code_attempt_id and a.ticket_hash=p_ticket.token_hash
      and a.mode_generation=s.download_mode_generation and a.expires_at>statement_timestamp()
      and(a.installer->>'multipart_upload_id')::uuid=p_ticket.upload_id) then return false;end if;
  elsif p_ticket.access_generation is distinct from s.download_access_generation then return false;end if;
  select status into v_status from public.invox_multipart_uploads where id=p_ticket.upload_id;
  return case when p_ticket.is_preview then v_status='ready' and exists(select 1 from public.invox_admins where user_id=p_ticket.created_by and enabled)
    else v_status in('published','retired') end;
end; $$;
create or replace function public.invox_download_multipart_part(p_token_hash text,p_index integer) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare t public.invox_multipart_downloads%rowtype;v_part jsonb;
begin
  select * into t from public.invox_multipart_downloads where token_hash=p_token_hash;
  if not public.invox_multipart_ticket_valid(t) then raise exception 'invox_download_ticket_expired';end if;
  select jsonb_build_object('uploadId',t.upload_id,'path',p.path,'index',p.part_index,'size',p.size,'sha256',p.sha256) into v_part
    from public.invox_multipart_parts p join storage.objects o on o.bucket_id='invox-installer-parts' and o.name=p.path
    where p.upload_id=t.upload_id and p.part_index=p_index and p.verified_at is not null and p.verified_sha256=p.sha256
      and o.id=p.verified_object_id and o.version=p.verified_object_version and(o.metadata->>'size')::bigint=p.size;
  if v_part is null then raise exception 'Installer part unavailable' using errcode='P0002';end if;
  return v_part;
end; $$;
create or replace function public.invox_count_multipart_download(p_token_hash text) returns boolean
language plpgsql security invoker set search_path='' as $$
declare t public.invox_multipart_downloads%rowtype;v_platform text;
begin
  perform id from public.invox_site_settings where id=true for share;
  select * into t from public.invox_multipart_downloads where token_hash=p_token_hash for update;
  if not public.invox_multipart_ticket_valid(t) then raise exception 'invox_download_ticket_expired';end if;
  if t.counted_at is null then
    select platform into strict v_platform from public.invox_multipart_uploads where id=t.upload_id;
    if not t.is_preview and not public.invox_record_analytics('download',null,v_platform) then raise exception 'Download counter unavailable';end if;
    update public.invox_multipart_downloads set counted_at=clock_timestamp() where token_hash=p_token_hash;
  end if;
  return true;
end; $$;
create or replace function invox_private.notify_settings() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='UPDATE' then
    if row(new.visibility,new.download_password_hash,new.download_universal_enabled,new.version,new.release_notes)
      is distinct from row(old.visibility,old.download_password_hash,old.download_universal_enabled,old.version,old.release_notes) then
      perform invox_private.emit_invalidation('settings',true);end if;
    if row(new.analytics_generation,new.analytics_started_at) is distinct from row(old.analytics_generation,old.analytics_started_at) then
      perform invox_private.emit_invalidation('analytics');end if;
  else
    perform invox_private.emit_invalidation('settings',true);perform invox_private.emit_invalidation('analytics');
  end if;
  return null;
end; $$;
do $$ declare f regprocedure;begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(array[
    'invox_bump_download_access','invox_issue_universal_session','invox_authorize_universal_legacy','invox_create_download_session','invox_download_code_output','invox_download_codes_list',
    'invox_create_download_code','invox_revoke_download_code','invox_code_download_result','invox_prepare_code_download','invox_commit_code_download',
    'invox_multipart_ticket_valid','invox_download_multipart_part','invox_count_multipart_download']) loop
    execute format('revoke all on function %s from public,anon,authenticated',f);
    execute format('grant execute on function %s to service_role',f);
  end loop;
end; $$;
revoke all on function invox_private.notify_download_codes() from public,anon,authenticated;
grant execute on function invox_private.notify_download_codes() to service_role;
commit;
