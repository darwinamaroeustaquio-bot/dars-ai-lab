# DARS MT5 Execution Bridge — staged implementation

## Current release: foundation only (fail-closed)

This repository change adds a status endpoint and a dormant MT5 Expert Advisor handshake. It does **not** send, modify, or close orders. Live execution is hard-locked OFF in the API response, and the EA contains no order-submission functions. Changing the EA input `InpEnableLiveTrading` cannot activate trading.

Files:
- `api/dars-execution-status.js`: returns `live_enabled: false`, `paper_enabled: false`, `emergency_stop: true`, and `order_submission_enabled: false`.
- `mt5/DARS_Execution_Gateway.mq5`: polls the status endpoint and displays a lock state. It has no `OrderSend`, `CTrade`, modify, or close calls.
- A terminal Global Variable named `DARS_EMERGENCY_STOP` set to `1.0` displays a local emergency stop. The server-side status endpoint also remains locked.


## Adaptive strategy selection — research-stage implementation

`lib/dars-adaptive-selector.js` classifies closed-candle market context into:
- `TREND_FOLLOWING` for a directional trending regime.
- `MEAN_REVERSION` for range/transition conditions.
- `LIQUIDITY_RECLAIM` when a closed M5 candle sweeps and reclaims a prior range.
- `NO_TRADE` during high volatility or unclear conditions.

The selector is integrated into the analysis core. It deliberately does not invent entry rules for trend-following or mean-reversion; those remain research-only until implemented and tested. The existing liquidity-reclaim rules are also blocked from paper eligibility unless verified strategy-journal metrics pass all gates: at least 50 total paper trades, 30 untouched holdout trades, expectancy at least +0.02R, profit factor at least 1.10, maximum drawdown no more than 6R, and no more than 4 consecutive losses.

At present, the analysis endpoint does not yet supply an authoritative persisted strategy journal, so the evidence gate is not satisfied by default and the selector will return WAIT rather than treating example/test metrics as real performance. This is intentional fail-closed behavior. A future journal integration must compute these metrics server-side from broker/MT5-observed paper fills, not accept them from browser input.

This is not a self-learning model and does not establish profitability. It is a deterministic, auditable regime selector with an explicit evidence gate.
\n## Proposed risk policy for review (not active)

Initial conservative proposal for XAUUSD-STD:
- Risk per trade: 0.25% of equity, hard maximum 0.25%.
- Daily realized + floating loss stop: 1.00% of start-of-day equity.
- Maximum open positions: 1.
- Maximum new entries per broker day: 3.
- Mandatory server-side and broker-side Stop Loss on every order.
- Maximum spread: 0.50 USD/oz, subject to observed VT Markets conditions.
- No martingale, grid, averaging down, or loss-recovery sizing.
- No entry when quote age exceeds 3 seconds at the terminal, the DARS feed is stale, candles are incomplete, market is closed, or the bridge is disconnected.
- Dynamic lot sizing must use live `SYMBOL_TRADE_TICK_SIZE`, `SYMBOL_TRADE_TICK_VALUE`, `SYMBOL_VOLUME_MIN`, `SYMBOL_VOLUME_MAX`, `SYMBOL_VOLUME_STEP`, and `SYMBOL_TRADE_STOPS_LEVEL`. Never hardcode tick value or tick size.
- Reconcile actual fills, partial fills, rejected orders, slippage and position state before considering a signal consumed.
- Idempotency key per signal; one signal can create at most one position.
- Emergency stop must block new entries immediately. A separate, explicit policy is required for handling already-open positions; do not silently close them.

These limits are suggestions for the final configuration and require review against the actual account equity, symbol contract, spread and execution behavior. They are not a promise of safety or profitability.

## Required next stages before any live activation

1. **Data contract:** server-side analysis must read the same verified MT5 quote and closed-candle data as the dashboard; browser-supplied signals are not trusted as executable instructions.
2. **Signal journal and order-intent queue:** persist signal ID, symbol, side, entry reference, SL, TP, strategy/version, source timestamps, risk calculation, expiry and state.
3. **Authenticated MT5 polling:** use a dedicated execution credential, never the quote-ingestion token; store it only in MT5 terminal inputs and server environment secrets. Use TLS, rotation and replay protection.
4. **Server-side risk validation:** re-check freshness, spread, symbol metadata, stop distance, account/equity, daily loss, position count, trade count, volume step and idempotency immediately before dispatch.
5. **MT5 execution and reconciliation:** use broker-confirmed order results, actual fill price and position tickets; handle timeouts without duplicate resubmission.
6. **Emergency stop:** dashboard kill switch plus MT5 local terminal kill switch; server must reject all new intents while active.
7. **Demo forward test:** run on a VT Markets demo account, log every signal and execution, test disconnects, stale data, spread spikes, rejected orders, restart/replay and emergency stop.
8. **Final approval gate:** only after code review, successful tests and user review of the exact risk parameters may a later release enable live orders. This foundation must remain locked until that separate approval.

## Installation for status-only testing

1. Compile `mt5/DARS_Execution_Gateway.mq5` in MetaEditor.
2. In MT5, add `https://dars-indol.vercel.app` to Tools → Options → Expert Advisors → Allow WebRequest for listed URL.
3. Attach the EA to an XAUUSD-STD chart. Keep `InpEnableLiveTrading=false`.
4. Confirm the chart comment says `SAFE LOCK — LIVE OFF / ORDER ROUTING DISABLED`.
5. To test the local stop indicator, create terminal Global Variable `DARS_EMERGENCY_STOP` with value `1.0`. Remove it or set it to `0.0` to clear the local indicator.

This is a connection/status test only, not a trading test. No real or demo order is placed by this version.
