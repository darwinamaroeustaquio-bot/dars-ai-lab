-- Run in Supabase SQL Editor.
create table if not exists public.mt5_quotes (
  symbol text primary key,
  bid double precision not null,
  ask double precision not null,
  last double precision not null default 0,
  digits integer,
  spread double precision,
  received_at timestamptz not null default now()
);

alter table public.mt5_quotes enable row level security;

-- Browser users must not read or write this table directly.
-- The Vercel API accesses it server-side using SUPABASE_SERVICE_ROLE_KEY.
revoke all on table public.mt5_quotes from anon, authenticated;
