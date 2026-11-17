-- Run after the multipart migration, with a privileged connection. Leaves no data.
begin;
do $$
declare a uuid; u jsonb; u2 jsonb; p jsonb; q jsonb; initial_reserved bigint; rejected boolean;
begin
  select user_id into strict a from public.invox_admins where username='jmxxp' and enabled;
  initial_reserved:=(public.invox_storage_status(1000000000)->>'reservedBytes')::bigint;
  p:=jsonb_build_array(
    jsonb_build_object('index',0,'size',20971520,'sha256',repeat('a',64)),
    jsonb_build_object('index',1,'size',20971520,'sha256',repeat('b',64)),
    jsonb_build_object('index',2,'size',20971520,'sha256',repeat('c',64)),
    jsonb_build_object('index',3,'size',4194304,'sha256',repeat('d',64)));
  u:=public.invox_create_multipart_upload(a,'android','invox-transaction-qa.apk',67108864,'1.1.0-qa',repeat('e',64),repeat('f',64),p,1000000000);
  u2:=public.invox_create_multipart_upload(a,'android','invox-transaction-qa.apk',67108864,'1.1.0-qa',repeat('e',64),repeat('f',64),p,1000000000);
  if u->>'uploadId' is distinct from u2->>'uploadId' or u->>'status'<>'uploading' or jsonb_array_length(u->'completedParts')<>0 then raise exception 'Resume invariant failed'; end if;
  q:=public.invox_storage_status(1000000000);
  if (q->>'reservedBytes')::bigint-initial_reserved<>83886080 then raise exception 'Reservation accounting failed'; end if;
  rejected:=false;
  begin perform public.invox_finish_multipart_upload(a,(u->>'uploadId')::uuid);
  exception when sqlstate '22023' then rejected:=true; end;
  if not rejected then raise exception 'Incomplete upload accepted'; end if;
  rejected:=false;
  begin perform public.invox_create_multipart_upload(a,'android','quota-qa.apk',67108864,'1.1.0-qa',repeat('e',64),repeat('f',64),p,83886080);
  exception when others then if sqlerrm='invox_storage_quota_exceeded' then rejected:=true; else raise; end if; end;
  if not rejected then raise exception 'Quota overcommit accepted'; end if;
  if has_table_privilege('anon','public.invox_multipart_parts','SELECT') or has_table_privilege('authenticated','public.invox_multipart_downloads','SELECT') then raise exception 'Private metadata exposed'; end if;
  if has_function_privilege('anon','public.invox_storage_status(bigint)','EXECUTE') or has_function_privilege('authenticated','public.invox_finish_multipart_upload(uuid,uuid)','EXECUTE') then raise exception 'Private RPC exposed'; end if;
  perform public.invox_cancel_multipart_upload(a,(u->>'uploadId')::uuid);
  if exists(select 1 from jsonb_array_elements(public.invox_multipart_cleanup_due(a,5)) r where r->>'uploadId'=u->>'uploadId') then raise exception 'Unexpired upload authorization cleaned'; end if;
  update public.invox_multipart_uploads set cleanup_after=clock_timestamp()-interval '1 second' where id=(u->>'uploadId')::uuid;
  insert into public.invox_multipart_downloads(token_hash,upload_id,access_generation,is_preview,created_by,expires_at)
    values(repeat('9',64),(u->>'uploadId')::uuid,1,true,a,clock_timestamp()+interval '1 minute');
  if exists(select 1 from jsonb_array_elements(public.invox_multipart_cleanup_due(a,5)) r where r->>'uploadId'=u->>'uploadId') then raise exception 'Active download cleaned'; end if;
  rejected:=false;
  begin perform public.invox_purge_multipart_due(a,(u->>'uploadId')::uuid);
  exception when sqlstate '42501' then rejected:=true; end;
  if not rejected then raise exception 'Purge ignored active ticket'; end if;
  delete from public.invox_multipart_downloads where token_hash=repeat('9',64);
  if not exists(select 1 from jsonb_array_elements(public.invox_multipart_cleanup_due(a,5)) r where r->>'uploadId'=u->>'uploadId') then raise exception 'Expired cleanup not found'; end if;
  if not public.invox_purge_multipart_due(a,(u->>'uploadId')::uuid) then raise exception 'Expired empty session not purged'; end if;
  if (public.invox_storage_status(1000000000)->>'reservedBytes')::bigint<>initial_reserved then raise exception 'Purged session retained reservation'; end if;
end; $$;
select 'multipart reservation, resume, incomplete rejection, quota and grants passed' as validation;
rollback;
