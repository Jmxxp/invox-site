-- Privileged rollback fixture. No Storage writes, deletes or uploads.
begin;
do $$
declare
  admin_id uuid; old public.invox_installers%rowtype; before_history jsonb; before_objects jsonb;
  result jsonb; replay jsonb; finished jsonb; denied boolean; pending_count bigint;
begin
  select user_id into strict admin_id from public.invox_admins where enabled and user_id is not null order by email limit 1;
  select * into strict old from public.invox_installers where platform='windows';
  if old.current_history_id is null then raise exception 'Published Windows history required';end if;
  if exists(select 1 from public.invox_installer_replacements where history_id=old.current_history_id) then raise exception 'Unreplaced revision required';end if;
  select coalesce(jsonb_agg(to_jsonb(h) order by h.id),'[]'::jsonb) into before_history from public.invox_installer_history h;
  select coalesce(jsonb_agg(to_jsonb(o) order by o.id),'[]'::jsonb) into before_objects from storage.objects o;
  denied:=false;
  begin perform public.invox_prepare_installer_replacement(admin_id,'windows',old.current_history_id,old.file_name,1610612736,old.version,1000000000);
  exception when others then if sqlerrm='invox_storage_quota_exceeded' then denied:=true;else raise;end if;end;
  if not denied or not exists(select 1 from public.invox_installers i where to_jsonb(i)=to_jsonb(old))
    or exists(select 1 from public.invox_installer_replacements where history_id=old.current_history_id) then raise exception 'Capacity preflight changed current installer';end if;
  denied:=false;
  begin perform public.invox_prepare_installer_replacement(admin_id,'windows',gen_random_uuid(),old.file_name,old.size,old.version,1000000000);
  exception when others then if sqlerrm='invox_installer_changed' then denied:=true;else raise;end if;end;
  if not denied then raise exception 'Stale history bypassed CAS';end if;
  denied:=false;
  begin perform public.invox_prepare_installer_replacement(gen_random_uuid(),'windows',old.current_history_id,old.file_name,old.size,old.version,1000000000);
  exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Unauthorized admin staged replacement';end if;
  result:=public.invox_prepare_installer_replacement(admin_id,'windows',old.current_history_id,old.file_name,old.size,old.version,1000000000);
  if result->'replacement'->>'historyId'<>old.current_history_id::text or not(result->>'replacementPending')::boolean
    or(result->>'releasedBytes')::bigint<>0 or exists(select 1 from public.invox_installers where platform='windows') then raise exception 'Prepare failed unavailable staging or released quota prematurely';end if;
  if old.multipart_upload_id is not null then
    if not exists(select 1 from public.invox_multipart_uploads where id=old.multipart_upload_id and status='cancelled' and storage_released_at is null)
      or result->>'bucket'<>'invox-installer-parts' or jsonb_array_length(result->'paths')<>(select count(*) from public.invox_multipart_parts where upload_id=old.multipart_upload_id) then raise exception 'Multipart ledger or scope incorrect';end if;
  else
    if result->>'bucket'<>'invox-installers' or result->'paths'<>jsonb_build_array(old.path)
      or exists(select 1 from public.invox_uploads where path=old.path) then raise exception 'Single installer source scope incorrect';end if;
  end if;
  replay:=public.invox_prepare_installer_replacement(admin_id,'windows',old.current_history_id,old.file_name,old.size,old.version,1000000000);
  if replay is distinct from result then raise exception 'Retry created a different job';end if;
  denied:=false;
  begin perform public.invox_prepare_installer_replacement(admin_id,'windows',old.current_history_id,old.file_name,old.size+1,old.version,1000000000);
  exception when others then if sqlerrm='invox_replacement_conflict' then denied:=true;else raise;end if;end;
  if not denied then raise exception 'Replay accepted different parameters';end if;
  select count(*) into pending_count from jsonb_array_elements_text(result->'paths') p join storage.objects o
    on o.bucket_id=result->>'bucket' and o.name=p.value where(o.metadata->>'size')::bigint>1;
  if pending_count<1 then raise exception 'Existing full-size source objects required; this fixture never modifies Storage';end if;
  finished:=public.invox_finish_installer_replacement(admin_id,old.current_history_id);
  if not(finished->>'replacementPending')::boolean or(finished->>'releasedBytes')::bigint<>0
    or finished->'replacement'->>'completedAt' is not null
    or exists(select 1 from public.invox_installer_replacements where history_id=old.current_history_id and completed_at is not null)
    or(old.multipart_upload_id is not null and exists(select 1 from public.invox_multipart_uploads where id=old.multipart_upload_id and storage_released_at is not null)) then raise exception 'Unsealed Storage released reservation';end if;
  if(select coalesce(jsonb_agg(to_jsonb(h) order by h.id),'[]'::jsonb) from public.invox_installer_history h) is distinct from before_history then raise exception 'Version history changed';end if;
  if(select coalesce(jsonb_agg(to_jsonb(o) order by o.id),'[]'::jsonb) from storage.objects o) is distinct from before_objects then raise exception 'Storage changed';end if;
  if has_function_privilege('anon','public.invox_prepare_installer_replacement(uuid,text,uuid,text,bigint,text,bigint)','EXECUTE')
    or has_function_privilege('authenticated','public.invox_finish_installer_replacement(uuid,uuid)','EXECUTE')
    or has_table_privilege('anon','public.invox_installer_replacements','SELECT') then raise exception 'Replacement internals exposed';end if;
end; $$;
select 'Replacement preflight, CAS, staging, immutable retry, history and unsealed reservation checks passed; Storage untouched' as validation;
rollback;
