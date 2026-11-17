-- Logical installers are immutable ordered objects, never a larger Storage object.
-- Create the private invox-installer-parts bucket through the Storage API with a
-- 20971520-byte object limit. The existing bucket/global limit stays unchanged.
begin;
alter table public.invox_site_settings add column download_access_generation bigint not null default 1 check(download_access_generation>0);
create function public.invox_bump_download_access() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if new.visibility is distinct from old.visibility or new.download_password_hash is distinct from old.download_password_hash then
    new.download_access_generation:=old.download_access_generation+1;
  end if;
  return new;
end; $$;
create trigger invox_download_access_revision before update of visibility,download_password_hash on public.invox_site_settings
for each row execute function public.invox_bump_download_access();
revoke all on function public.invox_bump_download_access() from public,anon,authenticated;

create table public.invox_multipart_uploads(
  id uuid primary key default gen_random_uuid(),
  platform text not null check(platform in('windows','macos','android')),
  file_name text not null check(char_length(file_name) between 1 and 180 and file_name!~'[\\/[:cntrl:]]'),
  size bigint not null check(size between 1 and 1610612736),
  version text not null check(char_length(version) between 1 and 64),
  sha256 text not null check(sha256~'^[a-f0-9]{64}$'),
  manifest_sha256 text not null check(manifest_sha256~'^[a-f0-9]{64}$'),
  created_by uuid not null references auth.users(id),
  status text not null default 'uploading' check(status in('uploading','ready','published','retired','cancelled','purged')),
  created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  last_ticket_at timestamptz,cleanup_after timestamptz,
  check((platform='windows' and file_name~*'\.(exe|msi|zip)$') or(platform='macos' and file_name~*'\.(dmg|pkg|zip)$') or(platform='android' and file_name~*'\.apk$'))
);
create unique index invox_multipart_resume_idx on public.invox_multipart_uploads(created_by,platform,version,file_name,size,sha256,manifest_sha256)
where status in('uploading','ready','published');
create index invox_multipart_cleanup_idx on public.invox_multipart_uploads(cleanup_after) where status in('cancelled','retired');
create table public.invox_multipart_parts(
  upload_id uuid not null references public.invox_multipart_uploads(id),
  part_index integer not null check(part_index between 0 and 76),
  path text not null unique check(path~'^uploads/[a-f0-9-]{36}/[0-9]{3}-[a-f0-9]{64}\.part$'),
  size bigint not null check(size between 1 and 20971520),
  sha256 text not null check(sha256~'^[a-f0-9]{64}$'),
  verified_object_id uuid,verified_object_version text,verified_sha256 text,verified_at timestamptz,
  primary key(upload_id,part_index),
  check((verified_at is null and verified_object_id is null and verified_object_version is null and verified_sha256 is null)
    or(verified_at is not null and verified_object_id is not null and verified_object_version is not null and verified_sha256=sha256))
);
create table public.invox_multipart_downloads(
  token_hash text primary key check(token_hash~'^[a-f0-9]{64}$'),
  upload_id uuid not null references public.invox_multipart_uploads(id),
  access_generation bigint not null check(access_generation>0),
  is_preview boolean not null default false,created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),expires_at timestamptz not null,
  counted_at timestamptz,
  check(expires_at>created_at and expires_at<=created_at+interval '8 hours'),
  check(not is_preview or created_by is not null)
);
create index invox_multipart_downloads_upload_idx on public.invox_multipart_downloads(upload_id,expires_at);
create index invox_multipart_downloads_expiry_idx on public.invox_multipart_downloads(expires_at);
alter table public.invox_multipart_uploads enable row level security;
alter table public.invox_multipart_parts enable row level security;
alter table public.invox_multipart_downloads enable row level security;
revoke all on public.invox_multipart_uploads,public.invox_multipart_parts,public.invox_multipart_downloads from public,anon,authenticated;
grant select,insert,update,delete on public.invox_multipart_uploads,public.invox_multipart_parts,public.invox_multipart_downloads to service_role;
create policy invox_parts_object_guard on storage.objects as restrictive for all to anon,authenticated
using(bucket_id<>'invox-installer-parts') with check(bucket_id<>'invox-installer-parts');
create policy invox_parts_bucket_guard on storage.buckets as restrictive for all to anon,authenticated
using(id<>'invox-installer-parts') with check(id<>'invox-installer-parts');

create function public.invox_multipart_admin(p_admin_id uuid) returns void
language plpgsql stable security invoker set search_path='' as $$
begin
  if p_admin_id is null or not exists(select 1 from public.invox_admins where user_id=p_admin_id and enabled) then
    raise exception 'Administrator required' using errcode='42501';
  end if;
end; $$;
create function public.invox_storage_status(p_budget_bytes bigint) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare v_used bigint;v_reserved bigint;v_cleanup bigint;
begin
  if p_budget_bytes is null or p_budget_bytes not between 1 and 9007199254740991 then raise exception 'Invalid storage budget' using errcode='22023';end if;
  if exists(select 1 from storage.objects where metadata->>'size' is null or metadata->>'size'!~'^[0-9]{1,16}$') then raise exception 'Storage accounting unavailable';end if;
  select coalesce(sum((metadata->>'size')::bigint),0) into v_used from storage.objects;
  with reserved_paths as(
    select 'invox-installer-parts'::text bucket,p.path,20971520::bigint capacity,u.status in('cancelled','retired') cleanup
    from public.invox_multipart_parts p join public.invox_multipart_uploads u on u.id=p.upload_id where u.status<>'purged'
    union all
    select 'invox-installers',u.path,52428800::bigint,false from public.invox_uploads u where u.created_at>pg_catalog.statement_timestamp()-interval '25 hours'
  ) select coalesce(sum(greatest(r.capacity-coalesce((o.metadata->>'size')::bigint,0),0)),0),
    coalesce(sum(case when r.cleanup then greatest(r.capacity,coalesce((o.metadata->>'size')::bigint,0)) else 0 end),0)
    into v_reserved,v_cleanup from reserved_paths r left join storage.objects o on o.bucket_id=r.bucket and o.name=r.path;
  return jsonb_build_object('capacityBytes',p_budget_bytes,'usedBytes',v_used,'reservedBytes',v_reserved,
    'availableBytes',greatest(p_budget_bytes-v_used-v_reserved,0),'cleanupPendingBytes',v_cleanup);
end; $$;
create function public.invox_multipart_complete(p_upload_id uuid) returns boolean
language sql stable security invoker set search_path='' as $$
  select exists(select 1 from public.invox_multipart_uploads u where u.id=p_upload_id
    and(select count(*) from public.invox_multipart_parts p where p.upload_id=u.id)=(u.size+20971519)/20971520)
  and not exists(select 1 from public.invox_multipart_parts p left join storage.objects o
    on o.bucket_id='invox-installer-parts' and o.name=p.path
    where p.upload_id=p_upload_id and(p.verified_at is null or p.verified_sha256 is distinct from p.sha256
      or o.id is distinct from p.verified_object_id or o.version is distinct from p.verified_object_version
      or (o.metadata->>'size')::bigint is distinct from p.size));
$$;

create function public.invox_create_multipart_upload(p_admin_id uuid,p_platform text,p_file_name text,p_size bigint,p_version text,p_sha256 text,p_manifest_sha256 text,p_parts jsonb,p_budget_bytes bigint) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare v_id uuid;v_part jsonb;v_ordinal bigint;v_expected bigint;v_quota jsonb;
begin
  perform public.invox_multipart_admin(p_admin_id);
  if p_platform is null or p_platform not in('windows','macos','android') or p_size is null or p_size not between 1 and 1610612736
    or p_sha256 is null or p_sha256!~'^[a-f0-9]{64}$' or p_manifest_sha256 is null or p_manifest_sha256!~'^[a-f0-9]{64}$'
    or p_parts is null or jsonb_typeof(p_parts)<>'array' or jsonb_array_length(p_parts)<>((p_size+20971519)/20971520) then
    raise exception 'Invalid multipart manifest' using errcode='22023';end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('invox-installer-quota',0));
  select id into v_id from public.invox_multipart_uploads where created_by=p_admin_id and platform=p_platform and file_name=p_file_name and size=p_size and version=p_version
    and sha256=p_sha256 and manifest_sha256=p_manifest_sha256 and status in('uploading','ready','published') for update;
  if v_id is null then
    v_quota:=public.invox_storage_status(p_budget_bytes);
    if (v_quota->>'availableBytes')::bigint<jsonb_array_length(p_parts)::bigint*20971520 then raise exception 'invox_storage_quota_exceeded';end if;
    insert into public.invox_multipart_uploads(platform,file_name,size,version,sha256,manifest_sha256,created_by)
      values(p_platform,p_file_name,p_size,p_version,p_sha256,p_manifest_sha256,p_admin_id) returning id into v_id;
    for v_part,v_ordinal in select value,ordinality from jsonb_array_elements(p_parts) with ordinality loop
      v_expected:=least(20971520,p_size-(v_ordinal-1)*20971520);
      if jsonb_typeof(v_part->'index') is distinct from 'number' or v_part->>'index'!~'^(0|[1-9][0-9]?)$' or(v_part->>'index')::integer<>v_ordinal-1
        or jsonb_typeof(v_part->'size') is distinct from 'number' or v_part->>'size'!~'^[1-9][0-9]{0,7}$' or(v_part->>'size')::bigint<>v_expected
        or jsonb_typeof(v_part->'sha256') is distinct from 'string' or v_part->>'sha256'!~'^[a-f0-9]{64}$' then raise exception 'Invalid multipart part' using errcode='22023';end if;
      insert into public.invox_multipart_parts(upload_id,part_index,path,size,sha256) values(v_id,v_ordinal-1,
        'uploads/'||v_id::text||'/'||pg_catalog.lpad((v_ordinal-1)::text,3,'0')||'-'||(v_part->>'sha256')||'.part',v_expected,v_part->>'sha256');
    end loop;
  end if;
  return jsonb_build_object('uploadId',v_id,'status',(select status from public.invox_multipart_uploads where id=v_id),
    'completedParts',coalesce((select jsonb_agg(p.part_index order by p.part_index) from public.invox_multipart_parts p join storage.objects o
      on o.bucket_id='invox-installer-parts' and o.name=p.path where p.upload_id=v_id and p.verified_at is not null
      and o.id=p.verified_object_id and o.version=p.verified_object_version and(o.metadata->>'size')::bigint=p.size),'[]'::jsonb));
end; $$;

create function public.invox_reserve_single_upload(p_admin_id uuid,p_path text,p_platform text,p_file_name text,p_size bigint,p_version text,p_budget_bytes bigint) returns void
language plpgsql security invoker set search_path='' as $$
declare v_quota jsonb;
begin
  perform public.invox_multipart_admin(p_admin_id);
  if p_size is null or p_size not between 1 and 52428800 then raise exception 'Invalid object size' using errcode='22023';end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('invox-installer-quota',0));
  v_quota:=public.invox_storage_status(p_budget_bytes);
  if(v_quota->>'availableBytes')::bigint<52428800 then raise exception 'invox_storage_quota_exceeded';end if;
  insert into public.invox_uploads(path,platform,file_name,size,version,created_by) values(p_path,p_platform,p_file_name,p_size,p_version,p_admin_id);
end; $$;

create function public.invox_multipart_part(p_admin_id uuid,p_upload_id uuid,p_index integer) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare v_part jsonb;
begin
  perform public.invox_multipart_admin(p_admin_id);
  select to_jsonb(p)||jsonb_build_object('uploadStatus',u.status,'objectId',o.id,'objectVersion',o.version,'objectSize',(o.metadata->>'size')::bigint)
    into v_part from public.invox_multipart_uploads u join public.invox_multipart_parts p on p.upload_id=u.id
    left join storage.objects o on o.bucket_id='invox-installer-parts' and o.name=p.path
    where u.id=p_upload_id and u.created_by=p_admin_id and u.status in('uploading','ready','published') and p.part_index=p_index;
  if v_part is null then raise exception 'Multipart upload unavailable' using errcode='42501';end if;
  return v_part;
end; $$;

create function public.invox_multipart_upload_ticket(p_admin_id uuid,p_upload_id uuid,p_index integer,p_budget_bytes bigint) returns void
language plpgsql security invoker set search_path='' as $$
declare v_upload public.invox_multipart_uploads%rowtype;v_quota jsonb;
begin
  perform public.invox_multipart_admin(p_admin_id);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('invox-installer-quota',0));
  select * into v_upload from public.invox_multipart_uploads where id=p_upload_id and created_by=p_admin_id for update;
  if not found or v_upload.status not in('uploading','ready') or not exists(select 1 from public.invox_multipart_parts where upload_id=p_upload_id and part_index=p_index) then
    raise exception 'Multipart upload unavailable' using errcode='42501';end if;
  v_quota:=public.invox_storage_status(p_budget_bytes);
  if(v_quota->>'usedBytes')::bigint+(v_quota->>'reservedBytes')::bigint>p_budget_bytes then raise exception 'invox_storage_quota_exceeded';end if;
  update public.invox_multipart_parts set verified_object_id=null,verified_object_version=null,verified_sha256=null,verified_at=null where upload_id=p_upload_id and part_index=p_index;
  update public.invox_multipart_uploads set status='uploading',last_ticket_at=clock_timestamp(),updated_at=clock_timestamp() where id=p_upload_id;
end; $$;

create function public.invox_confirm_multipart_part(p_admin_id uuid,p_upload_id uuid,p_index integer,p_object_id uuid,p_object_version text,p_sha256 text) returns boolean
language plpgsql security invoker set search_path='' as $$
declare v_upload public.invox_multipart_uploads%rowtype;v_part public.invox_multipart_parts%rowtype;v_object storage.objects%rowtype;
begin
  perform public.invox_multipart_admin(p_admin_id);
  select * into v_upload from public.invox_multipart_uploads where id=p_upload_id and created_by=p_admin_id for update;
  if not found or v_upload.status not in('uploading','ready','published') then raise exception 'Multipart upload unavailable' using errcode='42501';end if;
  select * into strict v_part from public.invox_multipart_parts where upload_id=p_upload_id and part_index=p_index for update;
  select * into v_object from storage.objects where bucket_id='invox-installer-parts' and name=v_part.path for share;
  if not found or v_object.id is distinct from p_object_id or v_object.version is distinct from p_object_version
    or(v_object.metadata->>'size')::bigint is distinct from v_part.size or v_part.sha256 is distinct from p_sha256 then raise exception 'Multipart integrity mismatch' using errcode='22023';end if;
  if v_upload.status='published' and(v_part.verified_object_id is distinct from p_object_id or v_part.verified_object_version is distinct from p_object_version) then
    raise exception 'Published installer is immutable' using errcode='42501';end if;
  update public.invox_multipart_parts set verified_object_id=p_object_id,verified_object_version=p_object_version,verified_sha256=p_sha256,verified_at=clock_timestamp()
    where upload_id=p_upload_id and part_index=p_index;
  return true;
end; $$;

create function public.invox_finish_multipart_upload(p_admin_id uuid,p_upload_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare v_upload public.invox_multipart_uploads%rowtype;
begin
  perform public.invox_multipart_admin(p_admin_id);
  select * into v_upload from public.invox_multipart_uploads where id=p_upload_id and created_by=p_admin_id for update;
  if not found or v_upload.status not in('uploading','ready','published') then raise exception 'Multipart upload unavailable' using errcode='42501';end if;
  perform o.id from storage.objects o join public.invox_multipart_parts p on p.path=o.name and o.bucket_id='invox-installer-parts' where p.upload_id=p_upload_id for share of o;
  if not public.invox_multipart_complete(p_upload_id) then raise exception 'Multipart upload incomplete' using errcode='22023';end if;
  if v_upload.status<>'published' then update public.invox_multipart_uploads set status='ready',updated_at=clock_timestamp() where id=p_upload_id;end if;
  return jsonb_build_object('kind','multipart','uploadId',v_upload.id,'platform',v_upload.platform,'fileName',v_upload.file_name,'size',v_upload.size,'version',v_upload.version,'sha256',v_upload.sha256);
end; $$;

alter table public.invox_installers add column multipart_upload_id uuid unique references public.invox_multipart_uploads(id),add column sha256 text;
alter table public.invox_installers alter column path drop not null,drop constraint invox_installers_size_check;
alter table public.invox_installers add constraint invox_installer_object_kind check(
  (multipart_upload_id is null and path is not null and size between 1 and 52428800 and sha256 is null)
  or(multipart_upload_id is not null and path is null and size between 1 and 1610612736 and sha256 is not null and sha256~'^[a-f0-9]{64}$'));

create or replace function public.invox_publish_release(p_version text,p_release_notes text,p_files jsonb,p_admin_id uuid) returns void
language plpgsql security invoker set search_path='' as $$
declare v_file jsonb;v_single public.invox_uploads%rowtype;v_multi public.invox_multipart_uploads%rowtype;v_platform text;v_size bigint;v_platforms text[]:=array[]::text[];v_old uuid;
begin
  perform public.invox_multipart_admin(p_admin_id);
  if p_files is null or jsonb_typeof(p_files)<>'array' or jsonb_array_length(p_files)>3 or p_version is null or char_length(p_version) not between 1 and 64
    or p_version!~'^[0-9]+\.[0-9]+\.[0-9]+([-+][0-9A-Za-z.-]+)*$' or p_release_notes is null or char_length(p_release_notes)>5000 then raise exception 'Invalid release' using errcode='22023';end if;
  perform id from public.invox_site_settings where id=true for update;
  for v_file in select value from jsonb_array_elements(p_files) loop
    if jsonb_typeof(v_file) is distinct from 'object' or jsonb_typeof(v_file->'size') is distinct from 'number' or v_file->>'size'!~'^[1-9][0-9]{0,9}$' then raise exception 'Invalid installer' using errcode='22023';end if;
    v_platform:=v_file->>'platform';v_size:=(v_file->>'size')::bigint;
    if v_platform is null or v_platform not in('windows','macos','android') or v_platform=any(v_platforms) then raise exception 'Invalid platform' using errcode='22023';end if;
    v_platforms:=array_append(v_platforms,v_platform);
    select multipart_upload_id into v_old from public.invox_installers where platform=v_platform;
    if v_file->>'kind'='multipart' then
      select * into v_multi from public.invox_multipart_uploads where id=(v_file->>'uploadId')::uuid and created_by=p_admin_id for update;
      if not found or v_multi.status not in('ready','published') or v_multi.platform is distinct from v_platform or v_multi.version is distinct from p_version
        or v_multi.file_name is distinct from(v_file->>'fileName') or v_multi.size is distinct from v_size or v_multi.sha256 is distinct from(v_file->>'sha256') then raise exception 'Multipart manifest mismatch' using errcode='22023';end if;
      perform o.id from storage.objects o join public.invox_multipart_parts p on p.path=o.name and o.bucket_id='invox-installer-parts' where p.upload_id=v_multi.id for share of o;
      if not public.invox_multipart_complete(v_multi.id) then raise exception 'Multipart upload incomplete' using errcode='22023';end if;
      insert into public.invox_installers(platform,path,file_name,size,version,multipart_upload_id,sha256,updated_at)
        values(v_platform,null,v_multi.file_name,v_multi.size,p_version,v_multi.id,v_multi.sha256,clock_timestamp())
        on conflict(platform) do update set path=null,file_name=excluded.file_name,size=excluded.size,version=excluded.version,multipart_upload_id=excluded.multipart_upload_id,sha256=excluded.sha256,updated_at=excluded.updated_at;
      update public.invox_multipart_uploads set status='published',updated_at=clock_timestamp() where id=v_multi.id;
    else
      select * into v_single from public.invox_uploads where path=v_file->>'path' for update;
      if not found or v_size>52428800 or v_single.created_by is distinct from p_admin_id or v_single.platform is distinct from v_platform or v_single.file_name is distinct from(v_file->>'fileName')
        or v_single.size is distinct from v_size or v_single.version is distinct from p_version then raise exception 'Installer manifest mismatch' using errcode='22023';end if;
      insert into public.invox_installers(platform,path,file_name,size,version,multipart_upload_id,sha256,updated_at)
        values(v_platform,v_single.path,v_single.file_name,v_single.size,p_version,null,null,clock_timestamp())
        on conflict(platform) do update set path=excluded.path,file_name=excluded.file_name,size=excluded.size,version=excluded.version,multipart_upload_id=null,sha256=null,updated_at=excluded.updated_at;
      update public.invox_uploads set published=true where path=v_single.path;
    end if;
    if v_old is not null and v_old is distinct from(case when v_file->>'kind'='multipart' then v_multi.id else null end) then
      update public.invox_multipart_uploads set status='retired',cleanup_after=greatest(clock_timestamp()+interval '1 hour 5 minutes',coalesce(last_ticket_at,created_at)+interval '25 hours',
        coalesce((select max(expires_at)+interval '5 minutes' from public.invox_multipart_downloads where upload_id=v_old),clock_timestamp())) where id=v_old;
    end if;
  end loop;
  update public.invox_site_settings set version=p_version,release_notes=p_release_notes,updated_at=clock_timestamp() where id=true;
end; $$;

create function public.invox_mint_multipart_download(p_upload_id uuid,p_token_hash text,p_access_generation bigint,p_preview boolean default false,p_admin_id uuid default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare v_generation bigint;v_upload public.invox_multipart_uploads%rowtype;v_now timestamptz;
begin
  if p_token_hash is null or p_token_hash!~'^[a-f0-9]{64}$' or p_preview is null then raise exception 'Invalid download ticket' using errcode='22023';end if;
  select download_access_generation into strict v_generation from public.invox_site_settings where id=true for share;
  if v_generation is distinct from p_access_generation then raise exception 'invox_download_ticket_expired';end if;
  select * into v_upload from public.invox_multipart_uploads where id=p_upload_id for share;
  if not found then raise exception 'Installer unavailable' using errcode='P0002';end if;
  if p_preview then
    perform public.invox_multipart_admin(p_admin_id);
    if v_upload.created_by is distinct from p_admin_id or v_upload.status<>'ready' then raise exception 'Preview unavailable' using errcode='42501';end if;
  elsif v_upload.status<>'published' or not exists(select 1 from public.invox_installers where multipart_upload_id=p_upload_id) then raise exception 'Installer unavailable' using errcode='P0002';end if;
  if not public.invox_multipart_complete(p_upload_id) then raise exception 'Installer unavailable' using errcode='P0002';end if;
  v_now:=clock_timestamp();
  insert into public.invox_multipart_downloads(token_hash,upload_id,access_generation,is_preview,created_by,created_at,expires_at)
    values(p_token_hash,p_upload_id,v_generation,p_preview,case when p_preview then p_admin_id else null end,v_now,v_now+interval '8 hours');
  return jsonb_build_object('kind','multipart','fileName',v_upload.file_name,'size',v_upload.size,'sha256',v_upload.sha256,'expiresAt',v_now+interval '8 hours',
    'parts',(select jsonb_agg(jsonb_build_object('index',part_index,'size',size,'sha256',sha256) order by part_index) from public.invox_multipart_parts where upload_id=p_upload_id));
end; $$;

create function public.invox_download_multipart_part(p_token_hash text,p_index integer) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare v_ticket public.invox_multipart_downloads%rowtype;v_status text;v_part jsonb;
begin
  select * into v_ticket from public.invox_multipart_downloads where token_hash=p_token_hash;
  select status into v_status from public.invox_multipart_uploads where id=v_ticket.upload_id;
  if v_ticket.token_hash is null or v_ticket.expires_at<=statement_timestamp() or v_ticket.access_generation is distinct from(select download_access_generation from public.invox_site_settings where id=true)
    or(v_ticket.is_preview and(v_status<>'ready' or not exists(select 1 from public.invox_admins where user_id=v_ticket.created_by and enabled)))
    or(not v_ticket.is_preview and v_status not in('published','retired')) then raise exception 'invox_download_ticket_expired';end if;
  select jsonb_build_object('uploadId',v_ticket.upload_id,'path',p.path,'index',p.part_index,'size',p.size,'sha256',p.sha256) into v_part
    from public.invox_multipart_parts p join storage.objects o on o.bucket_id='invox-installer-parts' and o.name=p.path
    where p.upload_id=v_ticket.upload_id and p.part_index=p_index and p.verified_at is not null and p.verified_sha256=p.sha256
      and o.id=p.verified_object_id and o.version=p.verified_object_version and(o.metadata->>'size')::bigint=p.size;
  if v_part is null then raise exception 'Installer part unavailable' using errcode='P0002';end if;
  return v_part;
end; $$;

create function public.invox_count_multipart_download(p_token_hash text) returns boolean
language plpgsql security invoker set search_path='' as $$
declare v_generation bigint;v_ticket public.invox_multipart_downloads%rowtype;v_upload public.invox_multipart_uploads%rowtype;
begin
  select download_access_generation into strict v_generation from public.invox_site_settings where id=true for share;
  select * into v_ticket from public.invox_multipart_downloads where token_hash=p_token_hash for update;
  select * into v_upload from public.invox_multipart_uploads where id=v_ticket.upload_id;
  if v_ticket.token_hash is null or v_ticket.expires_at<=clock_timestamp() or v_ticket.access_generation is distinct from v_generation
    or(v_ticket.is_preview and(v_upload.status<>'ready' or not exists(select 1 from public.invox_admins where user_id=v_ticket.created_by and enabled)))
    or(not v_ticket.is_preview and v_upload.status not in('published','retired')) then raise exception 'invox_download_ticket_expired';end if;
  if v_ticket.counted_at is null then
    if not v_ticket.is_preview and not public.invox_record_analytics('download',null,v_upload.platform) then raise exception 'Download counter unavailable';end if;
    update public.invox_multipart_downloads set counted_at=clock_timestamp() where token_hash=p_token_hash;
  end if;
  return true;
end; $$;

create function public.invox_cancel_multipart_upload(p_admin_id uuid,p_upload_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare v_upload public.invox_multipart_uploads%rowtype;v_after timestamptz;
begin
  perform public.invox_multipart_admin(p_admin_id);
  select * into v_upload from public.invox_multipart_uploads where id=p_upload_id and created_by=p_admin_id for update;
  if not found or v_upload.status not in('uploading','ready','cancelled','purged') then raise exception 'Cleanup unavailable' using errcode='42501';end if;
  v_after:=greatest(coalesce(v_upload.cleanup_after,clock_timestamp()),coalesce(v_upload.last_ticket_at,v_upload.created_at)+interval '25 hours');
  if v_upload.status<>'purged' then update public.invox_multipart_uploads set status='cancelled',cleanup_after=v_after,updated_at=clock_timestamp() where id=p_upload_id;end if;
  return jsonb_build_object('paths',case when v_upload.status='purged' then '[]'::jsonb else(select jsonb_agg(path order by part_index) from public.invox_multipart_parts where upload_id=p_upload_id)end,'cleanupAfter',v_after);
end; $$;
create function public.invox_finish_multipart_cleanup(p_admin_id uuid,p_upload_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare v_upload public.invox_multipart_uploads%rowtype;
begin
  perform public.invox_multipart_admin(p_admin_id);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('invox-installer-quota',0));
  select * into v_upload from public.invox_multipart_uploads where id=p_upload_id and created_by=p_admin_id for update;
  if not found or v_upload.status not in('cancelled','purged') then raise exception 'Cleanup unavailable' using errcode='42501';end if;
  if exists(select 1 from storage.objects o join public.invox_multipart_parts p on p.path=o.name and o.bucket_id='invox-installer-parts' where p.upload_id=p_upload_id) then raise exception 'Cleanup incomplete';end if;
  if v_upload.cleanup_after<=clock_timestamp() then update public.invox_multipart_uploads set status='purged',updated_at=clock_timestamp() where id=p_upload_id;end if;
  return jsonb_build_object('cancelled',true,'cleanupPending',v_upload.cleanup_after>clock_timestamp(),'cleanupAfter',v_upload.cleanup_after);
end; $$;

create function public.invox_multipart_cleanup_due(p_admin_id uuid,p_limit integer default 2) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare v_upload public.invox_multipart_uploads%rowtype; v_result jsonb:='[]'::jsonb;
begin
  perform public.invox_multipart_admin(p_admin_id);
  if p_limit is null or p_limit not between 1 and 5 then raise exception 'Invalid cleanup batch' using errcode='22023'; end if;
  for v_upload in
    select u.* from public.invox_multipart_uploads u
    where u.created_by=p_admin_id and u.status in('retired','cancelled') and u.cleanup_after<=clock_timestamp()
      and not exists(select 1 from public.invox_installers i where i.multipart_upload_id=u.id)
      and not exists(select 1 from public.invox_multipart_downloads d where d.upload_id=u.id and d.expires_at>clock_timestamp())
    order by u.cleanup_after,u.id limit p_limit for update of u skip locked
  loop
    v_result:=v_result||jsonb_build_array(jsonb_build_object('uploadId',v_upload.id,'paths',
      coalesce((select jsonb_agg(path order by part_index) from public.invox_multipart_parts where upload_id=v_upload.id),'[]'::jsonb)));
  end loop;
  return v_result;
end; $$;

create function public.invox_purge_multipart_due(p_admin_id uuid,p_upload_id uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
declare v_upload public.invox_multipart_uploads%rowtype;
begin
  perform public.invox_multipart_admin(p_admin_id);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('invox-installer-quota',0));
  select * into v_upload from public.invox_multipart_uploads where id=p_upload_id and created_by=p_admin_id for update;
  if not found then raise exception 'Cleanup unavailable' using errcode='42501'; end if;
  if v_upload.status='purged' then return true; end if;
  if v_upload.status not in('retired','cancelled') or v_upload.cleanup_after is null or v_upload.cleanup_after>clock_timestamp()
    or exists(select 1 from public.invox_installers where multipart_upload_id=p_upload_id)
    or exists(select 1 from public.invox_multipart_downloads where upload_id=p_upload_id and expires_at>clock_timestamp()) then
    raise exception 'Cleanup not due' using errcode='42501';
  end if;
  if exists(select 1 from storage.objects o join public.invox_multipart_parts p
    on o.bucket_id='invox-installer-parts' and o.name=p.path where p.upload_id=p_upload_id) then raise exception 'Cleanup incomplete'; end if;
  update public.invox_multipart_uploads set status='purged',updated_at=clock_timestamp() where id=p_upload_id;
  return true;
end; $$;

do $$ declare v_function regprocedure;begin
  for v_function in select p.oid::regprocedure from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname=any(array['invox_bump_download_access','invox_multipart_admin','invox_storage_status','invox_multipart_complete',
      'invox_create_multipart_upload','invox_reserve_single_upload','invox_multipart_part','invox_multipart_upload_ticket','invox_confirm_multipart_part',
      'invox_finish_multipart_upload','invox_publish_release','invox_mint_multipart_download','invox_download_multipart_part','invox_count_multipart_download',
      'invox_cancel_multipart_upload','invox_finish_multipart_cleanup','invox_multipart_cleanup_due','invox_purge_multipart_due']) loop
    execute format('revoke all on function %s from public,anon,authenticated',v_function);
    execute format('grant execute on function %s to service_role',v_function);
  end loop;
end; $$;
commit;
