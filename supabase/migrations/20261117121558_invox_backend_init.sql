-- INVOX: snapshot SQL do backend. Aplicar somente após inspecionar o projeto alvo.
-- Não contém dados de exemplo, credenciais ou uma conta administrativa padrão.
begin;

create table public.invox_admins (
  email text primary key,
  username text not null unique,
  user_id uuid unique references auth.users(id),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  constraint invox_admin_email_normalized check (
    email = lower(btrim(email)) and char_length(email) between 3 and 254
    and position('@' in email) > 1
  ),
  constraint invox_admin_username_normalized check (
    username = lower(btrim(username)) and username ~ '^[a-z0-9][a-z0-9_.-]{1,31}$'
  )
);

create table public.invox_site_settings (
  id boolean primary key default true check (id),
  visibility text not null default 'public' check (visibility in ('public', 'private')),
  download_password_hash text,
  version text not null default '1.1.0' check (char_length(version) between 1 and 64),
  release_notes text not null default '' check (char_length(release_notes) <= 5000),
  updated_at timestamptz not null default now(),
  constraint invox_private_requires_password check (
    visibility <> 'private' or coalesce(char_length(download_password_hash), 0) >= 32
  )
);

create table public.invox_feedbacks (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 80),
  contact text not null check (char_length(btrim(contact)) between 3 and 200),
  message text not null check (char_length(btrim(message)) between 10 and 2000),
  status text not null default 'new' check (status in ('new', 'answered')),
  note text not null default '' check (char_length(note) <= 5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index invox_feedbacks_recent_idx on public.invox_feedbacks (created_at desc, id desc);
create index invox_feedbacks_status_recent_idx on public.invox_feedbacks (status, created_at desc, id desc);

create table public.invox_installers (
  platform text primary key check (platform in ('windows', 'macos', 'android')),
  path text not null unique check (char_length(path) between 1 and 512 and path !~ '(^|/)\.\.(/|$)' and path !~ '^[\\/]'),
  file_name text not null check (char_length(file_name) between 1 and 180 and file_name !~ '[\\/[:cntrl:]]'),
  size bigint not null check (size between 1 and 52428800),
  version text not null check (char_length(version) between 1 and 64),
  updated_at timestamptz not null default now(),
  constraint invox_installer_extension check (
    (platform = 'windows' and file_name ~* '\.(exe|msi|zip)$') or
    (platform = 'macos' and file_name ~* '\.(dmg|pkg|zip)$') or
    (platform = 'android' and file_name ~* '\.apk$')
  )
);

create table public.invox_uploads (
  path text primary key check (char_length(path) between 1 and 512 and path !~ '(^|/)\.\.(/|$)' and path !~ '^[\\/]'),
  platform text not null check (platform in ('windows', 'macos', 'android')),
  file_name text not null check (char_length(file_name) between 1 and 180 and file_name !~ '[\\/[:cntrl:]]'),
  size bigint not null check (size between 1 and 52428800),
  version text not null check (char_length(version) between 1 and 64),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  published boolean not null default false,
  constraint invox_upload_extension check (
    (platform = 'windows' and file_name ~* '\.(exe|msi|zip)$') or
    (platform = 'macos' and file_name ~* '\.(dmg|pkg|zip)$') or
    (platform = 'android' and file_name ~* '\.apk$')
  )
);
create index invox_uploads_created_by_idx on public.invox_uploads (created_by);
create index invox_uploads_created_at_idx on public.invox_uploads (created_at);

create table public.invox_rate_limits (
  category text not null check (category ~ '^[a-z][a-z0-9_-]{0,63}$'),
  key_hash text not null check (key_hash ~ '^[a-f0-9]{64}$'),
  window_start timestamptz not null,
  attempts integer not null check (attempts > 0),
  primary key (category, key_hash, window_start)
);
create index invox_rate_limits_expiry_idx on public.invox_rate_limits (window_start);

alter table public.invox_admins enable row level security;
alter table public.invox_site_settings enable row level security;
alter table public.invox_feedbacks enable row level security;
alter table public.invox_installers enable row level security;
alter table public.invox_uploads enable row level security;
alter table public.invox_rate_limits enable row level security;

revoke all on table public.invox_admins, public.invox_site_settings,
  public.invox_feedbacks, public.invox_installers, public.invox_uploads,
  public.invox_rate_limits from public, anon, authenticated;
grant all on table public.invox_admins, public.invox_site_settings,
  public.invox_feedbacks, public.invox_installers, public.invox_uploads,
  public.invox_rate_limits to service_role;

insert into public.invox_site_settings (id, visibility, version)
values (true, 'public', '1.1.0');

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('invox-installers', 'invox-installers', false, 52428800, array['application/octet-stream']);

-- Uma política ampla legada não pode abrir os instaladores deste bucket.
create policy invox_installers_object_guard on storage.objects
  as restrictive for all to anon, authenticated
  using (bucket_id <> 'invox-installers')
  with check (bucket_id <> 'invox-installers');
create policy invox_installers_bucket_guard on storage.buckets
  as restrictive for all to anon, authenticated
  using (id <> 'invox-installers')
  with check (id <> 'invox-installers');

create function public.invox_take_rate_limit(
  p_key_hash text,
  p_category text,
  p_window_seconds integer,
  p_limit integer
) returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_window timestamptz;
  v_attempts integer;
begin
  if p_key_hash is null or p_key_hash !~ '^[a-f0-9]{64}$'
    or p_category is null or p_category !~ '^[a-z][a-z0-9_-]{0,63}$'
    or p_window_seconds is null or p_window_seconds not between 1 and 86400
    or p_limit is null or p_limit not between 1 and 10000 then
    raise exception 'Invalid rate-limit parameters' using errcode = '22023';
  end if;
  v_window := pg_catalog.to_timestamp(
    pg_catalog.floor(extract(epoch from v_now) / p_window_seconds) * p_window_seconds
  );
  insert into public.invox_rate_limits (category, key_hash, window_start, attempts)
  values (p_category, p_key_hash, v_window, 1)
  on conflict (category, key_hash, window_start) do update
    set attempts = least(public.invox_rate_limits.attempts, 10000) + 1
  returning attempts into v_attempts;

  -- Limpeza limitada; os contadores guardam hashes, sem IP em texto.
  delete from public.invox_rate_limits
  where (category, key_hash, window_start) in (
    select category, key_hash, window_start
    from public.invox_rate_limits
    where window_start < v_now - interval '1 day'
    order by window_start
    limit 1000
  );
  return v_attempts <= p_limit;
end;
$$;
revoke all on function public.invox_take_rate_limit(text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.invox_take_rate_limit(text, text, integer, integer) to service_role;

create function public.invox_publish_release(
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
      or (v_file ->> 'size') !~ '^[1-9][0-9]{0,7}$' then
      raise exception 'Invalid installer manifest' using errcode = '22023';
    end if;
    v_platform := v_file ->> 'platform';
    v_size := (v_file ->> 'size')::bigint;
    if v_platform not in ('windows', 'macos', 'android')
      or v_platform = any(v_platforms) or v_size > 52428800 then
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
