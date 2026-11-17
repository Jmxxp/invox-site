-- Requires a Supabase plan allowing >= 1610612736 bytes and the global
-- Storage fileSizeLimit raised first. The Free plan remains capped at 50 MiB.
-- Keep the bucket private, MIME restrictions, RLS and server-only RPC grants.
begin;
alter table public.invox_installers
  drop constraint invox_installers_size_check,
  add constraint invox_installers_size_check check (size between 1 and 1610612736);
alter table public.invox_uploads
  drop constraint invox_uploads_size_check,
  add constraint invox_uploads_size_check check (size between 1 and 1610612736);
update storage.buckets set file_size_limit = 1610612736 where id = 'invox-installers';

create or replace function public.invox_publish_release(
  p_version text,
  p_release_notes text,
  p_files jsonb,
  p_admin_id uuid
) returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_file jsonb;
  v_upload public.invox_uploads%rowtype;
  v_platforms text[] := array[]::text[];
  v_platform text;
  v_size bigint;
begin
  if p_admin_id is null or not exists (
    select 1 from public.invox_admins where user_id = p_admin_id and enabled
  ) then
    raise exception 'Administrator not authorized' using errcode = '42501';
  end if;
  if p_files is null or jsonb_typeof(p_files) <> 'array' then
    raise exception 'Installer manifest must be an array' using errcode = '22023';
  end if;
  if p_version is null or char_length(p_version) not between 1 and 64
    or p_version !~ '^[0-9]+\.[0-9]+\.[0-9]+([-+][0-9A-Za-z.-]+)*$'
    or p_release_notes is null or char_length(p_release_notes) > 5000
    or jsonb_array_length(p_files) > 3 then
    raise exception 'Invalid release parameters' using errcode = '22023';
  end if;
  -- Serializa publicações e garante a configuração única antes de alterar arquivos.
  perform id from public.invox_site_settings where id = true for update;
  if not found then
    raise exception 'Site settings not initialized' using errcode = 'P0002';
  end if;

  for v_file in select value from jsonb_array_elements(p_files) loop
    if jsonb_typeof(v_file) is distinct from 'object'
      or jsonb_typeof(v_file -> 'platform') is distinct from 'string'
      or jsonb_typeof(v_file -> 'path') is distinct from 'string'
      or jsonb_typeof(v_file -> 'fileName') is distinct from 'string'
      or jsonb_typeof(v_file -> 'size') is distinct from 'number'
      or (v_file ->> 'size') !~ '^[1-9][0-9]{0,9}$' then
      raise exception 'Invalid installer manifest' using errcode = '22023';
    end if;
    v_platform := v_file ->> 'platform';
    v_size := (v_file ->> 'size')::bigint;
    if v_platform not in ('windows', 'macos', 'android')
      or v_platform = any(v_platforms) or v_size > 1610612736 then
      raise exception 'Invalid or duplicated platform' using errcode = '22023';
    end if;
    v_platforms := array_append(v_platforms, v_platform);

    select * into v_upload from public.invox_uploads
    where path = v_file ->> 'path'
    for update;
    if not found
      or v_upload.created_by is distinct from p_admin_id
      or v_upload.platform is distinct from v_platform
      or v_upload.file_name is distinct from (v_file ->> 'fileName')
      or v_upload.size is distinct from v_size
      or v_upload.version is distinct from p_version then
      raise exception 'Installer does not match its authorized upload' using errcode = '22023';
    end if;

    insert into public.invox_installers (platform, path, file_name, size, version, updated_at)
    values (v_platform, v_upload.path, v_upload.file_name, v_upload.size, p_version, now())
    on conflict (platform) do update set
      path = excluded.path, file_name = excluded.file_name, size = excluded.size,
      version = excluded.version, updated_at = excluded.updated_at;
    update public.invox_uploads set published = true where path = v_upload.path;
  end loop;

  update public.invox_site_settings
  set version = p_version, release_notes = p_release_notes, updated_at = now()
  where id = true;
end;
$$;
revoke all on function public.invox_publish_release(text, text, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.invox_publish_release(text, text, jsonb, uuid) to service_role;

commit;
