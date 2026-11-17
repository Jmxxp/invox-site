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
