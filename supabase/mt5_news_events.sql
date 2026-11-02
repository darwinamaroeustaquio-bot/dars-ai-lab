-- Run once in Supabase SQL Editor to enable the MT5 broker economic-calendar bridge.
create table if not exists public.mt5_news_events (
  event_id bigint not null,
  event_time timestamptz not null,
  currency text not null default 'USD',
  event_name text not null,
  importance text not null default 'unknown' check (importance in ('low','moderate','high','unknown')),
  impact_type integer,
  actual_value double precision,
  forecast_value double precision,
  previous_value double precision,
  account text not null,
  source text not null default 'mt5_broker_calendar',
  received_at timestamptz not null default now(),
  constraint mt5_news_events_event_key unique (event_id, event_time, currency)
);
create index if not exists mt5_news_events_time_idx
  on public.mt5_news_events (event_time desc);
create index if not exists mt5_news_events_currency_time_idx
  on public.mt5_news_events (currency, event_time desc);
alter table public.mt5_news_events enable row level security;
-- Only the Vercel API may access this table using the server-side service-role key.
