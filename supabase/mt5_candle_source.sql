-- Candle provenance migration for Dars AI Lab.
-- Existing rows are intentionally marked unknown; do NOT backfill them as MT5.
alter table public.mt5_candles
  add column if not exists source text not null default 'unknown';

create index if not exists mt5_candles_source_lookup_idx
  on public.mt5_candles (symbol, timeframe, source, bar_time desc);

comment on column public.mt5_candles.source is
  'Data provenance. Only rows explicitly sent by the authenticated MT5 bridge are marked mt5_bridge.';
