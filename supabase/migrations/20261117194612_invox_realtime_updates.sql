-- Broadcast only invalidation scopes. Business rows remain service-only.
begin;

create schema invox_private;
revoke all on schema invox_private from public,anon,authenticated,service_role;
grant usage on schema invox_private to authenticated,service_role;

-- A parameterless identity check is the only privileged lookup needed by RLS.
-- It reveals no account details and never trusts editable user_metadata.
create function invox_private.realtime_admin() returns boolean
language sql stable security definer set search_path='' as $$
  select (select auth.uid()) is not null and exists(
    select 1 from public.invox_admins a join auth.users u on u.id=a.user_id
    where a.user_id=(select auth.uid()) and a.enabled and u.email_confirmed_at is not null
      and pg_catalog.lower(u.email)=a.email
  );
$$;
revoke all on function invox_private.realtime_admin() from public,anon,authenticated,service_role;
grant execute on function invox_private.realtime_admin() to authenticated;

-- Realtime already owns/enables RLS on messages. Do not ALTER its schema.
create policy invox_admin_realtime_receive on realtime.messages
for select to authenticated using(
  extension='broadcast' and (select realtime.topic())='invox:admin'
  and (select invox_private.realtime_admin())
);
-- Narrow guards prevent unrelated broad policies from opening INVOX's topic.
create policy invox_admin_realtime_read_guard on realtime.messages as restrictive
for select to authenticated using(
  (select realtime.topic()) is distinct from 'invox:admin'
  or(extension='broadcast' and (select invox_private.realtime_admin()))
);
create policy invox_admin_realtime_anon_guard on realtime.messages as restrictive
for select to anon using((select realtime.topic()) is distinct from 'invox:admin');
create policy invox_admin_realtime_write_guard on realtime.messages as restrictive
for insert to anon,authenticated
with check((select realtime.topic()) is distinct from 'invox:admin');

create function invox_private.emit_invalidation(p_scope text,p_site boolean default false) returns void
language plpgsql security invoker set search_path='' as $$
begin
  if p_scope is null or p_scope not in('feedback','analytics','settings','installers','all') or p_site is null
    or(p_site and p_scope not in('settings','installers')) then
    raise exception 'Invalid INVOX notification scope' using errcode='22023';
  end if;
  -- Notifications are best effort: Realtime availability must not abort writes.
  begin
    perform realtime.send(jsonb_build_object('scope',p_scope),'invalidate','invox:admin',true);
  exception when others then raise warning 'INVOX realtime notification unavailable'; end;
  if p_site then
    begin
      perform realtime.send(jsonb_build_object('scope',p_scope),'invalidate','invox:site',false);
    exception when others then raise warning 'INVOX realtime notification unavailable'; end;
  end if;
end; $$;

create function invox_private.notify_settings() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='UPDATE' then
    if row(new.visibility,new.download_password_hash,new.version,new.release_notes)
      is distinct from row(old.visibility,old.download_password_hash,old.version,old.release_notes) then
      perform invox_private.emit_invalidation('settings',true);
    end if;
    if row(new.analytics_generation,new.analytics_started_at)
      is distinct from row(old.analytics_generation,old.analytics_started_at) then
      perform invox_private.emit_invalidation('analytics');
    end if;
  else
    perform invox_private.emit_invalidation('settings',true);
    perform invox_private.emit_invalidation('analytics');
  end if;
  return null;
end; $$;

create function invox_private.notify_table() returns trigger
language plpgsql security invoker set search_path='' as $$
declare v_changed boolean:=true;
begin
  case tg_table_name
    when 'invox_feedbacks' then
      if tg_op='UPDATE' then
        v_changed:=row(new.name,new.contact,new.message,new.status,new.note)
          is distinct from row(old.name,old.contact,old.message,old.status,old.note);
      end if;
      if v_changed then perform invox_private.emit_invalidation('feedback'); end if;
    when 'invox_installers' then
      perform invox_private.emit_invalidation('installers',true);
    when 'invox_analytics_hourly','invox_analytics_runs' then
      perform invox_private.emit_invalidation('analytics');
    when 'invox_admins' then
      perform invox_private.emit_invalidation('all');
    when 'invox_uploads' then
      if tg_op='UPDATE' then
        v_changed:=row(new.platform,new.size,new.version,new.published)
          is distinct from row(old.platform,old.size,old.version,old.published);
      end if;
      if v_changed then perform invox_private.emit_invalidation('installers'); end if;
    when 'invox_multipart_uploads' then
      if tg_op='UPDATE' then
        -- Part tickets only update timestamps; do not emit 77 redundant events.
        v_changed:=row(new.platform,new.size,new.version,new.status,new.cleanup_after)
          is distinct from row(old.platform,old.size,old.version,old.status,old.cleanup_after);
      end if;
      if v_changed then perform invox_private.emit_invalidation('installers'); end if;
    else raise exception 'Invalid INVOX notification table' using errcode='22023';
  end case;
  return null;
end; $$;

revoke all on function invox_private.emit_invalidation(text,boolean),invox_private.notify_settings(),invox_private.notify_table()
  from public,anon,authenticated,service_role;
grant execute on function invox_private.emit_invalidation(text,boolean),invox_private.notify_settings(),invox_private.notify_table()
  to service_role;

create trigger invox_settings_realtime after insert or update or delete on public.invox_site_settings
for each row execute function invox_private.notify_settings();
create trigger invox_feedback_realtime after insert or update or delete on public.invox_feedbacks
for each row execute function invox_private.notify_table();
create trigger invox_installers_realtime after insert or update or delete on public.invox_installers
for each row execute function invox_private.notify_table();
create trigger invox_analytics_hourly_realtime after insert or update or delete on public.invox_analytics_hourly
for each row execute function invox_private.notify_table();
create trigger invox_analytics_runs_realtime after insert or update or delete on public.invox_analytics_runs
for each row execute function invox_private.notify_table();
create trigger invox_admins_realtime after insert or update or delete on public.invox_admins
for each row execute function invox_private.notify_table();
create trigger invox_uploads_realtime after insert or update or delete on public.invox_uploads
for each row execute function invox_private.notify_table();
create trigger invox_multipart_uploads_realtime after insert or update or delete on public.invox_multipart_uploads
for each row execute function invox_private.notify_table();

commit;
