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
  contact text check (char_length(btrim(contact)) between 3 and 200),
  message text not null check (char_length(btrim(message)) between 10 and 2000),
  kind text not null default 'feedback' check (kind in ('feedback', 'suggestion')),
  source text not null default 'site' check (source in ('site', 'game')),
  status text not null default 'new' check (status in ('new', 'answered')),
  note text not null default '' check (char_length(note) <= 5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index invox_feedbacks_recent_idx on public.invox_feedbacks (created_at desc, id desc);
create index invox_feedbacks_status_recent_idx on public.invox_feedbacks (status, created_at desc, id desc);

create table public.invox_announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 100),
  message text not null check (char_length(btrim(message)) between 1 and 2000),
  active boolean not null default true,
  published_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id)
);
create index invox_announcements_active_recent_idx on public.invox_announcements (active, published_at desc, id desc);
alter table public.invox_announcements enable row level security;
revoke all on table public.invox_announcements from public, anon, authenticated;
grant all on table public.invox_announcements to service_role;

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

-- Aggregate analytics feature.
begin;
-- Aggregate counters only: no cookies, visitor identifiers, IP addresses or URLs.
alter table public.invox_site_settings
  add column analytics_started_at timestamptz not null default now();

create table public.invox_analytics_hourly (
  bucket timestamptz primary key,
  page_views bigint not null default 0 check (page_views >= 0),
  downloads_windows bigint not null default 0 check (downloads_windows >= 0),
  downloads_macos bigint not null default 0 check (downloads_macos >= 0),
  downloads_android bigint not null default 0 check (downloads_android >= 0)
);
create table public.invox_analytics_dedup (
  event_id uuid primary key,
  created_at timestamptz not null default now()
);
create index invox_analytics_dedup_expiry_idx on public.invox_analytics_dedup(created_at);
alter table public.invox_analytics_hourly enable row level security;
alter table public.invox_analytics_dedup enable row level security;
revoke all on public.invox_analytics_hourly, public.invox_analytics_dedup from public, anon, authenticated;
grant all on public.invox_analytics_hourly, public.invox_analytics_dedup to service_role;

create function public.invox_record_analytics(
  p_kind text,
  p_event_id uuid default null,
  p_platform text default null
) returns boolean
language plpgsql security invoker set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_bucket timestamptz;
  v_inserted integer;
begin
  if p_kind is null or p_kind not in ('page_view','download') then
    raise exception 'Invalid analytics kind' using errcode = '22023';
  end if;
  if p_kind = 'page_view' then
    if p_event_id is null or p_platform is not null then
      raise exception 'Invalid page event' using errcode = '22023';
    end if;
    insert into public.invox_analytics_dedup(event_id,created_at)
    values (p_event_id,v_now) on conflict (event_id) do nothing;
    get diagnostics v_inserted = row_count;
    if v_inserted = 0 then return false; end if;
  elsif p_event_id is not null or p_platform is null or p_platform not in ('windows','macos','android') then
    raise exception 'Invalid download event' using errcode = '22023';
  end if;
  v_bucket := pg_catalog.date_trunc('hour',v_now at time zone 'UTC') at time zone 'UTC';
  insert into public.invox_analytics_hourly(bucket,page_views,downloads_windows,downloads_macos,downloads_android)
  values (v_bucket,(p_kind='page_view')::integer,(p_kind='download' and p_platform='windows')::integer,
    (p_kind='download' and p_platform='macos')::integer,(p_kind='download' and p_platform='android')::integer)
  on conflict (bucket) do update set
    page_views = public.invox_analytics_hourly.page_views + excluded.page_views,
    downloads_windows = public.invox_analytics_hourly.downloads_windows + excluded.downloads_windows,
    downloads_macos = public.invox_analytics_hourly.downloads_macos + excluded.downloads_macos,
    downloads_android = public.invox_analytics_hourly.downloads_android + excluded.downloads_android;
  delete from public.invox_analytics_dedup where event_id in (
    select event_id from public.invox_analytics_dedup where created_at < v_now - interval '1 day'
    order by created_at limit 1000
  );
  return true;
end;
$$;
revoke all on function public.invox_record_analytics(text,uuid,text) from public,anon,authenticated;
grant execute on function public.invox_record_analytics(text,uuid,text) to service_role;

create function public.invox_analytics_report(p_period text) returns jsonb
language plpgsql stable security invoker set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.statement_timestamp();
  v_local timestamp := v_now at time zone 'America/Sao_Paulo';
  v_start timestamp;
  v_last timestamp;
  v_step interval;
  v_start_utc timestamptz;
  v_started_at timestamptz;
  v_series jsonb;
  v_totals jsonb;
  v_platforms jsonb;
  v_all_time jsonb;
begin
  case p_period
    when 'day' then
      v_start := pg_catalog.date_trunc('day',v_local);
      v_last := pg_catalog.date_trunc('hour',v_local); v_step := interval '1 hour';
    when 'week' then
      v_start := pg_catalog.date_trunc('day',v_local) - interval '6 days';
      v_last := pg_catalog.date_trunc('day',v_local); v_step := interval '1 day';
    when 'month' then
      v_start := pg_catalog.date_trunc('day',v_local) - interval '29 days';
      v_last := pg_catalog.date_trunc('day',v_local); v_step := interval '1 day';
    when 'year' then
      v_start := pg_catalog.date_trunc('month',v_local) - interval '11 months';
      v_last := pg_catalog.date_trunc('month',v_local); v_step := interval '1 month';
    else raise exception 'Invalid analytics period' using errcode = '22023';
  end case;
  v_start_utc := v_start at time zone 'America/Sao_Paulo';
  select analytics_started_at into strict v_started_at from public.invox_site_settings where id=true;

  with buckets as (
    select s as local_start, s at time zone 'America/Sao_Paulo' as utc_start,
      (s+v_step) at time zone 'America/Sao_Paulo' as utc_end
    from pg_catalog.generate_series(v_start,v_last,v_step) s
  ), counts as (
    select b.local_start,b.utc_start,coalesce(sum(a.page_views),0) as views,
      coalesce(sum(a.downloads_windows+a.downloads_macos+a.downloads_android),0) as downloads
    from buckets b left join public.invox_analytics_hourly a
      on a.bucket>=b.utc_start and a.bucket<b.utc_end and a.bucket<=v_now
    group by b.local_start,b.utc_start
  ) select coalesce(jsonb_agg(jsonb_build_object(
      'key',utc_start,
      'label',case when p_period='day' then pg_catalog.to_char(local_start,'HH24')||'h'
        when p_period='year' then (array['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'])[extract(month from local_start)::integer]||'/'||pg_catalog.to_char(local_start,'YY')
        else pg_catalog.to_char(local_start,'DD/MM') end,
      'views',views,'downloads',downloads
    ) order by utc_start),'[]'::jsonb) into v_series from counts;

  select jsonb_build_object('views',coalesce(sum(page_views),0),
    'downloads',coalesce(sum(downloads_windows+downloads_macos+downloads_android),0)),
    jsonb_build_array(
      jsonb_build_object('platform','windows','downloads',coalesce(sum(downloads_windows),0)),
      jsonb_build_object('platform','macos','downloads',coalesce(sum(downloads_macos),0)),
      jsonb_build_object('platform','android','downloads',coalesce(sum(downloads_android),0)))
    into v_totals,v_platforms from public.invox_analytics_hourly
    where bucket>=v_start_utc and bucket<=v_now;

  select jsonb_build_object('views',coalesce(sum(page_views),0),
    'downloads',coalesce(sum(downloads_windows+downloads_macos+downloads_android),0))
    into v_all_time from public.invox_analytics_hourly where bucket<=v_now;
  return jsonb_build_object('period',p_period,'timezone','America/Sao_Paulo','startedAt',v_started_at,
    'range',jsonb_build_object('start',v_start_utc,'end',v_now),'series',v_series,
    'totals',v_totals,'platforms',v_platforms,'allTime',v_all_time);
end;
$$;
revoke all on function public.invox_analytics_report(text) from public,anon,authenticated;
grant execute on function public.invox_analytics_report(text) to service_role;

commit;

-- Persistent visitor download grants.
begin;
-- Visitor grants contain no plaintext token or password.
create table public.invox_download_sessions (
  token_hash text primary key check (token_hash ~ '^[a-f0-9]{64}$'),
  password_fingerprint text not null check (password_fingerprint ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now()+interval '30 days'),
  check (expires_at > created_at)
);
create index invox_download_sessions_expiry_idx on public.invox_download_sessions(expires_at);
alter table public.invox_download_sessions enable row level security;
revoke all on public.invox_download_sessions from public,anon,authenticated;
grant all on public.invox_download_sessions to service_role;

create function public.invox_create_download_session(p_token_hash text,p_password_fingerprint text)
returns timestamptz
language plpgsql security invoker set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_expires timestamptz := v_now + interval '30 days';
begin
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$'
    or p_password_fingerprint is null or p_password_fingerprint !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid session hashes' using errcode = '22023';
  end if;
  insert into public.invox_download_sessions(token_hash,password_fingerprint,created_at,expires_at)
  values(p_token_hash,p_password_fingerprint,v_now,v_expires);
  delete from public.invox_download_sessions where token_hash in (
    select token_hash from public.invox_download_sessions where expires_at <= v_now
    order by expires_at limit 1000
  );
  return v_expires;
end;
$$;
revoke all on function public.invox_create_download_session(text,text) from public,anon,authenticated;
grant execute on function public.invox_create_download_session(text,text) to service_role;

commit;

-- Each counting session has its own aggregates. Reset never deletes history.
begin;

alter table public.invox_site_settings
  add column analytics_generation bigint not null default 1
  check (analytics_generation between 1 and 9007199254740991);

create table public.invox_analytics_runs (
  generation bigint primary key check (generation between 1 and 9007199254740991),
  started_at timestamptz not null,
  ended_at timestamptz check (ended_at >= started_at),
  created_by uuid references auth.users(id) on delete set null
);
create unique index invox_analytics_one_active_run_idx
  on public.invox_analytics_runs ((ended_at is null)) where ended_at is null;
insert into public.invox_analytics_runs(generation,started_at)
  select analytics_generation,analytics_started_at from public.invox_site_settings where id=true;
alter table public.invox_analytics_runs enable row level security;
revoke all on public.invox_analytics_runs from public,anon,authenticated;
grant select,insert,update on public.invox_analytics_runs to service_role;
alter table public.invox_site_settings
  add constraint invox_settings_analytics_generation_fkey foreign key (analytics_generation)
  references public.invox_analytics_runs(generation);

alter table public.invox_analytics_hourly
  add column generation bigint not null default 1 references public.invox_analytics_runs(generation),
  drop constraint invox_analytics_hourly_pkey,
  add primary key (generation,bucket);
alter table public.invox_analytics_hourly alter column generation drop default;

create or replace function public.invox_record_analytics(
  p_kind text,
  p_event_id uuid default null,
  p_platform text default null
) returns boolean
language plpgsql security invoker set search_path = ''
as $$
declare
  v_now timestamptz;
  v_bucket timestamptz;
  v_generation bigint;
  v_inserted integer;
begin
  if p_kind is null or p_kind not in ('page_view','download') then
    raise exception 'Invalid analytics kind' using errcode = '22023';
  end if;
  if (p_kind='page_view' and (p_event_id is null or p_platform is not null))
    or (p_kind='download' and (p_event_id is not null or p_platform is null
      or p_platform not in ('windows','macos','android'))) then
    raise exception 'Invalid analytics event' using errcode = '22023';
  end if;
  -- Reset takes FOR UPDATE on this same row. Capture time only after the lock.
  select analytics_generation into strict v_generation
    from public.invox_site_settings where id=true for share;
  v_now := pg_catalog.clock_timestamp();
  if p_kind='page_view' then
    -- Global deduplication prevents an old retried event counting after reset.
    insert into public.invox_analytics_dedup(event_id,created_at)
      values(p_event_id,v_now) on conflict(event_id) do nothing;
    get diagnostics v_inserted = row_count;
    if v_inserted=0 then return false; end if;
  end if;
  v_bucket := pg_catalog.date_trunc('hour',v_now at time zone 'UTC') at time zone 'UTC';
  insert into public.invox_analytics_hourly(generation,bucket,page_views,downloads_windows,downloads_macos,downloads_android)
    values(v_generation,v_bucket,(p_kind='page_view')::integer,
      (p_kind='download' and p_platform='windows')::integer,
      (p_kind='download' and p_platform='macos')::integer,
      (p_kind='download' and p_platform='android')::integer)
    on conflict(generation,bucket) do update set
      page_views=public.invox_analytics_hourly.page_views+excluded.page_views,
      downloads_windows=public.invox_analytics_hourly.downloads_windows+excluded.downloads_windows,
      downloads_macos=public.invox_analytics_hourly.downloads_macos+excluded.downloads_macos,
      downloads_android=public.invox_analytics_hourly.downloads_android+excluded.downloads_android;
  delete from public.invox_analytics_dedup where event_id in (
    select event_id from public.invox_analytics_dedup where created_at<v_now-interval '1 day'
      order by created_at limit 1000
  );
  return true;
end;
$$;
revoke all on function public.invox_record_analytics(text,uuid,text) from public,anon,authenticated;
grant execute on function public.invox_record_analytics(text,uuid,text) to service_role;

create function public.invox_reset_analytics(p_admin_id uuid) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  v_previous bigint;
  v_generation bigint;
  v_started_at timestamptz;
begin
  if p_admin_id is null or not exists (
    select 1 from public.invox_admins where user_id=p_admin_id and enabled
  ) then
    raise exception 'Administrator required' using errcode='42501';
  end if;
  select analytics_generation into strict v_previous
    from public.invox_site_settings where id=true for update;
  if v_previous>=9007199254740991 then
    raise exception 'Analytics generation exhausted' using errcode='22003';
  end if;
  v_generation := v_previous+1;
  v_started_at := pg_catalog.clock_timestamp();
  update public.invox_analytics_runs set ended_at=v_started_at where generation=v_previous;
  insert into public.invox_analytics_runs(generation,started_at,created_by)
    values(v_generation,v_started_at,p_admin_id);
  update public.invox_site_settings set analytics_generation=v_generation,analytics_started_at=v_started_at
    where id=true;
  return jsonb_build_object('startedAt',v_started_at,'generation',v_generation);
end;
$$;
revoke all on function public.invox_reset_analytics(uuid) from public,anon,authenticated;
grant execute on function public.invox_reset_analytics(uuid) to service_role;

create or replace function public.invox_analytics_report(p_period text) returns jsonb
language plpgsql stable security invoker set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.statement_timestamp();
  v_local timestamp := v_now at time zone 'America/Sao_Paulo';
  v_start timestamp;
  v_last timestamp;
  v_step interval;
  v_start_utc timestamptz;
  v_started_at timestamptz;
  v_generation bigint;
  v_series jsonb;
  v_totals jsonb;
  v_platforms jsonb;
  v_all_time jsonb;
begin
  case p_period
    when 'day' then
      v_start := pg_catalog.date_trunc('day',v_local);
      v_last := pg_catalog.date_trunc('hour',v_local); v_step := interval '1 hour';
    when 'week' then
      v_start := pg_catalog.date_trunc('day',v_local)-interval '6 days';
      v_last := pg_catalog.date_trunc('day',v_local); v_step := interval '1 day';
    when 'month' then
      v_start := pg_catalog.date_trunc('day',v_local)-interval '29 days';
      v_last := pg_catalog.date_trunc('day',v_local); v_step := interval '1 day';
    when 'year' then
      v_start := pg_catalog.date_trunc('month',v_local)-interval '11 months';
      v_last := pg_catalog.date_trunc('month',v_local); v_step := interval '1 month';
    else raise exception 'Invalid analytics period' using errcode='22023';
  end case;
  v_start_utc := v_start at time zone 'America/Sao_Paulo';
  select analytics_started_at,analytics_generation into strict v_started_at,v_generation
    from public.invox_site_settings where id=true;
  with buckets as (
    select s as local_start,s at time zone 'America/Sao_Paulo' as utc_start,
      (s+v_step) at time zone 'America/Sao_Paulo' as utc_end
      from pg_catalog.generate_series(v_start,v_last,v_step) s
  ), counts as (
    select b.local_start,b.utc_start,coalesce(sum(a.page_views),0) as views,
      coalesce(sum(a.downloads_windows+a.downloads_macos+a.downloads_android),0) as downloads
    from buckets b left join public.invox_analytics_hourly a
      on a.generation=v_generation and a.bucket>=b.utc_start and a.bucket<b.utc_end and a.bucket<=v_now
    group by b.local_start,b.utc_start
  ) select coalesce(jsonb_agg(jsonb_build_object(
    'key',utc_start,
    'label',case when p_period='day' then pg_catalog.to_char(local_start,'HH24')||'h'
      when p_period='year' then (array['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'])[extract(month from local_start)::integer]||'/'||pg_catalog.to_char(local_start,'YY')
      else pg_catalog.to_char(local_start,'DD/MM') end,
    'views',views,'downloads',downloads
  ) order by utc_start),'[]'::jsonb) into v_series from counts;
  select jsonb_build_object('views',coalesce(sum(page_views),0),
    'downloads',coalesce(sum(downloads_windows+downloads_macos+downloads_android),0)),
    jsonb_build_array(
      jsonb_build_object('platform','windows','downloads',coalesce(sum(downloads_windows),0)),
      jsonb_build_object('platform','macos','downloads',coalesce(sum(downloads_macos),0)),
      jsonb_build_object('platform','android','downloads',coalesce(sum(downloads_android),0)))
    into v_totals,v_platforms from public.invox_analytics_hourly
    where generation=v_generation and bucket>=v_start_utc and bucket<=v_now;
  select jsonb_build_object('views',coalesce(sum(page_views),0),
    'downloads',coalesce(sum(downloads_windows+downloads_macos+downloads_android),0))
    into v_all_time from public.invox_analytics_hourly where generation=v_generation and bucket<=v_now;
  return jsonb_build_object('period',p_period,'timezone','America/Sao_Paulo','startedAt',v_started_at,
    'generation',v_generation,'range',jsonb_build_object('start',v_start_utc,'end',v_now),
    'series',v_series,'totals',v_totals,'platforms',v_platforms,'allTime',v_all_time);
end;
$$;
revoke all on function public.invox_analytics_report(text) from public,anon,authenticated;
grant execute on function public.invox_analytics_report(text) to service_role;

commit;

-- Multipart installer feature.
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

-- Broadcast only invalidation scopes. Business rows remain service-only.
begin;

create schema invox_private;
revoke all on schema invox_private from public,anon,authenticated,service_role;
grant usage on schema invox_private to authenticated,service_role;

-- A parameterless identity check is the only privileged lookup needed by RLS.
-- It reveals no account details and never trusts editable user_metadata.
create function invox_private.realtime_admin() returns boolean
language sql stable security definer set search_path='' as $$
  select (select auth.uid()) is not null and exists(
    select 1 from public.invox_admins a join auth.users u on u.id=a.user_id
    where a.user_id=(select auth.uid()) and a.enabled and u.email_confirmed_at is not null
      and pg_catalog.lower(u.email)=a.email
  );
$$;
revoke all on function invox_private.realtime_admin() from public,anon,authenticated,service_role;
grant execute on function invox_private.realtime_admin() to authenticated;

-- Realtime already owns/enables RLS on messages. Do not ALTER its schema.
create policy invox_admin_realtime_receive on realtime.messages
for select to authenticated using(
  extension='broadcast' and (select realtime.topic())='invox:admin'
  and (select invox_private.realtime_admin())
);
-- Narrow guards prevent unrelated broad policies from opening INVOX's topic.
create policy invox_admin_realtime_read_guard on realtime.messages as restrictive
for select to authenticated using(
  (select realtime.topic()) is distinct from 'invox:admin'
  or(extension='broadcast' and (select invox_private.realtime_admin()))
);
create policy invox_admin_realtime_anon_guard on realtime.messages as restrictive
for select to anon using((select realtime.topic()) is distinct from 'invox:admin');
create policy invox_admin_realtime_write_guard on realtime.messages as restrictive
for insert to anon,authenticated
with check((select realtime.topic()) is distinct from 'invox:admin');

create function invox_private.emit_invalidation(p_scope text,p_site boolean default false) returns void
language plpgsql security invoker set search_path='' as $$
begin
  if p_scope is null or p_scope not in('feedback','analytics','settings','installers','all') or p_site is null
    or(p_site and p_scope not in('settings','installers')) then
    raise exception 'Invalid INVOX notification scope' using errcode='22023';
  end if;
  -- Notifications are best effort: Realtime availability must not abort writes.
  begin
    perform realtime.send(jsonb_build_object('scope',p_scope),'invalidate','invox:admin',true);
  exception when others then raise warning 'INVOX realtime notification unavailable'; end;
  if p_site then
    begin
      perform realtime.send(jsonb_build_object('scope',p_scope),'invalidate','invox:site',false);
    exception when others then raise warning 'INVOX realtime notification unavailable'; end;
  end if;
end; $$;

create function invox_private.notify_settings() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='UPDATE' then
    if row(new.visibility,new.download_password_hash,new.version,new.release_notes)
      is distinct from row(old.visibility,old.download_password_hash,old.version,old.release_notes) then
      perform invox_private.emit_invalidation('settings',true);
    end if;
    if row(new.analytics_generation,new.analytics_started_at)
      is distinct from row(old.analytics_generation,old.analytics_started_at) then
      perform invox_private.emit_invalidation('analytics');
    end if;
  else
    perform invox_private.emit_invalidation('settings',true);
    perform invox_private.emit_invalidation('analytics');
  end if;
  return null;
end; $$;

create function invox_private.notify_table() returns trigger
language plpgsql security invoker set search_path='' as $$
declare v_changed boolean:=true;
begin
  case tg_table_name
    when 'invox_feedbacks' then
      if tg_op='UPDATE' then
        v_changed:=row(new.name,new.contact,new.message,new.status,new.note)
          is distinct from row(old.name,old.contact,old.message,old.status,old.note);
      end if;
      if v_changed then perform invox_private.emit_invalidation('feedback'); end if;
    when 'invox_installers' then
      perform invox_private.emit_invalidation('installers',true);
    when 'invox_analytics_hourly','invox_analytics_runs' then
      perform invox_private.emit_invalidation('analytics');
    when 'invox_admins' then
      perform invox_private.emit_invalidation('all');
    when 'invox_uploads' then
      if tg_op='UPDATE' then
        v_changed:=row(new.platform,new.size,new.version,new.published)
          is distinct from row(old.platform,old.size,old.version,old.published);
      end if;
      if v_changed then perform invox_private.emit_invalidation('installers'); end if;
    when 'invox_multipart_uploads' then
      if tg_op='UPDATE' then
        -- Part tickets only update timestamps; do not emit 77 redundant events.
        v_changed:=row(new.platform,new.size,new.version,new.status,new.cleanup_after)
          is distinct from row(old.platform,old.size,old.version,old.status,old.cleanup_after);
      end if;
      if v_changed then perform invox_private.emit_invalidation('installers'); end if;
    else raise exception 'Invalid INVOX notification table' using errcode='22023';
  end case;
  return null;
end; $$;

revoke all on function invox_private.emit_invalidation(text,boolean),invox_private.notify_settings(),invox_private.notify_table()
  from public,anon,authenticated,service_role;
grant execute on function invox_private.emit_invalidation(text,boolean),invox_private.notify_settings(),invox_private.notify_table()
  to service_role;

create trigger invox_settings_realtime after insert or update or delete on public.invox_site_settings
for each row execute function invox_private.notify_settings();
create trigger invox_feedback_realtime after insert or update or delete on public.invox_feedbacks
for each row execute function invox_private.notify_table();
create trigger invox_installers_realtime after insert or update or delete on public.invox_installers
for each row execute function invox_private.notify_table();
create trigger invox_analytics_hourly_realtime after insert or update or delete on public.invox_analytics_hourly
for each row execute function invox_private.notify_table();
create trigger invox_analytics_runs_realtime after insert or update or delete on public.invox_analytics_runs
for each row execute function invox_private.notify_table();
create trigger invox_admins_realtime after insert or update or delete on public.invox_admins
for each row execute function invox_private.notify_table();
create trigger invox_uploads_realtime after insert or update or delete on public.invox_uploads
for each row execute function invox_private.notify_table();
create trigger invox_multipart_uploads_realtime after insert or update or delete on public.invox_multipart_uploads
for each row execute function invox_private.notify_table();

commit;

-- Installer version history feature.
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
