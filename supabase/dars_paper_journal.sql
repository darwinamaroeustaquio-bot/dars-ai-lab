-- DARS adaptive paper journal. Run in Supabase SQL Editor before enabling the journal API.
create table if not exists public.dars_paper_trades (
 trade_id text primary key, symbol text not null,
 strategy text not null check(strategy in ('LIQUIDITY_RECLAIM','TREND_FOLLOWING','MEAN_REVERSION')),
 side text not null check(side in ('BUY','SELL')),
 mode text not null default 'SHADOW' check(mode in ('SHADOW','ACTIVE_PAPER')),
 status text not null default 'OPEN' check(status in ('OPEN','CLOSED')),
 entry_bar_time timestamptz not null, opened_at timestamptz not null default now(), closed_at timestamptz,
 entry double precision not null, stop_loss double precision not null, tp1 double precision not null, tp2 double precision not null,
 risk_distance double precision not null check(risk_distance>0), tp1_hit boolean not null default false,
 net_r double precision, exit_price double precision, exit_reason text,
 features jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 constraint dars_paper_trade_close_consistency check((status='OPEN' and closed_at is null and net_r is null) or (status='CLOSED' and closed_at is not null and net_r is not null))
);
create index if not exists dars_paper_trades_strategy_history_idx on public.dars_paper_trades(symbol,strategy,status,closed_at);
create index if not exists dars_paper_trades_open_idx on public.dars_paper_trades(symbol,status,entry_bar_time);
alter table public.dars_paper_trades enable row level security;
revoke all on table public.dars_paper_trades from anon,authenticated;
grant all on table public.dars_paper_trades to service_role;
comment on table public.dars_paper_trades is 'Server-authoritative paper trades. Only Vercel server-side service-role APIs may access this table.';
