// DARS 19-engine historical replay. Reuses the exact live buildCandidates() engine rules.
// Research only: no broker order methods, no paper/live orders are created here.
const { STRATEGIES, buildCandidates } = require("./dars-strategy-engines");
const { ema, atr } = require("./dars-strategy-engines");
const { chronologicalWalkForward, auditDuplicateCandidates } = require("./dars-research-validation");
const { filterClosedCandles, readFreshMt5Spread } = require("./dars-market-data");
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
// Transaction costs do not change signal or exit decisions. Reprice the same holdout
// executions for slippage stress instead of replaying every candle twice more.
function summarizeWithExtraSlippage(trades, costs, extraSlippage) {
  const totalCost = costs.spreadPrice + costs.slippagePrice + costs.commissionPrice + extraSlippage;
  return summarize(trades.map(t => ({ ...t, r: t.grossR - totalCost / t.risk })));
}
function localHour(iso, timeZone) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));
  return Number(parts.find(x => x.type === "hour")?.value ?? 0);
}
function classifySession(iso) {
  // IANA zones automatically handle UK/US daylight-saving transitions.
  const london = localHour(iso, "Europe/London");
  const newYork = localHour(iso, "America/New_York");
  const inLondon = london >= 8 && london < 17;
  const inNewYork = newYork >= 8 && newYork < 17;
  return inLondon && inNewYork ? "LONDON_NEW_YORK_OVERLAP" :
    inLondon ? "LONDON" : inNewYork ? "NEW_YORK" : "ASIA_OTHER";
}
function newsBreakdown(trades, events) {
  const windows = [15, 30, 60];
  const out = {};
  for (const minutes of windows) {
    const inside = [], outside = [];
    for (const trade of trades) {
      const t = Date.parse(trade.time);
      const near = events.some(event => Math.abs(t - event.timeMs) <= minutes * 60000);
      (near ? inside : outside).push(trade);
    }
    out["within" + minutes + "Minutes"] = summarize(inside);
    out["outside" + minutes + "Minutes"] = summarize(outside);
  }
  return out;
}
function eventTimestamp(event) {
  const value = event.event_time || event.time || event.timestamp;
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
}
async function loadHistoricalNews(fromMs, toMs) {
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) {
    throw new Error("Invalid historical candle date range for MT5 calendar.");
  }

  const root = String(process.env.SUPABASE_URL || "").trim().replace(/\\/+$/, "").replace(/\\/rest\\/v1$/i, "");
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!root || !key) throw new Error("MT5 calendar storage is not configured.");
  const from = new Date(fromMs).toISOString();
  const to = new Date(toMs).toISOString();
  const q = new URLSearchParams({
    select: "event_id,event_time,event_name,currency,importance,impact_type",
    currency: "eq.USD",
    and: "(event_time.gte." + from + ",event_time.lte." + to + ")",
    order: "event_time.asc",
    limit: "10000"
  });
  const response = await fetch(root + "/rest/v1/mt5_news_events?" + q.toString(), {
    headers: { apikey: key, Authorization: "Bearer " + key, Accept: "application/json" }
  });
  if (!response.ok) {
    let detail = "";
    try { detail = (await response.text()).slice(0, 250); } catch {}
    throw new Error("MT5 broker calendar storage HTTP " + response.status + (detail ? ": " + detail : ""));
  }
  const rows = await response.json();
  const events = [];
  for (const event of rows) {
    const timeMs = eventTimestamp(event);
    if (timeMs === null || timeMs < fromMs || timeMs > toMs) continue;
    events.push({
      id: String(event.event_id),
      name: event.event_name || "Economic event",
      currency: event.currency || "USD",
      impact: String(event.importance || "unknown").toLowerCase(),
      timeMs
    });
  }
  if (!events.length) throw new Error("No MT5 broker calendar events are stored for this historical candle range. Run the MT5 History Bridge and verify broker calendar support.");
  return {
    events,
    source: "MT5 broker calendar",
    from: new Date(fromMs).toISOString().slice(0, 10),
    to: new Date(toMs).toISOString().slice(0, 10)
  };
}
function sessionBreakdown(trades) {
  const groups = { LONDON: [], NEW_YORK: [], LONDON_NEW_YORK_OVERLAP: [], ASIA_OTHER: [] };
  for (const trade of trades) groups[trade.session || "ASIA_OTHER"].push(trade);
  return Object.fromEntries(Object.entries(groups).map(([session, rows]) => [session, summarize(rows)]));
}
function replay(candles, m15Rows, h1Rows, start, end, costs, variant = {}, entryProfile = {}, candidateCache = new Map()) {
  const tradesBy = Object.fromEntries(STRATEGIES.map(s => [s, []]));
  const diagnostics = Object.fromEntries(STRATEGIES.map(s => [s, {
    barsEvaluated: 0, candidateSignals: 0, overlapSkipped: 0, riskRejected: 0, tradesRecorded: 0
  }]));
  const liquidity = { barsEvaluated: 0, bullishMtf: 0, bearishMtf: 0, sweepLow: 0, sweepHigh: 0,
    reclaimAboveEma: 0, reclaimBelowEma: 0, rsiBuyBand: 0, rsiSellBand: 0, completeBuyCondition: 0, completeSellCondition: 0 };
  let p15 = 0, p1 = 0;
  for (let i = 60; i < end - 2; i++) {
    const signalBar = candles[i], signalCloseMs = Date.parse(signalBar.bar_time) + TF_MS.M5;
    while (p15 < m15Rows.length && Date.parse(m15Rows[p15].bar_time) + TF_MS.M15 <= signalCloseMs) p15++;
    while (p1 < h1Rows.length && Date.parse(h1Rows[p1].bar_time) + TF_MS.H1 <= signalCloseMs) p1++;
    if (i < start) continue;
    const f5 = indicators(candles.slice(0, i + 1), signalCloseMs, "M5");
    const f15 = indicators(m15Rows.slice(0, p15), signalCloseMs, "M15");
    const fh1 = indicators(h1Rows.slice(0, p1), signalCloseMs, "H1");
    if (!f5.ok || !f15.ok || !fh1.ok) continue;
    for (const s of STRATEGIES) diagnostics[s].barsEvaluated++;
    const cs = f5.candles, last = cs[cs.length - 1], closes = cs.map(x => x.close);
    const e20 = ema(closes, 20), strength = (function () {
      let up = 0, down = 0;
      for (let k = closes.length - 14; k < closes.length; k++) {
        const d = closes[k] - closes[k - 1]; if (d > 0) up += d; else down -= d;
      }
      return down === 0 ? 100 : 100 - 100 / (1 + up / down);
    })();
    const prior = cs.slice(-21, -1);
    const priorLow = Math.min(...prior.map(x => x.low)), priorHigh = Math.max(...prior.map(x => x.high));
    const sweepLow = last.low < priorLow && last.close > priorLow;
    const sweepHigh = last.high > priorHigh && last.close < priorHigh;
    const bull = f15.trend === "BULLISH" && fh1.trend === "BULLISH";
    const bear = f15.trend === "BEARISH" && fh1.trend === "BEARISH";
    liquidity.barsEvaluated++;
    if (bull) liquidity.bullishMtf++;
    if (bear) liquidity.bearishMtf++;
    if (sweepLow) liquidity.sweepLow++;
    if (sweepHigh) liquidity.sweepHigh++;
    if (last.close > e20) liquidity.reclaimAboveEma++;
    if (last.close < e20) liquidity.reclaimBelowEma++;
    if (strength >= 42 && strength <= 70) liquidity.rsiBuyBand++;
    if (strength >= 30 && strength <= 58) liquidity.rsiSellBand++;
    if (bull && sweepLow && last.close > e20 && strength >= 42 && strength <= 70) liquidity.completeBuyCondition++;
    if (bear && sweepHigh && last.close < e20 && strength >= 30 && strength <= 58) liquidity.completeSellCondition++;
    // High-volatility bars remain eligible; each strategy owns its own regime rules.
    // Candidate signals depend on the closed candle frames and entry profile, not on
    // the SL/TP/holding variant. Reuse them across V1-V5 without changing trade logic.
    const cacheKey = entryProfile.id + ":" + i;
    let candidates = candidateCache.get(cacheKey);
    if (!candidates) {
      candidates = buildCandidates({ frames: { M5: f5, M15: f15, H1: fh1 }, quote: { bid: signalBar.close, ask: signalBar.close }, profile: entryProfile.params });
      candidateCache.set(cacheKey, candidates);
    }
    for (const candidate of candidates) diagnostics[candidate.strategy].candidateSignals++;
    if (!candidates.length) continue;
    const next = candles[i + 1], entryMid = next.open;
    for (const candidate of candidates) {
      const list = tradesBy[candidate.strategy], d = diagnostics[candidate.strategy];
      if (list.length && list[list.length - 1]._exitIndex >= i + 1) { d.overlapSkipped++; continue; }
      const dir = candidate.side === "BUY" ? 1 : -1, entry = entryMid;
      const baseRisk = Math.abs(entry - candidate.stopLoss);
      const risk = baseRisk * (variant.stopMultiplier || 1);
      const stop = entry - dir * risk;
      if (!(risk > 0) || risk < f5.atr14 * .2 || risk > f5.atr14 * 3) { d.riskRejected++; continue; }
      const target = entry + dir * risk * (variant.targetR || 1.5);
      const maxHold = variant.maxHold || 12;
      let exit = entry, reason = "TIME", exitIndex = Math.min(end - 1, i + maxHold);
      for (let j = i + 1; j <= Math.min(end - 1, i + maxHold); j++) {
        const bar = candles[j], sl = dir === 1 ? bar.low <= stop : bar.high >= stop, tp = dir === 1 ? bar.high >= target : bar.low <= target;
        if (sl && tp) { exit = stop; reason = "SL (same-bar ambiguity; conservative)"; exitIndex = j; break; }
        if (sl) { exit = stop; reason = "SL"; exitIndex = j; break; }
        if (tp) { exit = target; reason = "TP1"; exitIndex = j; break; }
        exit = bar.close; exitIndex = j;
      }
      const grossR = dir * (exit - entry) / risk;
      const costR = (costs.spreadPrice + costs.slippagePrice + costs.commissionPrice) / risk;
      list.push({ r: grossR - costR, grossR, costR, risk, entry, exit, side: candidate.side, reason, time: next.bar_time, session: classifySession(next.bar_time), _exitIndex: exitIndex });
      d.tradesRecorded++;
    }
  }
  return { trades: Object.fromEntries(STRATEGIES.map(s => [s, tradesBy[s].map(t => ({ ...t }))])),
    diagnostics, liquidityReclaimDiagnostics: liquidity };
}
module.exports = async (req, res) => {
  if (req.method !== "GET") return send(res, 405, { ok: false, error: "GET only" });
  const symbol = String(req.query.symbol || "XAUUSD-STD");
  if (!ALLOWED.has(symbol)) return send(res, 400, { ok: false, error: "Only XAUUSD-STD is supported." });

  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!root || !key) return send(res, 503, { ok: false, error: "Supabase candle storage is not configured." });
  const spreadOverride = req.query.spreadPrice !== undefined && req.query.spreadPrice !== "";
  const spreadRaw = spreadOverride ? Number(req.query.spreadPrice) : NaN;
  let spreadPrice = 0.28;
  let spreadBenchmark = { source: "fallback benchmark", note: "No fresh MT5 quote available; using USD 0.28/oz fallback." };
  if (spreadOverride && Number.isFinite(spreadRaw)) {
    spreadPrice = Math.max(0, Math.min(10, spreadRaw));
    spreadBenchmark = { source: "manual override", note: "Manually supplied spread benchmark." };
  } else if (!spreadOverride) {
    try {
      const liveSpread = await readFreshMt5Spread(root, key, symbol);
      if (Number.isFinite(liveSpread.spreadPrice)) {
        spreadPrice = Math.max(0, Math.min(10, liveSpread.spreadPrice));
        spreadBenchmark = { source: liveSpread.source, receivedAt: liveSpread.receivedAt, ageSeconds: liveSpread.ageSeconds, note: "Current MT5 spread snapshot applied as a benchmark to historical OHLC; it is not historical per-trade spread." };
      } else spreadBenchmark = { source: "fallback benchmark", note: "USD 0.28/oz fallback; " + liveSpread.reason };
    } catch (error) { spreadBenchmark = { source: "fallback benchmark", note: "USD 0.28/oz fallback; live quote read failed: " + String(error.message || error).slice(0, 120) }; }
  }
  const slippagePrice = Math.max(0, Math.min(10, Number(req.query.slippagePrice ?? .05)));
  const commissionPrice = Math.max(0, Math.min(10, Number(req.query.commissionPrice ?? 0)));
  const maxCandles = Math.max(500, Math.min(5000, Number(req.query.limit) || 3000));
  const formingCandlesExcluded = {};
  const invalidTimeCandlesExcluded = {};
  async function load(tf) {
    const rows = []; const pageSize = 1000;
    for (let offset = 0; offset < maxCandles; offset += pageSize) {
      const q = new URLSearchParams({ select: "bar_time,open,high,low,close,source", symbol: "eq." + symbol, timeframe: "eq." + tf,
        source: "eq.mt5_bridge", order: "bar_time.desc", limit: String(Math.min(pageSize, maxCandles - offset)), offset: String(offset) });
      const r = await fetch(root + "/rest/v1/mt5_candles?" + q, { headers: { apikey: key, Authorization: "Bearer " + key } });
      if (!r.ok) throw new Error("Supabase candle query failed for " + tf + " (" + r.status + ").");
      const page = await r.json(); rows.push(...page); if (page.length < pageSize) break;
    }
    const parsed = rows.reverse().map(x => ({ ...x, open: +x.open, high: +x.high, low: +x.low, close: +x.close }));
    const closed = filterClosedCandles(parsed, tf);
    formingCandlesExcluded[tf] = closed.excludedForming;
    invalidTimeCandlesExcluded[tf] = closed.excludedInvalidTime;
    return closed.candles.filter(x => [x.open,x.high,x.low,x.close].every(Number.isFinite) &&
      x.high >= Math.max(x.open,x.close,x.low) && x.low <= Math.min(x.open,x.close,x.high));
  }
  function aggregateM5(source, targetTf) {
    const targetMs = TF_MS[targetTf], perBar = targetMs / TF_MS.M5;
    const groups = new Map();
    for (const bar of source) {
      const bucket = Math.floor(bar.timeMs / targetMs) * targetMs;
      if (!groups.has(bucket)) groups.set(bucket, []);
      groups.get(bucket).push(bar);
    }
    const out = [];
    for (const [bucket, group] of groups) {
      group.sort((a, b) => a.timeMs - b.timeMs);
      // Only build complete, contiguous higher-timeframe candles. Never fill gaps with guesses.
      if (group.length !== perBar) continue;
      let contiguous = true;
      for (let i = 0; i < group.length; i++) {
        if (group[i].timeMs !== bucket + i * TF_MS.M5) { contiguous = false; break; }
      }
      if (!contiguous) continue;
      out.push({
        bar_time: new Date(bucket).toISOString(),
        timeMs: bucket,
        open: group[0].open,
        high: Math.max(...group.map(x => x.high)),
        low: Math.min(...group.map(x => x.low)),
        close: group[group.length - 1].close,
        source: "mt5_m5_aggregated"
      });
    }
    return out;
  }
  try {
    const [m5, storedM15, storedH1] = await Promise.all([load("M5"), load("M15"), load("H1")]);
    if (m5.length < 250)
      return send(res, 200, { ok: true, ready: false, counts: { M5: m5.length, M15: storedM15.length, H1: storedH1.length }, message: "Kulang ang verified MT5 M5 history. Kailangan ng hindi bababa sa 250 M5 candles." });
    // Prefer verified native MT5 timeframe history when sufficient; otherwise derive exact OHLC
    // from complete M5 groups already stored in Supabase, so a separate MT5 upload is not required.
    const derivedM15 = storedM15.length >= 60 ? [] : aggregateM5(m5, "M15");
    const derivedH1 = storedH1.length >= 60 ? [] : aggregateM5(m5, "H1");
    const m15 = storedM15.length >= 60 ? storedM15 : derivedM15;
    const h1 = storedH1.length >= 60 ? storedH1 : derivedH1;
    const timeframeSources = {
      M5: "MT5 history from Supabase",
      M15: storedM15.length >= 60 ? "MT5 history from Supabase" : "aggregated from complete M5 candles",
      H1: storedH1.length >= 60 ? "MT5 history from Supabase" : "aggregated from complete M5 candles"
    };
    if (m15.length < 60 || h1.length < 60)
      return send(res, 200, { ok: true, ready: false, counts: { M5: m5.length, M15: m15.length, H1: h1.length }, timeframeSources, message: "Hindi sapat ang complete historical candles para sa M15/H1. Kailangan ng mas mahabang M5 history; walang synthetic o guessed candles na gagamitin." });
    const split = Math.floor(m5.length * .7), costs = { spreadPrice, slippagePrice, commissionPrice };
    let newsCalendar = { events: [], source: "MT5 broker calendar", status: "UNAVAILABLE" };
    try {
      newsCalendar = { ...(await loadHistoricalNews(m5[0].timeMs, m5[m5.length - 1].timeMs + TF_MS.M5)), status: "CONNECTED" };
    } catch (newsError) {
      newsCalendar.error = newsError.message || "Calendar request failed";
    }
    const variants = [
      { id:"V1", stopMultiplier:0.8, targetR:1.0, maxHold:8 },
      { id:"V2", stopMultiplier:1.0, targetR:1.5, maxHold:12 },
      { id:"V3", stopMultiplier:1.2, targetR:2.0, maxHold:16 },
      { id:"V4", stopMultiplier:1.5, targetR:2.5, maxHold:20 },
      { id:"V5", stopMultiplier:2.0, targetR:3.0, maxHold:24 }
    ];
    const entryProfiles = [
      { id:"BASE", params:{} },
      { id:"SENSITIVE", params:{ breakoutLookback:12, sweepLookback:12, rsiBand:5, momentumBodyAtr:.65, breakoutBodyAtr:.25, oscillatorExtreme:25, cciExtreme:120, williamsExtreme:85, bandDeviation:1.8, srLookback:24, srWickRatio:1.0, pullbackTouchAtr:.16, mtfTouchAtr:.18, divergenceLookback:45, divergenceRsiDelta:-1, donchianLookback:12 } },
      { id:"STRICT", params:{ breakoutLookback:30, sweepLookback:30, rsiBand:-3, momentumBodyAtr:1.0, breakoutBodyAtr:.5, oscillatorExtreme:15, cciExtreme:150, williamsExtreme:90, bandDeviation:2.2, srLookback:60, srWickRatio:1.6, pullbackTouchAtr:.04, mtfTouchAtr:.05, divergenceLookback:25, divergenceRsiDelta:3, donchianLookback:30 } }
    ];
    // One request-scoped cache shares identical closed-candle signals across all five
    // exit variants. Each candidate still gets its own independent replay/overlap state.
    const candidateCache = new Map();
    const candidateRuns = entryProfiles.flatMap(entryProfile => variants.map(variant => {
      const devReplay = replay(m5,m15,h1,60,split,costs,variant,entryProfile,candidateCache);
      const holdReplay = replay(m5,m15,h1,split,m5.length,costs,variant,entryProfile,candidateCache);
      // Slippage stress is repriced from the same holdout fills; no second candle replay is needed.
      return { variant, entryProfile, devReplay, holdReplay };
    }));
    const wfStartMs = m5[60].timeMs;
    const wfEndMs = m5[split - 1].timeMs + TF_MS.M5;
    const results = candidateRuns.flatMap(run => STRATEGIES.map(strategy => {
      const {variant,entryProfile,devReplay,holdReplay}=run;
      const devTrades = devReplay.trades[strategy], holdTrades = holdReplay.trades[strategy];
      const dev = summarize(devTrades), holdout = summarize(holdTrades);
      const walkForward = chronologicalWalkForward(devTrades, wfStartMs, wfEndMs, summarize, 3);
      const devSessions = sessionBreakdown(devTrades), holdoutSessions = sessionBreakdown(holdTrades);
      const devNews = newsBreakdown(devTrades, newsCalendar.events), holdNews = newsBreakdown(holdTrades, newsCalendar.events);
      const s05 = summarizeWithExtraSlippage(holdTrades, costs, .05), s10 = summarizeWithExtraSlippage(holdTrades, costs, .10);
      const eligible = holdout.trades >= 20 && dev.trades >= 20 && dev.expectancyR > 0 && holdout.expectancyR > 0 &&
        holdout.profitFactor > 1.15 && holdout.maxDrawdownR <= 10 && walkForward.stable && s05.expectancyR > 0 && s10.expectancyR > 0;
      return { id: strategy+"-"+entryProfile.id+"-"+variant.id, strategy, entryProfile:entryProfile.id, variant, development: dev, walkForward, holdout, _auditTrades: holdReplay.trades[strategy], sessionAnalysis: { development: devSessions, holdout: holdoutSessions }, newsAnalysis: { status: newsCalendar.status, development: devNews, holdout: holdNews, eventCount: newsCalendar.events.length, windows: "High/medium US releases; trade entry timestamp within +/-15, +/-30, +/-60 minutes. Observational breakdown only; not a news-avoidance simulation." }, stressPlus005: s05, stressPlus010: s10, qualifiedForPaperReview: eligible,
        status: eligible ? "FORWARD_PAPER_REVIEW_ONLY" : "NOT_QUALIFIED",
        diagnostics: { development: devReplay.diagnostics[strategy], holdout: holdReplay.diagnostics[strategy] },
        trades: holdReplay.trades[strategy].slice(-20).map(({_exitIndex,risk,...t}) => ({...t, r:+t.r.toFixed(2)})) };
    }).sort((a,b) => Number(b.qualifiedForPaperReview)-Number(a.qualifiedForPaperReview) ||
      b.holdout.expectancyR-a.holdout.expectancyR || b.holdout.profitFactor-a.holdout.profitFactor));
    const duplicateAudit = auditDuplicateCandidates(results);
    for (const candidate of results) delete candidate._auditTrades;
    for (const candidate of results) { if (candidate.duplicateBehavior?.isDuplicate) { candidate.qualifiedForPaperReview = false; candidate.status = "DUPLICATE_BEHAVIOR_REVIEW"; } }
    results.sort((a,b) => Number(b.qualifiedForPaperReview)-Number(a.qualifiedForPaperReview) || b.holdout.expectancyR-a.holdout.expectancyR || b.holdout.profitFactor-a.holdout.profitFactor);
    return send(res, 200, { ok: true, ready: true, symbol, timeframe: "M5", engineCount: STRATEGIES.length,
      engineNames: STRATEGIES, candidateCount: results.length, independentCandidateCount: duplicateAudit.independentCandidateCount, candidatesPerEngine: entryProfiles.length*variants.length, entryProfiles, liquidityReclaimDiagnostics: { development: candidateRuns[1].devReplay.liquidityReclaimDiagnostics, holdout: candidateRuns[1].holdReplay.liquidityReclaimDiagnostics }, counts: { M5: m5.length, M15: m15.length, H1: h1.length }, timeframeSources, dataQuality: { source: "MT5 broker candles", barPolicy: "Only fully closed candles; forming bars excluded before split/replay", formingCandlesExcluded, invalidTimeCandlesExcluded, lastClosedBar: m5[m5.length - 1]?.bar_time || null },
      split: { developmentCandles: split, holdoutCandles: m5.length - split, method: "chronological 70/30" },
      costModel: { ...costs, spreadBenchmark, historicalSpreadAvailable: false, note: "Spread benchmark uses the latest fresh MT5 bid/ask snapshot when available; it is applied uniformly to historical OHLC because historical bid/ask is not stored." },
      execution: "Signal on a fully closed M5 candle; entry at next M5 open; only M15/H1 bars fully closed by signal time are visible; same-bar SL/TP resolves to SL. Exit rules vary by candidate. Session labels use London and New York local 08:00-17:00 via IANA time zones, including DST; overlap is labeled separately.",
      sessionMethod: "Each trade is assigned using its entry timestamp. London 08:00-17:00 Europe/London; New York 08:00-17:00 America/New_York; overlap when both are active; all other times ASIA_OTHER. These are configurable research windows, not exchange-open guarantees.",
      newsCalendar: { status: newsCalendar.status, source: newsCalendar.source, attribution: newsCalendar.attribution, from: newsCalendar.from || null, to: newsCalendar.to || null, eventCount: newsCalendar.events.length, error: newsCalendar.error || null },
      newsFilter: { status: newsCalendar.status, mode: "OBSERVATIONAL_ONLY", eventCount: newsCalendar.events.length, windowsMinutes: [15, 30, 60], note: "News proximity is reported around trade entry times; this does not block entries or simulate an avoidance rule." },
      qualification: "At least 20 development and 20 untouched holdout trades, positive development/holdout expectancy, positive expectancy in at least 2 of 3 chronological development folds (minimum 2 trades per fold), holdout PF > 1.15, drawdown <= 10R, positive expectancy under +0.05/+0.10 USD/oz slippage stress, and not an exact duplicate execution signature. Qualified results are paper-review only; this is not live-trading approval.",
      walkForward: { method: "3 chronological validation windows inside the 70% development period; fixed candidate rules, no parameter refitting; final 30% holdout remains untouched", folds: 3, minimumTradesPerFold: 2 },
      duplicateAudit,
      results });
  } catch (e) { console.error("[DARS 19-engine backtest]", e); return send(res, 502, { ok: false, error: "19-engine backtest failed: " + (e && e.message ? String(e.message).slice(0, 500) : "Unknown server error") }); }
};
