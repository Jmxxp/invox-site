-- Transactional integration check. Leaves all real counts unchanged.
begin;
select id from public.invox_site_settings where id=true for update;
create temporary table qa_analytics_before as
  select analytics_generation as generation,analytics_started_at as started_at,
    (select count(*) from public.invox_analytics_runs) as runs
  from public.invox_site_settings where id=true;
create temporary table qa_analytics_totals as
  select coalesce(sum(page_views),0) as views,
    coalesce(sum(downloads_windows+downloads_macos+downloads_android),0) as downloads
  from public.invox_analytics_hourly
  where generation=(select generation from qa_analytics_before);
create temporary table qa_analytics_events as
  select pg_catalog.gen_random_uuid() as before_id,pg_catalog.gen_random_uuid() as after_id;
select public.invox_record_analytics('page_view',(select before_id from qa_analytics_events),null);
create temporary table qa_analytics_reset as
  select public.invox_reset_analytics((select user_id from public.invox_admins where enabled limit 1)) as result;
create temporary table qa_analytics_empty as select public.invox_analytics_report('day') as result;
create temporary table qa_analytics_duplicate as
  select public.invox_record_analytics('page_view',(select before_id from qa_analytics_events),null) as result;
select public.invox_record_analytics('page_view',(select after_id from qa_analytics_events),null);
select public.invox_record_analytics('download',null,'windows');
select public.invox_record_analytics('download',null,'macos');
select public.invox_record_analytics('download',null,'android');
do $$
declare
  v_report jsonb;
  v_period text;
  v_old_views bigint;
  v_old_downloads bigint;
begin
  if (select (result->>'generation')::bigint from qa_analytics_reset)
    <>(select generation+1 from qa_analytics_before) then
    raise exception 'Reset generation invalid';
  end if;
  if (select result->'allTime'->>'views' from qa_analytics_empty)<>'0'
    or (select result->'allTime'->>'downloads' from qa_analytics_empty)<>'0' then
    raise exception 'Reset did not start empty';
  end if;
  if (select result from qa_analytics_duplicate) then
    raise exception 'Old view recounted after reset';
  end if;
  foreach v_period in array array['day','week','month','year'] loop
    v_report:=public.invox_analytics_report(v_period);
    if v_report->'allTime'->>'views'<>'1' or v_report->'allTime'->>'downloads'<>'3'
      or v_report->'totals'->>'views'<>'1' or v_report->'totals'->>'downloads'<>'3' then
      raise exception 'Wrong totals for %',v_period;
    end if;
    if (select sum((item->>'views')::bigint) from jsonb_array_elements(v_report->'series') item)<>1 then
      raise exception 'Wrong chart series';
    end if;
  end loop;
  select coalesce(sum(page_views),0),coalesce(sum(downloads_windows+downloads_macos+downloads_android),0)
    into v_old_views,v_old_downloads from public.invox_analytics_hourly
    where generation=(select generation from qa_analytics_before);
  if v_old_views<>(select views+1 from qa_analytics_totals)
    or v_old_downloads<>(select downloads from qa_analytics_totals) then
    raise exception 'Historical counts changed';
  end if;
  if (select count(*) from public.invox_analytics_runs)<>(select runs+1 from qa_analytics_before)
    or (select count(*) from public.invox_analytics_runs where ended_at is null)<>1 then
    raise exception 'Counting session history invalid';
  end if;
  if has_function_privilege('anon','public.invox_reset_analytics(uuid)','EXECUTE')
    or has_function_privilege('authenticated','public.invox_reset_analytics(uuid)','EXECUTE')
    or has_table_privilege('authenticated','public.invox_analytics_runs','SELECT') then
    raise exception 'Analytics permissions invalid';
  end if;
  begin
    perform public.invox_reset_analytics(null);
    raise exception 'Unauthorized reset allowed';
  exception when insufficient_privilege then null;
  end;
end;
$$;
rollback;
select true as transactional_analytics_checks_passed;
