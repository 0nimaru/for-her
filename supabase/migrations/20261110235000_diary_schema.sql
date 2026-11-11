-- Applied to project qjlnulbynqmhhoehbwrw via the Supabase MCP server.
-- Diary pages. Owner is the sha256 of a random secret that lives only on her device.
create table public.diary_entries (
  owner_hash   text        not null,
  entry_date   date        not null,
  body         text        not null default '',
  author       text,
  updated_at   timestamptz not null default now(),
  shared_body  text,
  shared_at    timestamptz,
  primary key (owner_hash, entry_date)
);

-- Andi's devices that receive push notifications.
create table public.diary_push_subs (
  endpoint     text primary key,
  subscription jsonb       not null,
  created_at   timestamptz not null default now()
);

-- Server-only settings (VAPID keys, mailbox token hash). Never exposed.
create table public.diary_config (
  key   text primary key,
  value text not null
);

alter table public.diary_entries   enable row level security;
alter table public.diary_push_subs enable row level security;
alter table public.diary_config    enable row level security;
revoke all on public.diary_entries, public.diary_push_subs, public.diary_config from anon, authenticated;

create or replace function public.diary_owner(p_secret text)
returns text language sql immutable set search_path = '' as $$
  select encode(extensions.digest(convert_to(p_secret, 'UTF8'), 'sha256'), 'hex')
$$;

create or replace function public.diary_list(p_secret text)
returns table (entry_date date, body text, updated_at timestamptz, shared_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  if p_secret is null or length(p_secret) < 32 then raise exception 'bad secret'; end if;
  return query
    select e.entry_date, e.body, e.updated_at, e.shared_at
    from public.diary_entries e
    where e.owner_hash = public.diary_owner(p_secret)
    order by e.entry_date desc;
end $$;

create or replace function public.diary_save(p_secret text, p_date date, p_body text, p_author text default null)
returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare t timestamptz;
begin
  if p_secret is null or length(p_secret) < 32 then raise exception 'bad secret'; end if;
  if length(p_body) > 50000 then raise exception 'too long'; end if;
  insert into public.diary_entries (owner_hash, entry_date, body, author, updated_at)
  values (public.diary_owner(p_secret), p_date, coalesce(p_body, ''), left(p_author, 40), now())
  on conflict (owner_hash, entry_date)
  do update set body = excluded.body, author = coalesce(excluded.author, public.diary_entries.author), updated_at = now()
  returning updated_at into t;
  return t;
end $$;

revoke all on function public.diary_owner(text) from public, anon, authenticated;
revoke all on function public.diary_list(text) from public, authenticated;
revoke all on function public.diary_save(text, date, text, text) from public, authenticated;
grant execute on function public.diary_list(text) to anon;
grant execute on function public.diary_save(text, date, text, text) to anon;

-- After this migration, the mailbox token hash was inserted into diary_config
-- (key 'mailbox_token_hash'). The token itself is not stored anywhere in this repo.
