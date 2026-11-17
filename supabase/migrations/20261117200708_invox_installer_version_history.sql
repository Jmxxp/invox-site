-- Display versions are separate from immutable staged uploads and object bytes.
begin;
create table public.invox_installer_history(
  id uuid primary key default gen_random_uuid(),
  platform text not null check(platform in('windows','macos','android')),
  version text not null check(char_length(version) between 1 and 64),
  file_name text not null check(char_length(file_name) between 1 and 180 and file_name!~'[\\/[:cntrl:]]'),
  size bigint not null check(size between 1 and 1610612736),
  kind text not null check(kind in('legacy','multipart')),
  path text,multipart_upload_id uuid,sha256 text,
  published_at timestamptz not null,
  action text not null check(action in('published','version_updated')),
  migrated boolean not null default false,
  check((kind='legacy' and path is not null and multipart_upload_id is null and sha256 is null and size<=52428800)
    or(kind='multipart' and path is null and multipart_upload_id is not null and sha256 is not null and sha256~'^[a-f0-9]{64}$'))
);
create index invox_installer_history_recent_idx on public.invox_installer_history(published_at desc,id desc);
alter table public.invox_installer_history enable row level security;
revoke all on public.invox_installer_history from public,anon,authenticated,service_role;
grant select,insert on public.invox_installer_history to service_role;
alter table public.invox_installers add column current_history_id uuid references public.invox_installer_history(id);
create index invox_installers_history_idx on public.invox_installers(current_history_id);
create function public.invox_installer_history_immutable() returns trigger
language plpgsql security invoker set search_path='' as $$
begin raise exception 'Publication history is append-only' using errcode='42501';end; $$;
create trigger invox_installer_history_append_only before update or delete on public.invox_installer_history
for each row execute function public.invox_installer_history_immutable();
revoke all on function public.invox_installer_history_immutable() from public,anon,authenticated;

-- No cascading asset reference. Preserve the known current timestamp, marked imported.
do $$ declare v_installer public.invox_installers%rowtype;v_history uuid;begin
  for v_installer in select * from public.invox_installers for update loop
    insert into public.invox_installer_history(platform,version,file_name,size,kind,path,multipart_upload_id,sha256,published_at,action,migrated)
    values(v_installer.platform,v_installer.version,v_installer.file_name,v_installer.size,
      case when v_installer.multipart_upload_id is null then 'legacy' else 'multipart' end,
      v_installer.path,v_installer.multipart_upload_id,v_installer.sha256,v_installer.updated_at,'published',true) returning id into v_history;
    update public.invox_installers set current_history_id=v_history where platform=v_installer.platform;
  end loop;
end; $$;

create function public.invox_installer_history_list(p_admin_id uuid,p_limit integer default 100) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare v_result jsonb;
begin
  perform public.invox_multipart_admin(p_admin_id);
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'Invalid history limit' using errcode='22023';end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',h.id,'platform',h.platform,'version',h.version,'fileName',h.file_name,'size',h.size,
    'publishedAt',h.published_at,'action',h.action,'isCurrent',i.current_history_id is not null,'migrated',h.migrated)
    order by h.published_at desc,h.id desc),'[]'::jsonb) into v_result
  from(select * from public.invox_installer_history order by published_at desc,id desc limit p_limit)h
  left join public.invox_installers i on i.current_history_id=h.id;
  return v_result;
end; $$;
revoke all on function public.invox_installer_history_list(uuid,integer) from public,anon,authenticated;
grant execute on function public.invox_installer_history_list(uuid,integer) to service_role;

create function public.invox_update_installer_version(p_admin_id uuid,p_platform text,p_version text) returns void
language plpgsql security invoker set search_path='' as $$
declare v_installer public.invox_installers%rowtype;v_history uuid;v_when timestamptz;
begin
  perform public.invox_multipart_admin(p_admin_id);
  if p_platform is null or p_platform not in('windows','macos','android') or p_version is null or char_length(p_version) not between 1 and 64
    or p_version!~'^[0-9]+\.[0-9]+\.[0-9]+([-+][0-9A-Za-z.-]+)*$' then raise exception 'Invalid installer version' using errcode='22023';end if;
  -- Match publication's lock order without changing the site's general version.
  perform id from public.invox_site_settings where id=true for update;
  select * into v_installer from public.invox_installers where platform=p_platform for update;
  if not found then raise exception 'Installer unavailable' using errcode='P0002';end if;
  if v_installer.version=p_version then return;end if;
  v_when:=clock_timestamp();
  insert into public.invox_installer_history(platform,version,file_name,size,kind,path,multipart_upload_id,sha256,published_at,action)
  values(p_platform,p_version,v_installer.file_name,v_installer.size,case when v_installer.multipart_upload_id is null then 'legacy' else 'multipart' end,
    v_installer.path,v_installer.multipart_upload_id,v_installer.sha256,v_when,'version_updated') returning id into v_history;
  update public.invox_installers set version=p_version,updated_at=v_when,current_history_id=v_history where platform=p_platform;
end; $$;
revoke all on function public.invox_update_installer_version(uuid,text,text) from public,anon,authenticated;
grant execute on function public.invox_update_installer_version(uuid,text,text) to service_role;

create or replace function public.invox_publish_release(p_version text,p_release_notes text,p_files jsonb,p_admin_id uuid) returns void
language plpgsql security invoker set search_path='' as $$
declare v_file jsonb;v_single public.invox_uploads%rowtype;v_multi public.invox_multipart_uploads%rowtype;v_platform text;v_size bigint;v_platforms text[]:=array[]::text[];v_old uuid;v_file_version text;v_history uuid;v_when timestamptz;
begin
  perform public.invox_multipart_admin(p_admin_id);
  if p_files is null or jsonb_typeof(p_files)<>'array' or jsonb_array_length(p_files)>3 or p_version is null or char_length(p_version) not between 1 and 64
    or p_version!~'^[0-9]+\.[0-9]+\.[0-9]+([-+][0-9A-Za-z.-]+)*$' or p_release_notes is null or char_length(p_release_notes)>5000 then raise exception 'Invalid release' using errcode='22023';end if;
  perform id from public.invox_site_settings where id=true for update;
  for v_file in select value from jsonb_array_elements(p_files) loop
    if jsonb_typeof(v_file) is distinct from 'object' or jsonb_typeof(v_file->'size') is distinct from 'number' or v_file->>'size'!~'^[1-9][0-9]{0,9}$' then raise exception 'Invalid installer' using errcode='22023';end if;
    v_platform:=v_file->>'platform';v_size:=(v_file->>'size')::bigint;
    if v_platform is null or v_platform not in('windows','macos','android') or v_platform=any(v_platforms) then raise exception 'Invalid platform' using errcode='22023';end if;
    if v_file?'version' and jsonb_typeof(v_file->'version') is distinct from 'string' then raise exception 'Invalid file version' using errcode='22023';end if;
    v_file_version:=case when v_file?'version' then v_file->>'version' else p_version end;
    if v_file_version is null or char_length(v_file_version) not between 1 and 64 or v_file_version!~'^[0-9]+\.[0-9]+\.[0-9]+([-+][0-9A-Za-z.-]+)*$' then raise exception 'Invalid file version' using errcode='22023';end if;
    v_platforms:=array_append(v_platforms,v_platform);
    select multipart_upload_id into v_old from public.invox_installers where platform=v_platform;
    if v_file->>'kind'='multipart' then
      select * into v_multi from public.invox_multipart_uploads where id=(v_file->>'uploadId')::uuid and created_by=p_admin_id for update;
      if not found or v_multi.status not in('ready','published') or v_multi.platform is distinct from v_platform
        or v_multi.file_name is distinct from(v_file->>'fileName') or v_multi.size is distinct from v_size or v_multi.sha256 is distinct from(v_file->>'sha256') then raise exception 'Multipart manifest mismatch' using errcode='22023';end if;
      perform o.id from storage.objects o join public.invox_multipart_parts p on p.path=o.name and o.bucket_id='invox-installer-parts' where p.upload_id=v_multi.id for share of o;
      if not public.invox_multipart_complete(v_multi.id) then raise exception 'Multipart upload incomplete' using errcode='22023';end if;
      v_when:=clock_timestamp();
      insert into public.invox_installer_history(platform,version,file_name,size,kind,path,multipart_upload_id,sha256,published_at,action)
        values(v_platform,v_file_version,v_multi.file_name,v_multi.size,'multipart',null,v_multi.id,v_multi.sha256,v_when,'published') returning id into v_history;
      insert into public.invox_installers(platform,path,file_name,size,version,multipart_upload_id,sha256,updated_at,current_history_id)
        values(v_platform,null,v_multi.file_name,v_multi.size,v_file_version,v_multi.id,v_multi.sha256,v_when,v_history)
        on conflict(platform) do update set path=null,file_name=excluded.file_name,size=excluded.size,version=excluded.version,multipart_upload_id=excluded.multipart_upload_id,sha256=excluded.sha256,updated_at=excluded.updated_at,current_history_id=excluded.current_history_id;
      update public.invox_multipart_uploads set status='published',updated_at=clock_timestamp() where id=v_multi.id;
    else
      select * into v_single from public.invox_uploads where path=v_file->>'path' for update;
      if not found or v_size>52428800 or v_single.created_by is distinct from p_admin_id or v_single.platform is distinct from v_platform or v_single.file_name is distinct from(v_file->>'fileName')
        or v_single.size is distinct from v_size then raise exception 'Installer manifest mismatch' using errcode='22023';end if;
      v_when:=clock_timestamp();
      insert into public.invox_installer_history(platform,version,file_name,size,kind,path,multipart_upload_id,sha256,published_at,action)
        values(v_platform,v_file_version,v_single.file_name,v_single.size,'legacy',v_single.path,null,null,v_when,'published') returning id into v_history;
      insert into public.invox_installers(platform,path,file_name,size,version,multipart_upload_id,sha256,updated_at,current_history_id)
        values(v_platform,v_single.path,v_single.file_name,v_single.size,v_file_version,null,null,v_when,v_history)
        on conflict(platform) do update set path=excluded.path,file_name=excluded.file_name,size=excluded.size,version=excluded.version,multipart_upload_id=null,sha256=null,updated_at=excluded.updated_at,current_history_id=excluded.current_history_id;
      update public.invox_uploads set published=true where path=v_single.path;
    end if;
    if v_old is not null and v_old is distinct from(case when v_file->>'kind'='multipart' then v_multi.id else null end) then
      update public.invox_multipart_uploads set status='retired',cleanup_after=greatest(clock_timestamp()+interval '1 hour 5 minutes',coalesce(last_ticket_at,created_at)+interval '25 hours',
        coalesce((select max(expires_at)+interval '5 minutes' from public.invox_multipart_downloads where upload_id=v_old),clock_timestamp())) where id=v_old;
    end if;
  end loop;
  update public.invox_site_settings set version=p_version,release_notes=p_release_notes,updated_at=clock_timestamp() where id=true;
end; $$;

revoke all on function public.invox_publish_release(text,text,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.invox_publish_release(text,text,jsonb,uuid) to service_role;
commit;
