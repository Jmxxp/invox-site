-- Existing feedback and its administration remain private behind invox-api.
-- Preserve historical contacts; new clients provide only name and message.
alter table public.invox_feedbacks alter column contact drop not null;
alter table public.invox_feedbacks
  add column kind text not null default 'feedback'
    check (kind in ('feedback', 'suggestion')),
  add column source text not null default 'site'
    check (source in ('site', 'game'));
