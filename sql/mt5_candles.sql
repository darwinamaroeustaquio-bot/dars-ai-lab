-- MT5 candle history table: all supported dashboard timeframes.
create table if not exists public.mt5_candles (
  symbol text not null,
  timeframe text not null check (timeframe in ('M1','M5','M15','M30','H1','H4')),
  bar_time timestamptz not null,
  open double precision not null,
  high double precision not null,
  low double precision not null,
  close double precision not null,
  tick_volume bigint not null default 0,
  received_at timestamptz not null default now(),
  source text not null default 'unknown',
  constraint mt5_candles_symbol_timeframe_bar_key unique (symbol, timeframe, bar_time),
  constraint mt5_candles_ohlc_valid check (high >= greatest(open, close, low) and low <= least(open, close, high) and low > 0)
);
alter table public.mt5_candles drop constraint if exists mt5_candles_timeframe_check;
alter table public.mt5_candles add constraint mt5_candles_timeframe_check
  check (timeframe in ('M1','M5','M15','M30','H1','H4'));
create index if not exists mt5_candles_lookup_idx on public.mt5_candles (symbol, timeframe, bar_time desc);
create index if not exists mt5_candles_source_lookup_idx on public.mt5_candles (symbol, timeframe, source, bar_time desc);
alter table public.mt5_candles enable row level security;
comment on column public.mt5_candles.source is
  'Data provenance. Only authenticated MT5 bridge uploads are marked mt5_bridge.';
