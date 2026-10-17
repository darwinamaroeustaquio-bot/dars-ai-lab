-- DARS AI LAB: user-owned journal and settings
-- Run in Supabase SQL Editor after the initial table setup.

alter table public.trading_signals
  add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.trade_journal
  add column if not exists user_id uuid references auth.users(id) on delete cascade,
  add column if not exists local_id text;
alter table public.trading_settings
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

drop index if exists public.trade_journal_user_local_id_unique;
create unique index trade_journal_user_local_id_unique
  on public.trade_journal(user_id, local_id);

drop policy if exists "Users manage their own signals" on public.trading_signals;
create policy "Users manage their own signals"
on public.trading_signals for all to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

drop policy if exists "Users manage their own journal" on public.trade_journal;
create policy "Users manage their own journal"
on public.trade_journal for all to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

drop policy if exists "Users manage their own settings" on public.trading_settings;
create policy "Users manage their own settings"
on public.trading_settings for all to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));
