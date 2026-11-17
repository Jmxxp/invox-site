-- Visitor grants contain no plaintext token or password.
create table public.invox_download_sessions (
  token_hash text primary key check (token_hash ~ '^[a-f0-9]{64}$'),
  password_fingerprint text not null check (password_fingerprint ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now()+interval '30 days'),
  check (expires_at > created_at)
);
create index invox_download_sessions_expiry_idx on public.invox_download_sessions(expires_at);
alter table public.invox_download_sessions enable row level security;
revoke all on public.invox_download_sessions from public,anon,authenticated;
grant all on public.invox_download_sessions to service_role;

create function public.invox_create_download_session(p_token_hash text,p_password_fingerprint text)
returns timestamptz
language plpgsql security invoker set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_expires timestamptz := v_now + interval '30 days';
begin
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$'
    or p_password_fingerprint is null or p_password_fingerprint !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid session hashes' using errcode = '22023';
  end if;
  insert into public.invox_download_sessions(token_hash,password_fingerprint,created_at,expires_at)
  values(p_token_hash,p_password_fingerprint,v_now,v_expires);
  delete from public.invox_download_sessions where token_hash in (
    select token_hash from public.invox_download_sessions where expires_at <= v_now
    order by expires_at limit 1000
  );
  return v_expires;
end;
$$;
revoke all on function public.invox_create_download_session(text,text) from public,anon,authenticated;
grant execute on function public.invox_create_download_session(text,text) to service_role;
