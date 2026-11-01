// DARS 15-engine historical replay. Reuses the exact live buildCandidates() engine rules.
// Research only: no broker order methods, no paper/live orders are created here.
const { STRATEGIES, buildCandidates } = require("./dars-strategy-engines");
const { ema, atr } = require("./dars-strategy-engines");
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
  if (event.time_utc) {
    const t = Date.parse(event.time_utc);
    if (Number.isFinite(t)) return t;
  }
  if (event.datetime) {
    const t = Date.parse(event.datetime);
    if (Number.isFinite(t)) return t;
  }
  return null; // Date-only/all-day events are not assigned a fabricated release time.
}
async function loadHistoricalNews(fromMs, toMs) {
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) {
    throw new Error("Invalid historical candle date range for news calendar.");
  }
  const base = "https://www.financecalendar.com/wp-json/fc/v1/calendar";
  const events = [];
  const seen = new Set();
  const chunkDays = 90; // Provider limit is 92 days per request.
  const dayMs = 24 * 60 * 60 * 1000;
  let chunkStart = Date.UTC(
    new Date(fromMs).getUTCFullYear(),
    new Date(fromMs).getUTCMonth(),
    new Date(fromMs).getUTCDate()
  );
  const finalDay = Date.UTC(
    new Date(toMs).getUTCFullYear(),
    new Date(toMs).getUTCMonth(),
    new Date(toMs).getUTCDate()
  );
  while (chunkStart <= finalDay) {
    const chunkEnd = Math.min(chunkStart + (chunkDays - 1) * dayMs, finalDay);
    const from = new Date(chunkStart).toISOString().slice(0, 10);
    const to = new Date(chunkEnd).toISOString().slice(0, 10);
    for (let offset = 0; offset < 2000; offset += 500) {
      const q = new URLSearchParams({ from, to, country: "US", impact: "high,medium", tz: "UTC", limit: "500", offset: String(offset) });
      const response = await fetch(base + "?" + q.toString(), { headers: { Accept: "application/json" } });
      if (!response.ok) {
        let detail = "";
        try { const body = await response.json(); detail = body.error || ""; } catch {}
        throw new Error("Finance Calendar API HTTP " + response.status + (detail ? ": " + detail : ""));
      }
      const body = await response.json();
      const rows = Array.isArray(body.events) ? body.events : [];
      for (const event of rows) {
        const timeMs = eventTimestamp(event);
        if (timeMs === null || timeMs < fromMs || timeMs > toMs) continue;
        const id = String(event.id || event.series_code || event.name || event.title || timeMs);
        const key = id + "|" + timeMs;
        if (seen.has(key)) continue;
        seen.add(key);
        events.push({ id, name: event.name || event.title || "Economic event",
          currency: event.currency || "USD", impact: String(event.impact || "").toLowerCase(), timeMs });
      }
      if (rows.length < 500 || offset + rows.length >= Number(body.total || rows.length)) break;
    }
    chunkStart = chunkEnd + dayMs;
  }
  events.sort((a, b) => a.timeMs - b.timeMs);
  return { events, source: "Finance Calendar API", attribution: "https://www.financecalendar.com", from: new Date(fromMs).toISOString().slice(0, 10), to: new Date(toMs).toISOString().slice(0, 10) };
}
function sessionBreakdown(trades) {
  const groups = { LONDON: [], NEW_YORK: [], LONDON_NEW_YORK_OVERLAP: [], ASIA_OTHER: [] };
  for (const trade of trades) groups[trade.session || "ASIA_OTHER"].push(trade);
  return Object.fromEntries(Object.entries(groups).map(([session, rows]) => [session, summarize(rows)]));
}
function replay(candles, m15Rows, h1Rows, start, end, costs, variant = {}, entryProfile = {}) {
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
    const candidates = buildCandidates({ frames: { M5: f5, M15: f15, H1: fh1 }, quote: { bid: signalBar.close, ask: signalBar.close }, profile: entryProfile.params });
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
      list.push({ r: grossR - costR, grossR, costR, entry, exit, reason, time: next.bar_time, session: classifySession(next.bar_time), _exitIndex: exitIndex });
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
    return rows.reverse().map(x => ({ ...x, timeMs: Date.parse(x.bar_time), open: +x.open, high: +x.high, low: +x.low, close: +x.close }))
      .filter(x => [x.open,x.high,x.low,x.close].every(Number.isFinite) && x.high >= Math.max(x.open,x.close,x.low) && x.low <= Math.min(x.open,x.close,x.high));
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
    let newsCalendar = { events: [], source: "Finance Calendar API", attribution: "https://www.financecalendar.com", status: "UNAVAILABLE" };
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
      { id:"SENSITIVE", params:{ breakoutLookback:12, sweepLookback:12, rsiBand:5, momentumBodyAtr:.65, breakoutBodyAtr:.25, oscillatorExtreme:25, cciExtreme:120, williamsExtreme:85, bandDeviation:1.8 } },
      { id:"STRICT", params:{ breakoutLookback:30, sweepLookback:30, rsiBand:-3, momentumBodyAtr:1.0, breakoutBodyAtr:.5, oscillatorExtreme:15, cciExtreme:150, williamsExtreme:90, bandDeviation:2.2 } }
    ];
    const candidateRuns = entryProfiles.flatMap(entryProfile => variants.map(variant => {
      const devReplay = replay(m5,m15,h1,60,split,costs,variant,entryProfile);
      const holdReplay = replay(m5,m15,h1,split,m5.length,costs,variant,entryProfile);
      const stress05 = replay(m5,m15,h1,split,m5.length,{...costs,slippagePrice:slippagePrice+.05},variant,entryProfile);
      const stress10 = replay(m5,m15,h1,split,m5.length,{...costs,slippagePrice:slippagePrice+.10},variant,entryProfile);
      return { variant, entryProfile, devReplay, holdReplay, stress05, stress10 };
    }));
    const results = candidateRuns.flatMap(run => STRATEGIES.map(strategy => {
      const {variant,entryProfile,devReplay,holdReplay,stress05,stress10}=run;
      const devTrades = devReplay.trades[strategy], holdTrades = holdReplay.trades[strategy];
      const dev = summarize(devTrades), holdout = summarize(holdTrades);
      const devSessions = sessionBreakdown(devTrades), holdoutSessions = sessionBreakdown(holdTrades);
      const devNews = newsBreakdown(devTrades, newsCalendar.events), holdNews = newsBreakdown(holdTrades, newsCalendar.events);
      const s05 = summarize(stress05.trades[strategy]), s10 = summarize(stress10.trades[strategy]);
      const eligible = holdout.trades >= 30 && dev.trades >= 30 && dev.expectancyR > 0 && holdout.expectancyR > 0 &&
        holdout.profitFactor > 1.1 && holdout.maxDrawdownR <= 12 && s05.expectancyR > 0 && s10.expectancyR > 0;
      return { id: strategy+"-"+entryProfile.id+"-"+variant.id, strategy, entryProfile:entryProfile.id, variant, development: dev, holdout, sessionAnalysis: { development: devSessions, holdout: holdoutSessions }, newsAnalysis: { status: newsCalendar.status, development: devNews, holdout: holdNews, eventCount: newsCalendar.events.length, windows: "High/medium US releases; trade entry timestamp within +/-15, +/-30, +/-60 minutes. Observational breakdown only; not a news-avoidance simulation." }, stressPlus005: s05, stressPlus010: s10, qualifiedForPaperReview: eligible,
        status: eligible ? "FORWARD_PAPER_REVIEW_ONLY" : "NOT_QUALIFIED",
        diagnostics: { development: devReplay.diagnostics[strategy], holdout: holdReplay.diagnostics[strategy] },
        trades: holdReplay.trades[strategy].slice(-20).map(({_exitIndex,...t}) => ({...t, r:+t.r.toFixed(2)})) };
    }).sort((a,b) => Number(b.qualifiedForPaperReview)-Number(a.qualifiedForPaperReview) ||
      b.holdout.expectancyR-a.holdout.expectancyR || b.holdout.profitFactor-a.holdout.profitFactor));
    return send(res, 200, { ok: true, ready: true, symbol, timeframe: "M5", engineCount: STRATEGIES.length,
      engineNames: STRATEGIES, candidateCount: results.length, candidatesPerEngine: entryProfiles.length*variants.length, entryProfiles, liquidityReclaimDiagnostics: { development: candidateRuns[1].devReplay.liquidityReclaimDiagnostics, holdout: candidateRuns[1].holdReplay.liquidityReclaimDiagnostics }, counts: { M5: m5.length, M15: m15.length, H1: h1.length }, timeframeSources,
      split: { developmentCandles: split, holdoutCandles: m5.length - split, method: "chronological 70/30" },
      costModel: { ...costs, historicalSpreadAvailable: false, note: "Spread is an assumed benchmark; MT5 OHLC history has no historical bid/ask." },
      execution: "Signal on a fully closed M5 candle; entry at next M5 open; only M15/H1 bars fully closed by signal time are visible; same-bar SL/TP resolves to SL. Exit rules vary by candidate. Session labels use London and New York local 08:00-17:00 via IANA time zones, including DST; overlap is labeled separately.",
      sessionMethod: "Each trade is assigned using its entry timestamp. London 08:00-17:00 Europe/London; New York 08:00-17:00 America/New_York; overlap when both are active; all other times ASIA_OTHER. These are configurable research windows, not exchange-open guarantees.",
      newsCalendar: { status: newsCalendar.status, source: newsCalendar.source, attribution: newsCalendar.attribution, from: newsCalendar.from || null, to: newsCalendar.to || null, eventCount: newsCalendar.events.length, error: newsCalendar.error || null },
      newsFilter: { status: newsCalendar.status, mode: "OBSERVATIONAL_ONLY", eventCount: newsCalendar.events.length, windowsMinutes: [15, 30, 60], note: "News proximity is reported around trade entry times; this does not block entries or simulate an avoidance rule." },
      qualification: "At least 30 development and 30 holdout trades, positive expectancy in both, holdout PF > 1.10, drawdown <= 12R and positive expectancy under +0.05/+0.10 USD/oz slippage stress. Qualified results are paper-review only.",
      results });
  } catch (e) { console.error("[DARS 15-engine backtest]", e); return send(res, 502, { ok: false, error: "15-engine backtest failed: " + (e && e.message ? String(e.message).slice(0, 500) : "Unknown server error") }); }
};
