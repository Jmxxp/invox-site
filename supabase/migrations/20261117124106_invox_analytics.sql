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
