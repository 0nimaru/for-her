-- Applied to project qjlnulbynqmhhoehbwrw via the Supabase MCP server.
-- Her phones. A phone must be approved by Andi before it can read his notes or send feelings.
create table public.love_devices (
  id          uuid primary key default gen_random_uuid(),
  secret_hash text not null unique,
  label       text,
  ua          text,
  approved    boolean not null default false,
  created_at  timestamptz not null default now(),
  last_seen   timestamptz not null default now()
);

-- Push subscriptions know who they belong to: her phones get love notes, Andi's get her feelings.
alter table public.love_push_subs
  add column role text not null default 'her' check (role in ('her', 'andi')),
  add column device_id uuid references public.love_devices(id) on delete cascade;

-- Feelings she chose to share with Andi (unshared ones never leave her phone).
create table public.love_feelings (
  id            uuid primary key default gen_random_uuid(),
  device_id     uuid references public.love_devices(id) on delete set null,
  author        text,
  mood          text,
  body          text,
  audio_path    text,
  audio_mime    text,
  audio_seconds int,
  created_at    timestamptz not null default now(),
  seen_at       timestamptz
);

alter table public.love_devices  enable row level security;
alter table public.love_feelings enable row level security;
revoke all on public.love_devices, public.love_feelings from anon, authenticated;

-- Private bucket for voice memos (only the Edge Function reads/writes; Andi gets 30-minute links).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('feelings', 'feelings', false, 6291456,
        array['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/mpeg', 'audio/aac', 'audio/x-m4a', 'audio/wav'])
on conflict (id) do nothing;
