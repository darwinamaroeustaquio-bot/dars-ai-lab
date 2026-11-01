// DARS 15-engine historical replay. Reuses the exact live buildCandidates() engine rules.
// Research only: no broker order methods, no paper/live orders are created here.
const { STRATEGIES, buildCandidates } = require("../lib/dars-strategy-engines");
const { ema, atr } = require("../lib/dars-strategy-engines");
const ALLOWED = new Set(["XAUUSD-STD", "XAUUSD"]);
const TF_MS = { M5: 300000, M15: 900000, H1: 3600000 };
function send(res, status, body) {
  res.status(status);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  return res.json(body);
}
function indicators(candles, now, tf) {
  const closed = candles.filter(c => Date.parse(c.bar_time) + TF_MS[tf] <= now);
  if (closed.length < 60) return { ok: false, candles: closed };
  const closes = closed.map(c => c.close), e20 = ema(closes, 20), e50 = ema(closes, 50), a = atr(closed);
  if (![e20, e50, a].every(Number.isFinite) || a <= 0) return { ok: false, candles: closed };
  const last = closed[closed.length - 1], trend = last.close > e20 && e20 > e50 ? "BULLISH" : last.close < e20 && e20 < e50 ? "BEARISH" : "MIXED";
  const recentRange = closed.slice(-20).reduce((sum, c) => sum + c.high - c.low, 0) / 20;
  const regime = recentRange > a * 1.5 ? "HIGH_VOLATILITY" : trend === "MIXED" ? "RANGE_OR_TRANSITION" : "TRENDING";
  return { ok: true, candles: closed, trend, regime, atr14: a, lastTime: last.bar_time };
}
function summarize(trades) {
  let equity = 0, peak = 0, dd = 0, grossWin = 0, grossLoss = 0, streak = 0, maxStreak = 0;
  for (const t of trades) {
    equity += t.r; peak = Math.max(peak, equity); dd = Math.max(dd, peak - equity);
    if (t.r > 0) { grossWin += t.r; streak = 0; }
    else if (t.r < 0) { grossLoss -= t.r; streak++; maxStreak = Math.max(maxStreak, streak); }
  }
  const wins = trades.filter(t => t.r > 0).length;
  return { trades: trades.length, wins, losses: trades.filter(t => t.r < 0).length,
    winRate: trades.length ? wins / trades.length : 0,
    netR: +equity.toFixed(2), expectancyR: trades.length ? +(equity / trades.length).toFixed(3) : 0,
    profitFactor: grossLoss ? +(grossWin / grossLoss).toFixed(2) : grossWin ? 99 : 0,
    maxDrawdownR: +dd.toFixed(2), maxLosingStreak: maxStreak };
}
function replay(candles, m15Rows, h1Rows, start, end, costs) {
  const tradesBy = Object.fromEntries(STRATEGIES.map(s => [s, []]));
  const m15Cursor = [], h1Cursor = [];
  let p15 = 0, p1 = 0;
  for (let i = 60; i < end - 2; i++) {
    const signalBar = candles[i], signalCloseMs = Date.parse(signalBar.bar_time) + TF_MS.M5;
    while (p15 < m15Rows.length && Date.parse(m15Rows[p15].bar_time) + TF_MS.M15 <= signalCloseMs) p15++;
    while (p1 < h1Rows.length && Date.parse(h1Rows[p1].bar_time) + TF_MS.H1 <= signalCloseMs) p1++;
    if (i < start) continue;
    const f5 = indicators(candles.slice(0, i + 1), signalCloseMs, "M5");
    const f15 = indicators(m15Rows.slice(0, p15), signalCloseMs, "M15");
    const fh1 = indicators(h1Rows.slice(0, p1), signalCloseMs, "H1");
    if (!f5.ok || !f15.ok || !fh1.ok || f5.regime === "HIGH_VOLATILITY" || f15.regime === "HIGH_VOLATILITY") continue;
    const candidates = buildCandidates({ frames: { M5: f5, M15: f15, H1: fh1 }, quote: { bid: signalBar.close, ask: signalBar.close } });
    if (!candidates.length) continue;
    const next = candles[i + 1], entryMid = next.open;
    for (const candidate of candidates) {
      const list = tradesBy[candidate.strategy];
      if (list.length && list[list.length - 1]._exitIndex >= i + 1) continue;
      const dir = candidate.side === "BUY" ? 1 : -1;
      const entry = entryMid + dir * costs.spreadPrice / 2;
      const stop = candidate.stopLoss;
      const risk = Math.abs(entry - stop);
      if (!(risk > 0) || risk < f5.atr14 * .2 || risk > f5.atr14 * 3) continue;
      const target = entry + dir * risk * 1.5;
      let exit = entry, reason = "TIME", exitIndex = Math.min(end - 1, i + 12);
      for (let j = i + 1; j <= Math.min(end - 1, i + 12); j++) {
        const b = candles[j], sl = dir === 1 ? b.low <= stop : b.high >= stop, tp = dir === 1 ? b.high >= target : b.low <= target;
        if (sl && tp) { exit = stop; reason = "SL (same-bar ambiguity; conservative)"; exitIndex = j; break; }
        if (sl) { exit = stop; reason = "SL"; exitIndex = j; break; }
        if (tp) { exit = target; reason = "TP1"; exitIndex = j; break; }
        exit = b.close; exitIndex = j;
      }
      const grossR = dir * (exit - entry) / risk;
      const costR = (costs.spreadPrice + costs.slippagePrice + costs.commissionPrice) / risk;
      list.push({ r: grossR - costR, grossR, costR, entry, exit, reason, time: next.bar_time, _exitIndex: exitIndex });
    }
  }
  return Object.fromEntries(STRATEGIES.map(s => [s, tradesBy[s].map(t => ({ ...t }))]));
}
module.exports = async (req, res) => {
  if (req.method !== "GET") return send(res, 405, { ok: false, error: "GET only" });
  const symbol = String(req.query.symbol || "XAUUSD-STD");
  if (!ALLOWED.has(symbol)) return send(res, 400, { ok: false, error: "Only XAUUSD-STD is supported." });
  const root = String(process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "").replace(/\/rest\/v1$/i, "");
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!root || !key) return send(res, 503, { ok: false, error: "Supabase candle storage is not configured." });
  const spreadPrice = Math.max(0, Math.min(10, Number(req.query.spreadPrice ?? .28)));
  const slippagePrice = Math.max(0, Math.min(10, Number(req.query.slippagePrice ?? .05)));
  const commissionPrice = Math.max(0, Math.min(10, Number(req.query.commissionPrice ?? 0)));
  const maxCandles = Math.max(500, Math.min(5000, Number(req.query.limit) || 3000));
  async function load(tf) {
    const rows = []; const pageSize = 1000;
    for (let offset = 0; offset < maxCandles; offset += pageSize) {
      const q = new URLSearchParams({ select: "bar_time,open,high,low,close,source", symbol: "eq." + symbol, timeframe: "eq." + tf,
        source: "eq.mt5_bridge", order: "bar_time.desc", limit: String(Math.min(pageSize, maxCandles - offset)), offset: String(offset) });
      const r = await fetch(root + "/rest/v1/mt5_candles?" + q, { headers: { apikey: key, Authorization: "Bearer " + key } });
      if (!r.ok) throw new Error("Supabase candle query failed for " + tf + " (" + r.status + ").");
      const page = await r.json(); rows.push(...page); if (page.length < pageSize) break;
    }
    return rows.reverse().map(x => ({ ...x, open: +x.open, high: +x.high, low: +x.low, close: +x.close }))
      .filter(x => [x.open,x.high,x.low,x.close].every(Number.isFinite) && x.high >= Math.max(x.open,x.close,x.low) && x.low <= Math.min(x.open,x.close,x.high));
  }
  try {
    const [m5, m15, h1] = await Promise.all([load("M5"), load("M15"), load("H1")]);
    if (m5.length < 250 || m15.length < 60 || h1.length < 60)
      return send(res, 200, { ok: true, ready: false, counts: { M5: m5.length, M15: m15.length, H1: h1.length }, message: "Need at least 250 M5 and 60 each M15/H1 verified MT5 candles." });
    const split = Math.floor(m5.length * .7), costs = { spreadPrice, slippagePrice, commissionPrice };
    const devTrades = replay(m5, m15, h1, 60, split, costs);
    const holdTrades = replay(m5, m15, h1, split, m5.length, costs);
    const stress05 = replay(m5, m15, h1, split, m5.length, { ...costs, slippagePrice: slippagePrice + .05 });
    const stress10 = replay(m5, m15, h1, split, m5.length, { ...costs, slippagePrice: slippagePrice + .10 });
    const results = STRATEGIES.map(strategy => {
      const dev = summarize(devTrades[strategy]), holdout = summarize(holdTrades[strategy]);
      const s05 = summarize(stress05[strategy]), s10 = summarize(stress10[strategy]);
      const eligible = holdout.trades >= 100 && dev.trades >= 100 && dev.expectancyR > 0 && holdout.expectancyR > 0 &&
        holdout.profitFactor > 1.1 && holdout.maxDrawdownR <= 12 && s05.expectancyR > 0 && s10.expectancyR > 0;
      return { strategy, development: dev, holdout, stressPlus005: s05, stressPlus010: s10, qualifiedForPaperReview: eligible,
        status: eligible ? "FORWARD_PAPER_REVIEW_ONLY" : "NOT_QUALIFIED",
        trades: holdTrades[strategy].slice(-20).map(({_exitIndex,...t}) => ({...t, r:+t.r.toFixed(2)})) };
    }).sort((a,b) => Number(b.qualifiedForPaperReview)-Number(a.qualifiedForPaperReview) ||
      b.holdout.expectancyR-a.holdout.expectancyR || b.holdout.profitFactor-a.holdout.profitFactor);
    return send(res, 200, { ok: true, ready: true, symbol, timeframe: "M5", engineCount: STRATEGIES.length,
      engineNames: STRATEGIES, counts: { M5: m5.length, M15: m15.length, H1: h1.length },
      split: { developmentCandles: split, holdoutCandles: m5.length - split, method: "chronological 70/30" },
      costModel: { ...costs, historicalSpreadAvailable: false, note: "Spread is an assumed benchmark; MT5 OHLC history has no historical bid/ask." },
      execution: "Signal on a fully closed M5 candle; entry at next M5 open; only M15/H1 bars fully closed by signal time are visible; same-bar SL/TP resolves to SL; TP1=1.5R; max hold 12 bars.",
      qualification: "At least 100 development and 100 holdout trades, positive expectancy in both, holdout PF > 1.10, drawdown <= 12R and positive expectancy under +0.05/+0.10 USD/oz slippage stress. Qualified results are paper-review only.",
      results });
  } catch (e) { return send(res, 502, { ok: false, error: e.message || "Historical replay failed safely." }); }
};
