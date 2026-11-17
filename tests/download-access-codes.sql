-- Privileged rollback test. Uses existing published bytes; never writes Storage.
begin;
do $$
declare
  admin_id uuid;code_id uuid:=gen_random_uuid();req uuid:=gen_random_uuid();other_req uuid:=gen_random_uuid();
  code_hash text:=repeat('a',64);ticket_hash text:=repeat('b',64);standard_hash text:=repeat('e',64);
  c jsonb;c_retry jsonb;p jsonb;g jsonb;g_retry jsonb;v_platform text;v_mp uuid;v_gen bigint;v_mode bigint;denied boolean;expiry timestamptz;
begin
  select user_id into strict admin_id from public.invox_admins where enabled and user_id is not null order by email limit 1;
  perform id from public.invox_site_settings where id=true for update;
  update public.invox_site_settings set visibility='private',download_universal_enabled=false,download_password_hash=null where id=true;
  c:=public.invox_create_download_code(admin_id,code_id,code_hash,'QA rollback',1,null);
  c_retry:=public.invox_create_download_code(admin_id,code_id,code_hash,'QA rollback',1,null);
  if c->'entry' is distinct from c_retry->'entry' or(c->'entry'->>'remainingUses')::integer<>1 or c->'entry'->>'expiresAt' is not null then raise exception 'Code create idempotency/default failed';end if;
  denied:=false;
  begin perform public.invox_create_download_code(admin_id,code_id,code_hash,'QA rollback',2,null);
  exception when others then if sqlerrm='invox_code_creation_conflict' then denied:=true;else raise;end if;end;
  if not denied then raise exception 'Code creation changed immutable parameters';end if;
  denied:=false;
  begin perform public.invox_create_download_code(gen_random_uuid(),gen_random_uuid(),repeat('f',64),'',1,null);
  exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Unauthorized code creation accepted';end if;
  select platform,multipart_upload_id into v_platform,v_mp from public.invox_installers where multipart_upload_id is not null order by platform limit 1;
  if v_mp is not null then
    p:=public.invox_prepare_code_download(code_hash,req,v_platform);
    if(p->>'committed')::boolean then raise exception 'Prepare unexpectedly consumed';end if;
    if(select used_count from public.invox_download_codes where id=code_id)<>0 then raise exception 'Prepare spent a code';end if;
    denied:=false;
    begin perform public.invox_commit_code_download(code_hash,req,v_platform,(p->>'modeGeneration')::bigint,p->'installer'||jsonb_build_object('version','999.999.999'),ticket_hash);
    exception when others then if sqlerrm='invox_download_changed' then denied:=true;else raise;end if;end;
    if not denied or(select used_count from public.invox_download_codes where id=code_id)<>0 then raise exception 'Changed snapshot consumed';end if;
    g:=public.invox_commit_code_download(code_hash,req,v_platform,(p->>'modeGeneration')::bigint,p->'installer',ticket_hash);
    g_retry:=public.invox_commit_code_download(code_hash,req,v_platform,(p->>'modeGeneration')::bigint,p->'installer',ticket_hash);
    if g is distinct from g_retry or(select used_count from public.invox_download_codes where id=code_id)<>1 then raise exception 'One logical grant consumed twice';end if;
    denied:=false;
    begin perform public.invox_prepare_code_download(code_hash,other_req,v_platform);
    exception when others then if sqlerrm='invox_code_exhausted' then denied:=true;else raise;end if;end;
    if not denied then raise exception 'Exhausted code accepted a new attempt';end if;
    denied:=false;
    begin perform public.invox_commit_code_download(code_hash,other_req,v_platform,(p->>'modeGeneration')::bigint,p->'installer',repeat('f',64));
    exception when others then if sqlerrm='invox_code_exhausted' then denied:=true;else raise;end if;end;
    if not denied then raise exception 'Second contender consumed an exhausted code';end if;
    -- Standard tickets are universal-generation bound; code tickets are not.
    perform public.invox_mint_multipart_download(v_mp,standard_hash,(select download_access_generation from public.invox_site_settings where id=true),false,null);
  end if;
  update public.invox_site_settings set download_universal_enabled=true,download_password_hash=repeat('x',64) where id=true;
  select download_access_generation,download_mode_generation into v_gen,v_mode from public.invox_site_settings where id=true;
  expiry:=public.invox_issue_universal_session(repeat('c',64),repeat('d',64),v_gen);
  if expiry<=clock_timestamp()+interval '29 days' then raise exception 'Universal grant is not persistent';end if;
  update public.invox_site_settings set download_universal_enabled=false where id=true;
  update public.invox_site_settings set download_universal_enabled=true where id=true;
  if v_gen=(select download_access_generation from public.invox_site_settings where id=true)
    or v_mode<>(select download_mode_generation from public.invox_site_settings where id=true) then raise exception 'Universal/mode generation separation failed';end if;
  if(select access_generation from public.invox_download_sessions where token_hash=repeat('c',64))=(select download_access_generation from public.invox_site_settings where id=true) then raise exception 'Old universal grant resurrected';end if;
  denied:=false;
  begin perform public.invox_issue_universal_session(repeat('f',64),repeat('d',64),v_gen);
  exception when others then if sqlerrm='invox_universal_changed' then denied:=true;else raise;end if;end;
  if not denied then raise exception 'Stale universal verification issued a session';end if;
  if v_mp is not null then
    perform public.invox_download_multipart_part(ticket_hash,0);
    perform public.invox_count_multipart_download(ticket_hash);
    perform public.invox_count_multipart_download(ticket_hash);
    if(select used_count from public.invox_download_codes where id=code_id)<>1 then raise exception 'Multipart parts spent extra uses';end if;
    perform public.invox_revoke_download_code(admin_id,code_id);
    p:=public.invox_prepare_code_download(code_hash,req,v_platform);
    if not(p->>'committed')::boolean then raise exception 'Redeemed grant lost on future revocation';end if;
    perform public.invox_download_multipart_part(ticket_hash,0);
    denied:=false;
    begin perform public.invox_download_multipart_part(standard_hash,0);
    exception when others then if sqlerrm='invox_download_ticket_expired' then denied:=true;else raise;end if;end;
    if not denied then raise exception 'Old universal ticket survived generation change';end if;
    update public.invox_site_settings set visibility='public' where id=true;
    denied:=false;
    begin perform public.invox_download_multipart_part(ticket_hash,0);
    exception when others then if sqlerrm='invox_download_ticket_expired' then denied:=true;else raise;end if;end;
    if not denied then raise exception 'Code grant survived a full mode change';end if;
  end if;
  if has_table_privilege('anon','public.invox_download_codes','SELECT') or has_table_privilege('authenticated','public.invox_code_downloads','SELECT')
    or has_function_privilege('authenticated','public.invox_commit_code_download(text,uuid,text,bigint,jsonb,text)','EXECUTE') then raise exception 'Code or grant privileges exposed';end if;
end; $$;
select 'Code use bounds, snapshot binding, idempotency, generation isolation, MP parts and private ACL passed' as validation;
rollback;
