-- After both additive migrations on the confirmed INVOX project.
-- Fixture writes are transactional and never become visible to players.
begin;
do $$
declare
  feedback_id uuid;
  suggestion_id uuid;
  announcement_id uuid;
  admin_id uuid;
begin
  assert exists (select 1 from information_schema.columns where table_schema='public' and table_name='invox_feedbacks' and column_name='contact' and is_nullable='YES'), 'Contact must be optional';
  assert (select relrowsecurity from pg_class where oid='public.invox_feedbacks'::regclass), 'Feedback RLS must stay enabled';
  assert (select relrowsecurity from pg_class where oid='public.invox_announcements'::regclass), 'Announcement RLS must stay enabled';
  assert not has_table_privilege('anon','public.invox_feedbacks','SELECT,INSERT,UPDATE,DELETE'), 'Anonymous feedback access must stay server-mediated';
  assert not has_table_privilege('authenticated','public.invox_feedbacks','SELECT,INSERT,UPDATE,DELETE'), 'Authenticated feedback access must stay server-mediated';
  assert not has_table_privilege('anon','public.invox_announcements','SELECT,INSERT,UPDATE,DELETE'), 'No direct public announcement table access';
  assert not has_table_privilege('authenticated','public.invox_announcements','SELECT,INSERT,UPDATE,DELETE'), 'No direct authenticated announcement table access';
  insert into public.invox_feedbacks(name,message,kind,source) values('Fixture feedback','Verificação transacional do feedback.','feedback','game') returning id into feedback_id;
  insert into public.invox_feedbacks(name,message,kind,source) values('Fixture suggestion','Verificação transacional da sugestão.','suggestion','game') returning id into suggestion_id;
  assert (select contact is null and status='new' and source='game' from public.invox_feedbacks where id=feedback_id), 'New feedback stores no contact';
  assert (select contact is null and kind='suggestion' and source='game' from public.invox_feedbacks where id=suggestion_id), 'Suggestion and source must persist';
  update public.invox_feedbacks set status='answered',note='Fixture internal note' where id=suggestion_id;
  assert (select status='answered' and note='Fixture internal note' from public.invox_feedbacks where id=suggestion_id), 'Internal classification must persist';
  select user_id into admin_id from public.invox_admins where enabled and user_id is not null limit 1;
  assert admin_id is not null, 'A confirmed existing administrator is needed';
  insert into public.invox_announcements(title,message,created_by) values('Fixture announcement','Recado transacional; não será publicado.',admin_id) returning id into announcement_id;
  assert (select active and published_at is not null from public.invox_announcements where id=announcement_id), 'Published metadata must be present';
  update public.invox_announcements set active=false where id=announcement_id;
  assert (select not active from public.invox_announcements where id=announcement_id), 'Announcement deactivation must persist within the transaction';
end;
$$;
rollback;
