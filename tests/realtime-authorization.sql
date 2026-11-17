-- Privileged connection; an enabled/confirmed real admin must exist.
-- All identity/allowlist changes below are transaction-local and rolled back.
begin;
do $$
declare v_admin uuid; v_other uuid:=gen_random_uuid(); v_denied boolean;
begin
  select a.user_id into strict v_admin from public.invox_admins a join auth.users u on u.id=a.user_id
    where a.enabled and u.email_confirmed_at is not null and lower(u.email)=a.email order by a.user_id limit 1;
  if has_schema_privilege('anon','invox_private','USAGE')
    or has_function_privilege('anon','invox_private.realtime_admin()','EXECUTE')
    or not has_function_privilege('authenticated','invox_private.realtime_admin()','EXECUTE') then
    raise exception 'Realtime identity helper grants incorrect';
  end if;
  if has_function_privilege('authenticated','invox_private.emit_invalidation(text,boolean)','EXECUTE')
    or has_function_privilege('anon','invox_private.emit_invalidation(text,boolean)','EXECUTE') then
    raise exception 'Client can invoke server notifier';
  end if;
  if has_table_privilege('authenticated','public.invox_admins','SELECT')
    or has_table_privilege('authenticated','public.invox_feedbacks','SELECT')
    or has_table_privilege('anon','public.invox_site_settings','SELECT') then
    raise exception 'Business table exposed for Realtime';
  end if;
  perform set_config('request.jwt.claim.sub',v_admin::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_admin,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  if not invox_private.realtime_admin() then raise exception 'Enabled administrator denied'; end if;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub',v_other::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_other,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  if invox_private.realtime_admin() then raise exception 'Non-allowlisted identity accepted'; end if;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claims','{}',true);
  execute 'set local role authenticated';
  if invox_private.realtime_admin() then raise exception 'Missing identity accepted'; end if;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub',v_admin::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_admin,'role','anon')::text,true);
  execute 'set local role anon';
  v_denied:=false;
  begin perform invox_private.realtime_admin();
  exception when insufficient_privilege then v_denied:=true; end;
  execute 'reset role';
  if not v_denied then raise exception 'Anonymous role can call privileged helper'; end if;
  update public.invox_admins set enabled=false where user_id=v_admin;
  perform set_config('request.jwt.claim.sub',v_admin::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_admin,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  if invox_private.realtime_admin() then raise exception 'Disabled administrator accepted'; end if;
  execute 'reset role';
  if not exists(select 1 from pg_catalog.pg_policy where polrelid='realtime.messages'::regclass
      and polname='invox_admin_realtime_receive' and polcmd='r' and polpermissive)
    or not exists(select 1 from pg_catalog.pg_policy where polrelid='realtime.messages'::regclass
      and polname='invox_admin_realtime_write_guard' and polcmd='a' and not polpermissive) then
    raise exception 'Realtime authorization policies missing';
  end if;
  if exists(select 1 from pg_catalog.pg_publication_tables where pubname='supabase_realtime'
      and schemaname='public' and tablename in('invox_feedbacks','invox_admins','invox_site_settings','invox_installers')) then
    raise exception 'Private business rows added to Postgres Changes';
  end if;
  if exists(select 1 from pg_catalog.pg_trigger where tgrelid='public.invox_multipart_parts'::regclass
      and not tgisinternal and tgname like '%realtime%') then
    raise exception 'Per-part notification flood configured';
  end if;
end; $$;
select 'Realtime identity, allowlist, anonymous denial, grants and policy guards passed' as validation;
rollback;
