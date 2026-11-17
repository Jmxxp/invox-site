-- Draft/history is private. Only invox-api exposes active announcement content.
create table public.invox_announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 100),
  message text not null check (char_length(btrim(message)) between 1 and 2000),
  active boolean not null default true,
  published_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id)
);
create index invox_announcements_active_recent_idx
  on public.invox_announcements (active, published_at desc, id desc);
alter table public.invox_announcements enable row level security;
revoke all on table public.invox_announcements from public, anon, authenticated;
grant all on table public.invox_announcements to service_role;
