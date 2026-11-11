-- Applied to project qjlnulbynqmhhoehbwrw via the Supabase MCP server.
-- Phones (her home-screen app) that receive love notes.
create table public.love_push_subs (
  endpoint     text primary key,
  subscription jsonb       not null,
  label        text,
  created_at   timestamptz not null default now()
);

-- Server-only settings: VAPID keys and the salted hash of Andi's sender passcode.
create table public.love_config (
  key   text primary key,
  value text not null
);

-- Log of sent notes.
create table public.love_notes (
  id       bigint generated always as identity primary key,
  body     text        not null,
  sent_at  timestamptz not null default now(),
  devices  int         not null default 0
);

alter table public.love_push_subs enable row level security;
alter table public.love_config    enable row level security;
alter table public.love_notes     enable row level security;
revoke all on public.love_push_subs, public.love_config, public.love_notes from anon, authenticated;
