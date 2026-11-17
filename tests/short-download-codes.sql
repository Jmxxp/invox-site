-- Privileged rollback fixtures: no installer, analytics or user token is consumed.
begin;
do $$
declare
  admin_id uuid;single_id uuid:=gen_random_uuid();legacy_id uuid:=gen_random_uuid();collision_id uuid:=gen_random_uuid();batch_id uuid:=gen_random_uuid();bad_batch uuid:=gen_random_uuid();
  used_id uuid;revoked_id uuid;expired_id uuid;manifest jsonb;result jsonb;replay jsonb;pool jsonb;selection jsonb;hash text;denied boolean;excluded uuid[];
begin
  select user_id into strict admin_id from public.invox_admins where enabled and user_id is not null order by email limit 1;
  hash:=replace(single_id::text,'-','')||replace(single_id::text,'-','');
  result:=public.invox_create_short_code(admin_id,single_id,hash,'QA short',2,null,7);
  if result->'metadata'->>'formatVersion'<>'1' or result->'metadata'->>'nonce'<>'7' or result->'metadata'->'entry'->>'codeFormat'<>'short' then raise exception 'Short format metadata failed';end if;
  replay:=public.invox_create_short_code(admin_id,single_id,repeat('f',64),'QA short',2,null,0);
  if result->'metadata' is distinct from replay->'metadata' then raise exception 'Single replay replaced delivered code';end if;
  denied:=false;
  begin perform public.invox_create_short_code(admin_id,collision_id,hash,'',1,null,0);
  exception when others then if sqlerrm='invox_code_collision' then denied:=true;else raise;end if;end;
  if not denied or exists(select 1 from public.invox_download_codes where id=collision_id) then raise exception 'Hash collision was not atomic';end if;
  perform public.invox_create_download_code(admin_id,legacy_id,replace(legacy_id::text,'-','')||replace(legacy_id::text,'-',''),'QA legacy',1,null);
  replay:=public.invox_lookup_code_creation(admin_id,legacy_id,'QA legacy',1,null);
  if replay->'metadata'->>'formatVersion'<>'0' then raise exception 'Legacy format not preserved';end if;
  select jsonb_agg(jsonb_build_object('id',entry_id,'hash',replace(entry_id::text,'-','')||replace(entry_id::text,'-',''),'nonce',3) order by n) into manifest
    from(select n,gen_random_uuid() entry_id from generate_series(1,3) n) entries;
  denied:=false;
  begin perform public.invox_create_short_codes(admin_id,bad_batch,'',3,1,null,jsonb_set(manifest,'{1,hash}',to_jsonb(hash)));
  exception when others then if sqlerrm='invox_code_collision' then denied:=true;else raise;end if;end;
  if not denied or exists(select 1 from public.invox_download_code_batches where id=bad_batch)
    or exists(select 1 from public.invox_download_codes c join jsonb_array_elements(manifest) e on c.id=(e->>'id')::uuid) then raise exception 'Batch collision left partial rows';end if;
  result:=public.invox_create_short_codes(admin_id,batch_id,'QA short batch',3,2,null,manifest);
  replay:=public.invox_create_short_codes(admin_id,batch_id,'QA short batch',3,2,null,null);
  if result->'metadata' is distinct from replay->'metadata' then raise exception 'Batch retry did not use persisted nonce/manifest';end if;
  replay:=public.invox_lookup_code_batch(admin_id,batch_id,'QA short batch',3,2,null);
  if replay->'metadata' is distinct from result->'metadata' then raise exception 'Batch recovery changed delivered tokens';end if;
  used_id:=(manifest->0->>'id')::uuid;revoked_id:=(manifest->1->>'id')::uuid;expired_id:=(manifest->2->>'id')::uuid;
  update public.invox_download_codes set used_count=1 where id=used_id;
  perform public.invox_revoke_download_code(admin_id,revoked_id);
  update public.invox_download_codes set created_at=clock_timestamp()-interval '2 hours',valid_for_hours=1,expires_at=clock_timestamp()-interval '1 hour' where id=expired_id;
  update public.invox_download_codes set created_at='2020-01-01T00:00:00Z' where id=single_id;
  pool:=public.invox_admin_code_pool(admin_id);
  if not exists(select 1 from jsonb_array_elements(pool->'valid') e where e->'entry'->>'id'=single_id::text)
    or not exists(select 1 from jsonb_array_elements(pool->'used') e where e->'entry'->>'id'=used_id::text and e->'entry'->>'remainingUses'='1')
    or not exists(select 1 from jsonb_array_elements(pool->'inactive') e where e->'entry'->>'id'=revoked_id::text)
    or not exists(select 1 from jsonb_array_elements(pool->'inactive') e where e->'entry'->>'id'=expired_id::text)
    or not exists(select 1 from jsonb_array_elements(pool->'legacy') e where e->>'id'=legacy_id::text) then raise exception 'Pool classification failed';end if;
  if exists(select 1 from jsonb_array_elements(pool->'valid') e where(e->'entry'->>'id')::uuid in(used_id,revoked_id,expired_id,legacy_id)) then raise exception 'Used/inactive/legacy redistributed';end if;
  select coalesce(array_agg(id),'{}'::uuid[]) into excluded from public.invox_download_codes where code_format=1 and used_count=0 and revoked_at is null
    and(expires_at is null or expires_at>statement_timestamp()) and id<>single_id;
  if cardinality(excluded)<=499 then
    selection:=public.invox_select_copy_download_codes(admin_id,100,excluded);
    if selection->>'availableCount'<>'1' or jsonb_array_length(selection->'metadata')<>1 or selection->'metadata'->0->'entry'->>'id'<>single_id::text then raise exception 'Copy selection or partial count failed';end if;
    selection:=public.invox_select_copy_download_codes(admin_id,100,excluded||array[single_id]);
    if selection->>'availableCount'<>'0' or selection->'metadata'<>'[]'::jsonb then raise exception 'Empty selection failed';end if;
  end if;
  if(select used_count from public.invox_download_codes where id=single_id)<>0 then raise exception 'Copy consumed a token';end if;
  denied:=false;
  begin perform public.invox_select_copy_download_codes(gen_random_uuid(),1,'{}'::uuid[]);
  exception when insufficient_privilege then denied:=true;end;
  if not denied or has_function_privilege('anon','public.invox_admin_code_pool(uuid)','EXECUTE')
    or has_function_privilege('authenticated','public.invox_select_copy_download_codes(uuid,integer,uuid[])','EXECUTE') then raise exception 'Pool authorization exposed';end if;
end; $$;
select 'Short metadata, collision rollback, stable recovery, used partition and fresh copy selection passed' as validation;
rollback;
