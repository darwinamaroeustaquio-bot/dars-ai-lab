-- DARS MT5 Economic Calendar bridge.
-- MT5 broker calendar is stored with explicit provenance; it is NOT independently verified.
create table if not exists public.mt5_news_events (
 symbol text not null,
 value_id text not null,
 event_id text not null,
 name text not null,
 currency text,
 country_code text,
 importance text not null check (importance in ('high','medium','low')),
 event_time timestamptz not null,
 event_time_server timestamp without time zone,
 server_utc_offset_seconds integer,
 actual double precision,
 forecast double precision,
 previous double precision,
 revised_previous double precision,
 source text not null default 'mt5_broker_calendar',
 received_at timestamptz not null default now(),
 primary key(symbol,value_id)
);
create index if not exists mt5_news_events_time_idx on public.mt5_news_events(symbol,event_time);
create index if not exists mt5_news_events_currency_time_idx on public.mt5_news_events(symbol,currency,event_time);
alter table public.mt5_news_events enable row level security;
revoke all on public.mt5_news_events from anon,authenticated;
grant all on public.mt5_news_events to service_role;

create table if not exists public.mt5_news_sync (
 symbol text primary key,
 last_sync_at timestamptz not null,
 event_count integer not null default 0,
 server_time timestamp without time zone,
 server_utc_offset_seconds integer,
 source text not null default 'mt5_broker_calendar'
);
alter table public.mt5_news_sync enable row level security;
revoke all on public.mt5_news_sync from anon,authenticated;
grant all on public.mt5_news_sync to service_role;
