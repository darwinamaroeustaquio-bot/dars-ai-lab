/**
 * DARS Omniscient deterministic market-analysis core.
 * Research/paper mode only. It never places orders and never claims a probability.
 */
const TIMEFRAME_MS = { M1: 60_000, M5: 300_000, M15: 900_000, M30: 1_800_000, H1: 3_600_000, H4: 14_400_000 };
const REQUIRED = ["M5", "M15", "H1"];
const MAX_SPREAD_PRICE = 0.50;
const MAX_SPREAD_TO_M5_ATR = 0.20;

function finite(n) { return Number.isFinite(Number(n)); }
function candleOf(c) {
  const x = { open: Number(c.open ?? c.o), high: Number(c.high ?? c.h), low: Number(c.low ?? c.l), close: Number(c.close ?? c.c), time: c.time ?? c.timestamp ?? c.datetime ?? c.bar_time ?? c.date };
  if (![x.open, x.high, x.low, x.close].every(Number.isFinite) || x.high < x.low || x.high < Math.max(x.open, x.close) || x.low > Math.min(x.open, x.close)) return null;
  const t = typeof x.time === "number" ? (x.time < 1e12 ? x.time * 1000 : x.time) : Date.parse(x.time);
  if (!Number.isFinite(t)) return null;
  x.timeMs = t;
  return x;
}
function ema(values, period) {
  if (values.length < period) return null;
  let v = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const k = 2 / (period + 1);
  for (let i = period; i < values.length; i++) v = values[i] * k + v * (1 - k);
  return v;
}
function rsi(values, period = 14) {
  if (values.length <= period) return null;
  let up = 0, down = 0;
  for (let i = values.length - period; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    if (d > 0) up += d; else down -= d;
  }
  if (down === 0) return 100;
  return 100 - 100 / (1 + up / down);
}
function atr(candles, period = 14) {
  if (candles.length <= period) return null;
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i], p = candles[i - 1];
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
  }
  return trs.slice(-period).reduce((a, b) => a + b, 0) / period;
}
function inspectFrame(raw, tf, now) {
  if (!Array.isArray(raw)) return { ok: false, reason: "Missing " + tf + " candles." };
  const candles = raw.map(candleOf).filter(Boolean).filter(c => c.timeMs + TIMEFRAME_MS[tf] <= now).sort((a, b) => a.timeMs - b.timeMs);
  if (candles.length < 60) return { ok: false, reason: tf + " needs at least 60 valid candles.", count: candles.length };
  const last = candles[candles.length - 1];
  const age = Math.max(0, now - last.timeMs);
  if (age > TIMEFRAME_MS[tf] * 3) return { ok: false, reason: tf + " candle feed is stale.", ageSeconds: Math.round(age / 1000) };
  const closes = candles.map(c => c.close);
  const e20 = ema(closes, 20), e50 = ema(closes, 50), a = atr(candles), strength = rsi(closes);
  if (![e20, e50, a, strength].every(Number.isFinite) || a <= 0) return { ok: false, reason: tf + " indicators are not valid." };
  const trend = last.close > e20 && e20 > e50 ? "BULLISH" : last.close < e20 && e20 < e50 ? "BEARISH" : "MIXED";
  const lookback = candles.slice(-21, -1);
  const priorHigh = Math.max(...lookback.map(c => c.high));
  const priorLow = Math.min(...lookback.map(c => c.low));
  const sweepLow = last.low < priorLow && last.close > priorLow;
  const sweepHigh = last.high > priorHigh && last.close < priorHigh;
  const recentRange = candles.slice(-20).reduce((s, c) => s + c.high - c.low, 0) / 20;
  const regime = recentRange > a * 1.5 ? "HIGH_VOLATILITY" : trend === "MIXED" ? "RANGE_OR_TRANSITION" : "TRENDING";
  return { ok: true, count: candles.length, lastTime: new Date(last.timeMs).toISOString(), close: last.close, ema20: e20, ema50: e50, atr14: a, rsi14: strength, trend, regime, priorHigh, priorLow, sweepLow, sweepHigh, last };
}

function analyzeDarsMarket(input = {}) {
  const now = Number(input.now) || Date.now();
  const symbol = String(input.symbol || "");
  const q = input.quote || {};
  const bid = Number(q.bid), ask = Number(q.ask);
  const received = Date.parse(q.received_at || q.receivedAt || "");
  const spread = ask - bid;
  const diagnostics = [];
  if (symbol !== "XAUUSD-STD") diagnostics.push("Only the configured VT Markets XAUUSD-STD symbol is accepted.");
  if (!(bid > 0 && ask >= bid)) diagnostics.push("Valid live bid/ask quote is missing.");
  if (Number.isFinite(spread) && spread > MAX_SPREAD_PRICE) diagnostics.push("Spread exceeds the configured 0.50 USD/oz safety ceiling.");
  if (!Number.isFinite(received) || now - received > 20_000 || received > now + 5_000) diagnostics.push("Quote is stale or its receive timestamp is invalid.");
  const frames = {};
  for (const tf of REQUIRED) {
    frames[tf] = inspectFrame(input.frames && input.frames[tf], tf, now);
    if (!frames[tf].ok) diagnostics.push(frames[tf].reason);
  }
  const base = { engine: "DARS_OMNISCIENT_CORE_V2", mode: "RESEARCH_AND_PAPER_ONLY", symbol, decision: "WAIT", setup: null, quoteQuality: { spread: Number.isFinite(spread) ? spread : null, maxSpread: MAX_SPREAD_PRICE, receivedAt: Number.isFinite(received) ? new Date(received).toISOString() : null }, diagnostics, frames: Object.fromEntries(Object.entries(frames).map(([k, v]) => [k, v.ok ? { ...v, last: undefined } : v])) };
  if (diagnostics.length) return base;
  const m5 = frames.M5, m15 = frames.M15, h1 = frames.H1;
  if (spread > m5.atr14 * MAX_SPREAD_TO_M5_ATR) {
    base.diagnostics.push("Spread is too large relative to M5 ATR; execution cost is excessive for current volatility.");
    return base;
  }
  if (m15.trend !== h1.trend || m15.trend === "MIXED") {
    base.diagnostics.push("Higher-timeframe direction is not aligned.");
    return base;
  }
  if (m5.regime === "HIGH_VOLATILITY" || m15.regime === "HIGH_VOLATILITY") {
    base.diagnostics.push("Volatility is elevated; wait for conditions to normalize.");
    return base;
  }
  let side = null, stop = null, entry = null;
  if (m15.trend === "BULLISH" && m5.sweepLow && m5.last.close > m5.ema20 && m5.rsi14 >= 45 && m5.rsi14 <= 68) {
    side = "BUY"; entry = ask; stop = Math.min(m5.last.low, m5.priorLow) - m5.atr14 * 0.15;
  } else if (m15.trend === "BEARISH" && m5.sweepHigh && m5.last.close < m5.ema20 && m5.rsi14 >= 32 && m5.rsi14 <= 55) {
    side = "SELL"; entry = bid; stop = Math.max(m5.last.high, m5.priorHigh) + m5.atr14 * 0.15;
  }
  if (!side) {
    base.diagnostics.push("No validated trend-aligned M5 liquidity-reclaim setup.");
    return base;
  }
  const risk = Math.abs(entry - stop);
  if (!(risk > 0) || risk < m5.atr14 * 0.2 || risk > m5.atr14 * 2.5) {
    base.diagnostics.push("Stop distance is outside the permitted ATR sanity range.");
    return base;
  }
  const sign = side === "BUY" ? 1 : -1;
  base.decision = side;
  base.setup = {
    side, entry, stopLoss: stop,
    takeProfit1: entry + sign * risk * 1.5,
    takeProfit2: entry + sign * risk * 2.5,
    riskDistance: risk, spread, spreadToAtr: spread / m5.atr14, rewardRiskTP1: 1.5, rewardRiskTP2: 2.5,
    source: "Live bid/ask + closed MT5 OHLC; deterministic rules",
    note: "Draft paper setup only. Confirm broker stop level, tick size/value, spread, slippage and executable lot size before any manual trade."
  };
  base.diagnostics.push("All configured data-quality and rule checks passed; this is not proof of profitability.");
  return base;
}

module.exports = { analyzeDarsMarket, MAX_SPREAD_PRICE, MAX_SPREAD_TO_M5_ATR };
