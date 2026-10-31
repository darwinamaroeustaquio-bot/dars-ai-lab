/**
 * DARS Quant Strategy Library.
 * Fifteen deterministic, closed-candle-only research engines.
 * These engines create paper/shadow candidates only; no broker order methods.
 */
const STRATEGIES = [
  "LIQUIDITY_RECLAIM", "TREND_FOLLOWING", "MEAN_REVERSION",
  "BREAKOUT", "BREAKOUT_RETEST", "MOMENTUM", "PULLBACK",
  "SUPPORT_RESISTANCE", "VOLATILITY_EXPANSION", "SESSION_BREAKOUT",
  "RSI_DIVERGENCE", "STOCHASTIC_REVERSION", "CCI_REVERSION",
  "WILLIAMS_REVERSION", "MTF_CONFLUENCE"
];
function ema(values, period) {
  if (values.length < period) return null;
  let value = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const k = 2 / (period + 1);
  for (let i = period; i < values.length; i++) value = values[i] * k + value * (1 - k);
  return value;
}
function rsi(values, period = 14) {
  if (values.length <= period) return null;
  let up = 0, down = 0;
  for (let i = values.length - period; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    if (d > 0) up += d; else down -= d;
  }
  return down === 0 ? 100 : 100 - 100 / (1 + up / down);
}
function rsiAt(values, end, period = 14) {
  if (end < period) return null;
  return rsi(values.slice(0, end + 1), period);
}
function atr(candles, period = 14) {
  if (candles.length <= period) return null;
  const tr = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i], p = candles[i - 1];
    tr.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
  }
  return tr.slice(-period).reduce((a, b) => a + b, 0) / period;
}
function mean(values) { return values.reduce((a, b) => a + b, 0) / values.length; }
function std(values, m = mean(values)) { return Math.sqrt(mean(values.map(v => (v - m) ** 2))); }
function cci(candles, period = 20) {
  if (candles.length < period) return null;
  const tp = candles.slice(-period).map(c => (c.high + c.low + c.close) / 3);
  const m = mean(tp), dev = mean(tp.map(v => Math.abs(v - m)));
  return dev ? (tp[tp.length - 1] - m) / (0.015 * dev) : 0;
}
function stochastic(candles, period = 14) {
  if (candles.length < period + 1) return null;
  const w = candles.slice(-period), hi = Math.max(...w.map(c => c.high)), lo = Math.min(...w.map(c => c.low));
  return hi === lo ? 50 : 100 * (w[w.length - 1].close - lo) / (hi - lo);
}
function williams(candles, period = 14) {
  if (candles.length < period + 1) return null;
  const w = candles.slice(-period), hi = Math.max(...w.map(c => c.high)), lo = Math.min(...w.map(c => c.low));
  return hi === lo ? -50 : -100 * (hi - w[w.length - 1].close) / (hi - lo);
}
function makeSetup(strategy, side, entry, stop, atrValue, features, note, spread = 0) {
  const risk = Math.abs(entry - stop);
  if (!(risk > 0) || !Number.isFinite(risk) || risk < atrValue * 0.2 || risk > atrValue * 3) return null;
  const sign = side === "BUY" ? 1 : -1;
  return {
    strategy, side, entry, stopLoss: stop,
    takeProfit1: entry + sign * risk * 1.5,
    takeProfit2: entry + sign * risk * 2.5,
    riskDistance: risk, rewardRiskTP1: 1.5, rewardRiskTP2: 2.5,
    features: { rsi: 50, emaGap: 0, atr: atrValue, sweep: 0, trendAlignment: 0, ...features, spread },
    note
  };
}
function buildCandidates({ frames, quote } = {}) {
  const m5 = frames?.M5, m15 = frames?.M15, h1 = frames?.H1;
  if (!m5?.ok || !m15?.ok || !h1?.ok || !quote) return [];
  const candles = m5.candles || [];
  if (candles.length < 60) return [];
  const last = candles[candles.length - 1], prev = candles[candles.length - 2];
  const closes = candles.map(c => c.close), e20 = ema(closes, 20), e50 = ema(closes, 50);
  const a = atr(candles), strength = rsi(closes), spread = Number(quote.ask) - Number(quote.bid);
  if (![e20, e50, a, strength, spread].every(Number.isFinite) || a <= 0 || spread < 0) return [];
  const aligned = m15.trend === h1.trend && m15.trend !== "MIXED";
  const bullish = m15.trend === "BULLISH" && h1.trend === "BULLISH";
  const bearish = m15.trend === "BEARISH" && h1.trend === "BEARISH";
  const prior = candles.slice(-21, -1);
  const priorHigh = Math.max(...prior.map(c => c.high)), priorLow = Math.min(...prior.map(c => c.low));
  const sweepLow = last.low < priorLow && last.close > priorLow;
  const sweepHigh = last.high > priorHigh && last.close < priorHigh;
  const swingLow = Math.min(...candles.slice(-6).map(c => c.low));
  const swingHigh = Math.max(...candles.slice(-6).map(c => c.high));
  const baseFeatures = { rsi: strength, emaGap: (last.close - e20) / a, atr: a, sweep: 0, trendAlignment: aligned ? 1 : 0 };
  const out = [];
  const add = (strategy, side, stop, features, note) => {
    const entry = side === "BUY" ? Number(quote.ask) : Number(quote.bid);
    const candidate = makeSetup(strategy, side, entry, stop, a, { ...baseFeatures, ...features }, note, spread);
    if (candidate && !out.some(x => x.strategy === strategy && x.side === side)) out.push(candidate);
  };

  // 1. Liquidity sweep and reclaim.
  if (bullish && sweepLow && last.close > e20 && strength >= 42 && strength <= 70)
    add("LIQUIDITY_RECLAIM", "BUY", Math.min(last.low, priorLow) - a * 0.15, { sweep: 1 }, "Closed-candle sell-side sweep and reclaim aligned with bullish M15/H1.");
  if (bearish && sweepHigh && last.close < e20 && strength >= 30 && strength <= 58)
    add("LIQUIDITY_RECLAIM", "SELL", Math.max(last.high, priorHigh) + a * 0.15, { sweep: 1 }, "Closed-candle buy-side sweep and reclaim aligned with bearish M15/H1.");

  // 2. Trend following: EMA20 cross-back after a pullback.
  if (bullish && e20 > e50 && prev.close <= e20 && last.close > e20 && strength >= 48 && strength <= 72)
    add("TREND_FOLLOWING", "BUY", swingLow - a * 0.12, {}, "EMA20 pullback reclaim in aligned bullish trend.");
  if (bearish && e20 < e50 && prev.close >= e20 && last.close < e20 && strength >= 28 && strength <= 52)
    add("TREND_FOLLOWING", "SELL", swingHigh + a * 0.12, {}, "EMA20 pullback rejection in aligned bearish trend.");

  // 3. Mean reversion: close back inside a two-standard-deviation band in range regime.
  if (m5.regime === "RANGE_OR_TRANSITION") {
    const w = closes.slice(-20), m = mean(w), s = std(w, m);
    const p = closes.slice(-21, -1), pm = mean(p), ps = std(p, pm);
    if (prev.close < pm - 2 * ps && last.close >= m - 2 * s && strength <= 42)
      add("MEAN_REVERSION", "BUY", swingLow - a * 0.15, { emaGap: (last.close - m) / a }, "Re-entry inside lower two-sigma band in a range regime.");
    if (prev.close > pm + 2 * ps && last.close <= m + 2 * s && strength >= 58)
      add("MEAN_REVERSION", "SELL", swingHigh + a * 0.15, { emaGap: (last.close - m) / a }, "Re-entry inside upper two-sigma band in a range regime.");
  }

  // 4. Range breakout.
  if (last.close > priorHigh && prev.close <= priorHigh && last.close - last.open > a * 0.35)
    add("BREAKOUT", "BUY", Math.min(last.low, priorHigh) - a * 0.25, {}, "Closed M5 close above the prior 20-bar range.");
  if (last.close < priorLow && prev.close >= priorLow && last.open - last.close > a * 0.35)
    add("BREAKOUT", "SELL", Math.max(last.high, priorLow) + a * 0.25, {}, "Closed M5 close below the prior 20-bar range.");

  // 5. Breakout retest.
  const retestWindow = candles.slice(-22, -2);
  const retestHigh = Math.max(...retestWindow.map(c => c.high)), retestLow = Math.min(...retestWindow.map(c => c.low));
  const prevBeyondHigh = prev.close > retestHigh, prevBeyondLow = prev.close < retestLow;
  if (prevBeyondHigh && last.low <= retestHigh + a * 0.15 && last.close > retestHigh)
    add("BREAKOUT_RETEST", "BUY", Math.min(last.low, retestHigh) - a * 0.2, {}, "Price retested and held a prior breakout high.");
  if (prevBeyondLow && last.high >= retestLow - a * 0.15 && last.close < retestLow)
    add("BREAKOUT_RETEST", "SELL", Math.max(last.high, retestLow) + a * 0.2, {}, "Price retested and rejected a prior breakdown low.");

  // 6. Momentum impulse.
  const body = last.close - last.open;
  if (body > a * 0.8 && last.high - last.close < a * 0.2 && strength >= 60 && strength <= 82)
    add("MOMENTUM", "BUY", last.low - a * 0.2, {}, "Strong bullish M5 impulse with RSI momentum confirmation.");
  if (body < -a * 0.8 && last.close - last.low < a * 0.2 && strength >= 18 && strength <= 40)
    add("MOMENTUM", "SELL", last.high + a * 0.2, {}, "Strong bearish M5 impulse with RSI momentum confirmation.");

  // 7. EMA pullback distinct from cross-back: intrabar touch and directional close.
  if (bullish && last.low <= e20 + a * 0.08 && last.close > e20 && last.close > last.open)
    add("PULLBACK", "BUY", swingLow - a * 0.15, {}, "Bullish trend pullback touched EMA20 and closed back above it.");
  if (bearish && last.high >= e20 - a * 0.08 && last.close < e20 && last.close < last.open)
    add("PULLBACK", "SELL", swingHigh + a * 0.15, {}, "Bearish trend pullback touched EMA20 and closed back below it.");

  // 8. Support/resistance wick rejection.
  const sr = candles.slice(-41, -1), support = Math.min(...sr.map(c => c.low)), resistance = Math.max(...sr.map(c => c.high));
  const lowerWick = Math.min(last.open, last.close) - last.low, upperWick = last.high - Math.max(last.open, last.close);
  if (last.low <= support + a * 0.12 && last.close > support && lowerWick > Math.abs(body) * 1.2)
    add("SUPPORT_RESISTANCE", "BUY", last.low - a * 0.15, {}, "Lower-wick rejection at the prior 40-bar support zone.");
  if (last.high >= resistance - a * 0.12 && last.close < resistance && upperWick > Math.abs(body) * 1.2)
    add("SUPPORT_RESISTANCE", "SELL", last.high + a * 0.15, {}, "Upper-wick rejection at the prior 40-bar resistance zone.");

  // 9. Volatility expansion after compression.
  const recentRanges = candles.slice(-6, -1).map(c => c.high - c.low);
  const olderRanges = candles.slice(-20, -6).map(c => c.high - c.low);
  if (mean(olderRanges) < a * 0.75 && last.high - last.low > a * 1.5 && body > a * 0.5)
    add("VOLATILITY_EXPANSION", "BUY", last.low - a * 0.2, {}, "Bullish range expansion after a compressed volatility phase.");
  if (mean(olderRanges) < a * 0.75 && last.high - last.low > a * 1.5 && body < -a * 0.5)
    add("VOLATILITY_EXPANSION", "SELL", last.high + a * 0.2, {}, "Bearish range expansion after a compressed volatility phase.");

  // 10. UTC liquid-session range break; only use timestamps from verified MT5 bars.
  const hour = new Date(last.timeMs).getUTCHours();
  const sessionRange = candles.slice(-13, -1);
  const sessionHigh = Math.max(...sessionRange.map(c => c.high)), sessionLow = Math.min(...sessionRange.map(c => c.low));
  if (hour >= 7 && hour <= 16 && last.close > sessionHigh && prev.close <= sessionHigh)
    add("SESSION_BREAKOUT", "BUY", Math.min(last.low, sessionHigh) - a * 0.2, {}, "UTC liquid-session break above the prior 12-bar range.");
  if (hour >= 7 && hour <= 16 && last.close < sessionLow && prev.close >= sessionLow)
    add("SESSION_BREAKOUT", "SELL", Math.max(last.high, sessionLow) + a * 0.2, {}, "UTC liquid-session break below the prior 12-bar range.");

  // 11. RSI divergence using two confirmed local swing points.
  const pivotsLow = [], pivotsHigh = [];
  for (let i = Math.max(15, candles.length - 35); i < candles.length - 2; i++) {
    const p = candles[i];
    if (p.low < candles[i - 1].low && p.low <= candles[i + 1].low) pivotsLow.push(i);
    if (p.high > candles[i - 1].high && p.high >= candles[i + 1].high) pivotsHigh.push(i);
  }
  const lo1 = pivotsLow[pivotsLow.length - 2], lo2 = pivotsLow[pivotsLow.length - 1];
  const hi1 = pivotsHigh[pivotsHigh.length - 2], hi2 = pivotsHigh[pivotsHigh.length - 1];
  if (Number.isInteger(lo1) && Number.isInteger(lo2) && candles[lo2].low < candles[lo1].low &&
      rsiAt(closes, lo2) > rsiAt(closes, lo1) && last.close > last.open)
    add("RSI_DIVERGENCE", "BUY", Math.min(candles[lo2].low, last.low) - a * 0.15, { rsi: strength }, "Bullish price/RSI swing divergence confirmed by a bullish close.");
  if (Number.isInteger(hi1) && Number.isInteger(hi2) && candles[hi2].high > candles[hi1].high &&
      rsiAt(closes, hi2) < rsiAt(closes, hi1) && last.close < last.open)
    add("RSI_DIVERGENCE", "SELL", Math.max(candles[hi2].high, last.high) + a * 0.15, { rsi: strength }, "Bearish price/RSI swing divergence confirmed by a bearish close.");

  // 12-14. Oscillator reversions restricted to range/transition conditions.
  if (m5.regime === "RANGE_OR_TRANSITION") {
    const stoch = stochastic(candles), prevStoch = stochastic(candles.slice(0, -1));
    if (prevStoch !== null && stoch !== null && prevStoch < 20 && stoch >= 20 && last.close > last.open)
      add("STOCHASTIC_REVERSION", "BUY", swingLow - a * 0.15, { rsi: stoch }, "Stochastic crossed up through 20 in a range regime.");
    if (prevStoch !== null && stoch !== null && prevStoch > 80 && stoch <= 80 && last.close < last.open)
      add("STOCHASTIC_REVERSION", "SELL", swingHigh + a * 0.15, { rsi: stoch }, "Stochastic crossed down through 80 in a range regime.");
    const cciNow = cci(candles), cciPrev = cci(candles.slice(0, -1));
    if (cciPrev !== null && cciNow !== null && cciPrev < -100 && cciNow >= -100)
      add("CCI_REVERSION", "BUY", swingLow - a * 0.15, { rsi: strength }, "CCI recovered above -100 from an oversold range extreme.");
    if (cciPrev !== null && cciNow !== null && cciPrev > 100 && cciNow <= 100)
      add("CCI_REVERSION", "SELL", swingHigh + a * 0.15, { rsi: strength }, "CCI fell below +100 from an overbought range extreme.");
    const wr = williams(candles), prevWr = williams(candles.slice(0, -1));
    if (prevWr !== null && wr !== null && prevWr < -80 && wr >= -80)
      add("WILLIAMS_REVERSION", "BUY", swingLow - a * 0.15, { rsi: strength }, "Williams %R recovered above -80 in a range regime.");
    if (prevWr !== null && wr !== null && prevWr > -20 && wr <= -20)
      add("WILLIAMS_REVERSION", "SELL", swingHigh + a * 0.15, { rsi: strength }, "Williams %R fell below -20 in a range regime.");
  }

  // 15. Multi-timeframe confluence with a fresh M5 trigger.
  if (aligned && bullish && e20 > e50 && last.low <= e20 + a * 0.1 && last.close > e20 && last.close > last.open && strength >= 50)
    add("MTF_CONFLUENCE", "BUY", swingLow - a * 0.15, { trendAlignment: 1 }, "H1/M15 bullish alignment plus M5 EMA20 reclaim and RSI confirmation.");
  if (aligned && bearish && e20 < e50 && last.high >= e20 - a * 0.1 && last.close < e20 && last.close < last.open && strength <= 50)
    add("MTF_CONFLUENCE", "SELL", swingHigh + a * 0.15, { trendAlignment: 1 }, "H1/M15 bearish alignment plus M5 EMA20 rejection and RSI confirmation.");

  return out;
}
module.exports = { STRATEGIES, buildCandidates, ema, rsi, atr };
