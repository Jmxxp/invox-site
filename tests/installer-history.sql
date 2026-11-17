-- Metadata-only rollback test: no Storage writes and no committed public changes.
begin;
do $$
declare
  v_admin uuid;v_path text:='qa-history/'||gen_random_uuid()::text||'.dmg';
  v_first uuid;v_current uuid;v_count bigint;v_before jsonb;v_windows jsonb;v_history jsonb;
begin
  select user_id into strict v_admin from public.invox_admins where enabled and user_id is not null order by email limit 1;
  perform id from public.invox_site_settings where id=true for update;
  v_windows:=(select to_jsonb(i) from public.invox_installers i where platform='windows');
  insert into public.invox_uploads(path,platform,file_name,size,version,created_by) values(v_path,'macos','INVOX-QA.dmg',1,'0.0.1',v_admin);
  perform public.invox_publish_release('9.0.0','rollback',jsonb_build_array(jsonb_build_object('platform','macos','path',v_path,'fileName','INVOX-QA.dmg','size',1,'version','2.0.0')),v_admin);
  select current_history_id into v_first from public.invox_installers where platform='macos';
  if not exists(select 1 from public.invox_installer_history where id=v_first and version='2.0.0' and action='published' and not migrated)
    or(select version from public.invox_uploads where path=v_path)<>'0.0.1' then raise exception 'Publication rewrote the original version or omitted history';end if;
  perform public.invox_update_installer_version(v_admin,'macos','2.1.0');
  select to_jsonb(i) into v_before from public.invox_installers i where platform='macos';
  select count(*) into v_count from public.invox_installer_history;
  perform public.invox_update_installer_version(v_admin,'macos','2.1.0');
  if(select count(*) from public.invox_installer_history)<>v_count or v_before is distinct from(select to_jsonb(i) from public.invox_installers i where platform='macos') then raise exception 'No-op retry changed date/history';end if;
  perform public.invox_update_installer_version(v_admin,'macos','2.0.0');
  select current_history_id into v_current from public.invox_installers where platform='macos';
  v_history:=public.invox_installer_history_list(v_admin,100);
  if v_current=v_first or(select count(*) from jsonb_array_elements(v_history) h where h->>'platform'='macos' and(h->>'isCurrent')::boolean)<>1
    or exists(select 1 from jsonb_array_elements(v_history) h where h->>'id'=v_first::text and(h->>'isCurrent')::boolean) then raise exception 'Old identical label incorrectly became current';end if;
  if(select version from public.invox_site_settings where id=true)<>'9.0.0' then raise exception 'Metadata edit changed general version';end if;
  begin update public.invox_installer_history set version=version where id=v_first;raise exception 'History accepted UPDATE';exception when insufficient_privilege then null;end;
  begin delete from public.invox_installer_history where id=v_first;raise exception 'History accepted DELETE';exception when insufficient_privilege then null;end;
  begin perform public.invox_update_installer_version(gen_random_uuid(),'macos','3.0.0');raise exception 'Unknown administrator accepted';exception when insufficient_privilege then null;end;
  if has_table_privilege('anon','public.invox_installer_history','select') or has_table_privilege('authenticated','public.invox_installer_history','select')
    or has_table_privilege('service_role','public.invox_installer_history','update') or has_table_privilege('service_role','public.invox_installer_history','delete') then raise exception 'History privilege leak';end if;
  v_before:=(select to_jsonb(i) from public.invox_installers i where platform='macos');
  select count(*) into v_count from public.invox_installer_history;
  begin
    perform public.invox_publish_release('9.1.0','rollback failure',jsonb_build_array(
      jsonb_build_object('platform','macos','path',v_path,'fileName','INVOX-QA.dmg','size',1,'version','3.0.0'),
      jsonb_build_object('platform','android','path','qa-history/missing.apk','fileName','missing.apk','size',1)),v_admin);
    raise exception 'Invalid second manifest accepted';
  exception when invalid_parameter_value then null;end;
  if(select count(*) from public.invox_installer_history)<>v_count or v_before is distinct from(select to_jsonb(i) from public.invox_installers i where platform='macos') then raise exception 'Failed publication partially appended history';end if;
  if v_windows is distinct from(select to_jsonb(i) from public.invox_installers i where platform='windows') then raise exception 'Unrelated Windows installer changed';end if;
end; $$;
rollback;
