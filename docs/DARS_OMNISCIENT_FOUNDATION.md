# DARS OMNISCIENT — Foundation

## Product objective
Build an independent, read-only XAUUSD-STD trading-intelligence workspace. DARS analyzes verified VT Markets MT5 data, decides BUY / SELL / WAIT, and presents an auditable Entry / SL / TP1 / TP2 setup for the user to copy manually. No live order execution is in scope.

## Architecture
1. **MT5 data adapter (existing bridge):** terminal sends quote and timestamped OHLC candles. Secrets remain in Vercel environment variables; never commit bridge tokens or Supabase service keys.
2. **Data-quality gate:** validate symbol, quote freshness, candle count, OHLC consistency, timeframe and timestamps. Missing/stale data means WAIT.
3. **Deterministic quant core:** calculate EMA, RSI, ATR, regime, multi-timeframe alignment and liquidity reclaim conditions. This core is explainable and testable; it does not fabricate probabilities.
4. **Risk layer:** compute price distances from live bid/ask and validated structure. Lot sizing is blocked until broker tick size, tick value, contract size, volume step, min/max volume and stop-level metadata are supplied by MT5.
5. **Signal journal:** persist every decision including WAIT, inputs, engine version, timestamp, setup, and eventual paper outcome. Never delete losing signals from performance reporting.
6. **Research/validation:** chronological development, validation and untouched holdout; realistic spread, commission, slippage and swap; walk-forward tests; forward paper trading before any claim of an edge.
7. **Dashboard:** live status, data age, timeframe selector, chart, analysis rationale, setup drawing, risk details and signal journal. Phone-first layout.

## Non-negotiable safeguards
- No live trading or broker order API.
- Never display sample/demo candles as live.
- Never output entry levels when data-quality gates fail.
- WAIT is a valid and preferred decision when evidence is insufficient.
- No win-rate-only ranking; report net expectancy, profit factor, drawdown, sample size and cost sensitivity.
- No strategy is declared profitable from in-sample or repeatedly reused holdout results.
- No lot-size calculation without broker symbol specifications.
- All signals, including losing and rejected signals, remain auditable.

## Current integration facts
- Existing repository: `darwinamaroeustaquio-bot/dars-ai-lab`, default branch `main`.
- Existing dashboard is a static `index.html` application with a sign-in gate, quote bridge UI, analysis/chat UI, candidate lab and paper-trading sections.
- Existing `api/mt5-quote.js` is a read-only quote endpoint backed by Supabase. It accepts XAUUSD-STD / XAUUSD and marks quotes connected only when received within 20 seconds.
- Existing dashboard already requests an `/api/ai-trading-assistant` route and has legacy local analysis. The new engine must be integrated deliberately rather than layering another competing signal generator over it.
- Prior project notes say the candle pipeline and live connection have had intermittent failures. Current live status must be re-verified; repository code alone is not proof that the PC terminal is connected.

## Build sequence
1. Foundation: documented contracts, deterministic analysis module and unit tests.
2. Data adapter: verify the actual candle endpoint/schema and broker timestamps; add explicit stale/missing-data handling.
3. Dashboard integration: one authoritative DARS decision source; remove/confine legacy signal paths to avoid conflicting setups.
4. Journal and paper engine: record every decision and resolve outcomes from subsequent closed candles.
5. Research validation: walk-forward and untouched forward data; only then consider promoting a strategy to the default paper setup.

## First-core rule (provisional)
The initial transparent research rule requires aligned M15/H1 trend, a M5 liquidity sweep and reclaim in trend direction, an EMA20 reclaim, RSI sanity range, acceptable ATR-based stop distance, fresh quote and sufficient valid candles. This is only a baseline hypothesis to test—not a proven profitable strategy or a final adaptive model.
