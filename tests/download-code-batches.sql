-- Privileged rollback test; creates metadata only and never downloads bytes.
begin;
do $$
declare
  admin_id uuid;batch_id uuid:=gen_random_uuid();bad_id uuid:=gen_random_uuid();big_id uuid:=gen_random_uuid();
  manifest jsonb;big_manifest jsonb;result jsonb;retried jsonb;denied boolean;v_count integer;v_created timestamptz;
begin
  select user_id into strict admin_id from public.invox_admins where enabled and user_id is not null order by email limit 1;
  select jsonb_agg(jsonb_build_object('id',entry_id,'hash',replace(entry_id::text,'-','')||replace(entry_id::text,'-','')) order by n) into manifest
    from(select n,gen_random_uuid() entry_id from generate_series(1,3) n) entries;
  result:=public.invox_create_download_codes(admin_id,batch_id,'Lote QA rollback',3,1,null,manifest);
  if jsonb_array_length(result->'entries')<>3 or exists(select 1 from jsonb_array_elements(result->'entries') e
    where(e->>'usedCount')::integer<>0 or(e->>'maxUses')::integer<>1 or e->>'expiresAt' is not null or e ? 'hash' or e ? 'code') then
    raise exception 'Batch defaults or safe metadata failed';end if;
  retried:=public.invox_create_download_codes(admin_id,batch_id,'Lote QA rollback',3,1,null,manifest);
  if result->'entries' is distinct from retried->'entries' then raise exception 'Batch replay changed ordered IDs or timestamps';end if;
  select count(*) into v_count from public.invox_download_codes c join jsonb_array_elements(manifest) e on c.id=(e->>'id')::uuid;
  if v_count<>3 then raise exception 'Batch replay created extra codes';end if;
  denied:=false;
  begin perform public.invox_create_download_codes(admin_id,batch_id,'Lote QA rollback',2,1,null,manifest-2);
  exception when others then if sqlerrm='invox_code_creation_conflict' then denied:=true;else raise;end if;end;
  if not denied then raise exception 'Retry changed batch size';end if;
  denied:=false;
  begin perform public.invox_create_download_codes(admin_id,batch_id,'Outro rotulo',3,1,null,manifest);
  exception when others then if sqlerrm='invox_code_creation_conflict' then denied:=true;else raise;end if;end;
  if not denied then raise exception 'Retry changed immutable parameters';end if;
  denied:=false;
  begin perform public.invox_create_download_codes(admin_id,bad_id,'',3,1,null,manifest);
  exception when others then if sqlerrm='invox_code_creation_conflict' then denied:=true;else raise;end if;end;
  if not denied or exists(select 1 from public.invox_download_code_batches where id=bad_id) then raise exception 'Child collision left a partial batch';end if;
  denied:=false;
  begin perform public.invox_create_download_codes(admin_id,bad_id,'',3,1,null,jsonb_set(manifest,'{2,hash}','"invalid"'::jsonb));
  exception when invalid_parameter_value then denied:=true;end;
  if not denied or exists(select 1 from public.invox_download_code_batches where id=bad_id) then raise exception 'Invalid manifest left a partial batch';end if;
  denied:=false;
  begin perform public.invox_create_download_codes(gen_random_uuid(),bad_id,'',3,1,null,manifest);
  exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Unauthorized batch created';end if;
  select jsonb_agg(jsonb_build_object('id',entry_id,'hash',replace(entry_id::text,'-','')||replace(entry_id::text,'-','')) order by n) into big_manifest
    from(select n,gen_random_uuid() entry_id from generate_series(1,100) n) entries;
  result:=public.invox_create_download_codes(admin_id,big_id,'Lote maximo',100,1000,24,big_manifest);
  if jsonb_array_length(result->'entries')<>100 then raise exception 'Maximum batch size failed';end if;
  select created_at into v_created from public.invox_download_code_batches where id=big_id;
  if exists(select 1 from jsonb_array_elements(result->'entries') e where(e->>'maxUses')::integer<>1000
    or(e->>'createdAt')::timestamptz<>v_created or(e->>'expiresAt')::timestamptz<>v_created+interval '24 hours') then raise exception 'Batch server-clock expiry failed';end if;
  if has_table_privilege('anon','public.invox_download_code_batches','SELECT') or has_table_privilege('authenticated','public.invox_download_code_batches','INSERT')
    or has_table_privilege('service_role','public.invox_download_code_batches','UPDATE')
    or has_function_privilege('authenticated','public.invox_create_download_codes(uuid,uuid,text,integer,integer,integer,jsonb)','EXECUTE') then raise exception 'Batch privileges exposed';end if;
end; $$;
select 'Atomic batches, immutable retry, bounds, expiry and private ACL passed' as validation;
rollback;
