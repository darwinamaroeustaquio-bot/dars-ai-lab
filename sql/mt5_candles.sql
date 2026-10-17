-- Run once in Supabase SQL Editor to enable the read-only MT5 candle bridge.
create table if not exists public.mt5_candles (
  symbol text not null,
  timeframe text not null check (timeframe in ('M5','M15','H1')),
  bar_time timestamptz not null,
  open double precision not null,
  high double precision not null,
  low double precision not null,
  close double precision not null,
  tick_volume bigint not null default 0,
  received_at timestamptz not null default now(),
  constraint mt5_candles_symbol_timeframe_bar_key unique (symbol, timeframe, bar_time),
  constraint mt5_candles_ohlc_valid check (high >= greatest(open, close, low) and low <= least(open, close, high) and low > 0)
);
create index if not exists mt5_candles_lookup_idx
  on public.mt5_candles (symbol, timeframe, bar_time desc);
alter table public.mt5_candles enable row level security;
-- Browser clients should not read this table directly. The Vercel API uses the service-role key server-side.
