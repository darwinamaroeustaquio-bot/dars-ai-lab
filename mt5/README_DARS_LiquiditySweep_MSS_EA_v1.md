# DARS Liquidity Sweep + MSS EA v1.01

## Safety
- Designed for Strategy Tester and demo accounts first.
- This version defaults `InpAllowLiveTrading=true` because the user requested a live test. This is not a recommendation to trade live; the strategy is unproven.
- Live guardrails: risk is capped at 0.25% per trade, maximum 1 trade/day, and daily equity-loss limit 1.0%. On real accounts, the EA refuses to initialize if inputs exceed those limits.
- The EA skips trades if the calculated risk-sized lot is below the broker minimum instead of rounding up and exceeding the risk cap. With a $17 balance, this may mean no trade is placed; do not raise risk just to force a trade.
- The strategy is experimental and is not a claim of profitability.

## Install
1. In MT5, open **File → Open Data Folder**.
2. Open `MQL5/Experts`.
3. Copy `DARS_LiquiditySweep_MSS_EA_v1.mq5` into that folder (you can download it from this repository's `mt5` folder).
4. Open MetaEditor, open the file, and press **Compile**.
5. In MT5, refresh **Navigator → Expert Advisors**.
6. Open a **XAUUSD-STD M5** chart and attach the EA.
7. Confirm Algo Trading is enabled and inspect the EA Inputs before attaching. Prefer demo forward testing; if using live despite the risk, monitor it and never assume a trade will be safe just because the account is small.

## Strategy outline
- Entry timeframe: M5.
- Bias timeframe: H1, using 50/200 EMA direction and price relative to the fast EMA.
- A bullish candidate forms when a closed M5 candle wicks below the previous 12-bar low and closes back above it bullishly.
- A bearish candidate is the inverse.
- EA waits for a close beyond the local structure level, then waits for a retest/rejection candle.
- SL is beyond the sweep extreme plus a configurable buffer; TP defaults to 1.5R.
- Spread filter, one-position-at-a-time, max trades/day, and daily equity-loss limit are included.

## First test settings
- Symbol: `XAUUSD-STD`
- Period: M5
- Model: Every tick based on real ticks, if available
- Test at least several months and include variable spread, commission, and swap where available.
- Inspect Journal/Experts logs for sweep detection, MSS confirmation, retest, and order failures.
- Compare results across out-of-sample dates. Do not optimize settings on the entire dataset and call that proof.

## Important implementation notes
This is v1. It uses candle-close confirmation and a simplified local structure definition. Broker stop levels, symbol tick/volume properties, and risk sizing are queried from MT5 rather than hard-coded. Confirm the symbol spelling in Market Watch matches `XAUUSD-STD`.
