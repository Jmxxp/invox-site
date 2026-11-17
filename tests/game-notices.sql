-- Administrative notices only. All fixtures and notifications are rolled back.
begin;
do $$
declare a uuid;n uuid:=gen_random_uuid();direct_id uuid:=gen_random_uuid();r jsonb;again jsonb;before_state jsonb;denied boolean;
begin
  select user_id into strict a from public.invox_admins where enabled and user_id is not null order by email limit 1;
  before_state:=(select to_jsonb(s) from public.invox_site_settings s where id=true);
  r:=public.invox_save_game_notice(a,n,0,'Aviso técnico','Mensagem temporária de teste.','info',12,false);
  if r->'notice'->>'status'<>'draft' or(r->'notice'->>'revision')::integer<>1 or r->'notice'->>'target'<>'lobby'
    or r->'notice'->>'publishedAt' is not null then raise exception 'Draft creation failed';end if;
  again:=public.invox_save_game_notice(a,n,0,'Aviso técnico','Mensagem temporária de teste.','info',12,false);
  if r->'notice' is distinct from again->'notice' then raise exception 'Create retry was not idempotent';end if;
  r:=public.invox_save_game_notice(a,n,1,'Aviso revisado','Mensagem atualizada.','update',18,false);
  if(r->'notice'->>'revision')::integer<>2 then raise exception 'Draft update did not increment revision';end if;
  again:=public.invox_save_game_notice(a,n,1,'Aviso revisado','Mensagem atualizada.','update',18,false);
  if r->'notice' is distinct from again->'notice' then raise exception 'Update retry changed timestamps';end if;
  denied:=false;
  begin perform public.invox_save_game_notice(a,n,1,'Conflito','Texto diferente.','info',12,false);
  exception when serialization_failure then denied:=true;end;
  if not denied then raise exception 'Stale update accepted';end if;
  r:=public.invox_transition_game_notice(a,n,2,'publish');
  if r->'notice'->>'status'<>'published' or r->'notice'->>'publishedAt' is null or(r->'notice'->>'revision')::integer<>3 then raise exception 'Activation failed';end if;
  again:=public.invox_transition_game_notice(a,n,2,'publish');
  if r->'notice' is distinct from again->'notice' then raise exception 'Publication retry was not idempotent';end if;
  denied:=false;
  begin perform public.invox_save_game_notice(a,n,3,'Alterar ativo','Texto alterado.','info',12,true);
  exception when serialization_failure then denied:=true;end;
  if not denied then raise exception 'Published content changed';end if;
  r:=public.invox_transition_game_notice(a,n,3,'archive');
  if r->'notice'->>'status'<>'archived' or r->'notice'->>'archivedAt' is null or(r->'notice'->>'revision')::integer<>4 then raise exception 'Archival failed';end if;
  again:=public.invox_transition_game_notice(a,n,3,'archive');
  if r->'notice' is distinct from again->'notice' then raise exception 'Archive retry changed timestamps';end if;
  denied:=false;
  begin perform public.invox_transition_game_notice(a,n,4,'publish');exception when serialization_failure then denied:=true;end;
  if not denied then raise exception 'Archived notice reactivated';end if;
  r:=public.invox_save_game_notice(a,direct_id,0,'Publicação direta','Mensagem temporária.','maintenance',5,true);
  if r->'notice'->>'status'<>'published' or(r->'notice'->>'revision')::integer<>1 then raise exception 'Direct publication failed';end if;
  again:=public.invox_save_game_notice(a,direct_id,0,'Publicação direta','Mensagem temporária.','maintenance',5,true);
  if r->'notice' is distinct from again->'notice' then raise exception 'Direct publication duplicated';end if;
  denied:=false;
  begin perform public.invox_save_game_notice(gen_random_uuid(),gen_random_uuid(),0,'Acesso','Não autorizado.','info',12,false);
  exception when insufficient_privilege then denied:=true;end;
  if not denied then raise exception 'Unknown administrator accepted';end if;
  denied:=false;
  begin perform invox_private.emit_invalidation('notices',true);exception when invalid_parameter_value then denied:=true;end;
  if not denied then raise exception 'Notice invalidation allowed onto public site';end if;
  if has_table_privilege('anon','public.invox_game_notices','SELECT') or has_table_privilege('authenticated','public.invox_game_notices','SELECT')
    or has_table_privilege('service_role','public.invox_game_notices','DELETE')
    or has_function_privilege('authenticated','public.invox_game_notices_list(uuid,integer)','EXECUTE')
    or has_function_privilege('anon','public.invox_transition_game_notice(uuid,uuid,integer,text)','EXECUTE') then raise exception 'Notice privilege leak';end if;
  if exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='invox_game_notices') then raise exception 'Notice rows exposed via Postgres Changes';end if;
  if before_state is distinct from(select to_jsonb(s) from public.invox_site_settings s where id=true) then raise exception 'Notices modified site configuration';end if;
end; $$;
select 'Game notices: drafts, direct activation, revision conflicts, immutable active content, idempotent transitions and admin-only grants passed' as validation;
rollback;
