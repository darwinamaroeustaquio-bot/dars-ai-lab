-- One-time migration for existing DARS paper journals created with the original 15-engine allowlist.
-- Safe to run more than once.
alter table public.dars_paper_trades
  drop constraint if exists dars_paper_trades_strategy_check;

alter table public.dars_paper_trades
  add constraint dars_paper_trades_strategy_check check (strategy in (
    'LIQUIDITY_RECLAIM','TREND_FOLLOWING','MEAN_REVERSION','BREAKOUT',
    'BREAKOUT_RETEST','MOMENTUM','PULLBACK','SUPPORT_RESISTANCE',
    'VOLATILITY_EXPANSION','SESSION_BREAKOUT','RSI_DIVERGENCE',
    'STOCHASTIC_REVERSION','CCI_REVERSION','WILLIAMS_REVERSION','MTF_CONFLUENCE',
    'MACD_CROSSOVER','DONCHIAN_BREAKOUT','ICHIMOKU_CLOUD','SUPERTREND'
  ));
