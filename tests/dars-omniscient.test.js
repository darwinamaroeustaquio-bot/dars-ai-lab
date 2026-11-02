const assert = require("node:assert/strict");
const { analyzeDarsMarket } = require("../lib/dars-omniscient");
const { filterClosedCandles } = require("../lib/dars-market-data");

// Historical research must exclude the MT5 bridge still-forming bar.
const fixedNow = Date.UTC(2026, 10, 2, 12, 0, 0);
const closeBar = { bar_time: new Date(fixedNow - 600_000).toISOString(), open: 1, high: 2, low: 0.5, close: 1.5 };
const formingBar = { bar_time: new Date(fixedNow - 120_000).toISOString(), open: 1.5, high: 2, low: 1, close: 1.8 };
const closedOnly = filterClosedCandles([closeBar, formingBar], "M5", fixedNow);
assert.equal(closedOnly.candles.length, 1);
assert.equal(closedOnly.candles[0].bar_time, closeBar.bar_time);
assert.equal(closedOnly.excludedForming, 1);
assert.equal(closedOnly.excludedInvalidTime, 0);
const closedH1 = filterClosedCandles([{ bar_time: new Date(fixedNow - 3_600_000).toISOString() }, { bar_time: new Date(fixedNow - 1_800_000).toISOString() }], "H1", fixedNow);
assert.equal(closedH1.candles.length, 1);
assert.equal(closedH1.excludedForming, 1);


const now = Date.now();
const freshQuote = { bid: 4000, ask: 4000.2, received_at: new Date(now).toISOString() };
const empty = analyzeDarsMarket({ now, symbol: "XAUUSD-STD", quote: freshQuote, frames: {} });
assert.equal(empty.decision, "WAIT");
assert.ok(empty.diagnostics.some(x => /Missing M5/.test(x)));

const stale = analyzeDarsMarket({ now, symbol: "XAUUSD-STD", quote: { ...freshQuote, received_at: new Date(now - 60_000).toISOString() }, frames: {} });
assert.equal(stale.decision, "WAIT");
assert.ok(stale.diagnostics.some(x => /stale/.test(x)));

const wrongSymbol = analyzeDarsMarket({ now, symbol: "GOLD", quote: freshQuote, frames: {} });
assert.equal(wrongSymbol.decision, "WAIT");
assert.ok(wrongSymbol.diagnostics.some(x => /Only the configured/.test(x)));

function candles(tfMs, count = 70) {
  return Array.from({ length: count }, (_, i) => {
    const close = 3900 + i * 0.5;
    return {
      bar_time: new Date(now - (count - i) * tfMs - 1000).toISOString(),
      open: close - 0.2, high: close + 0.4, low: close - 0.5, close
    };
  });
}
const frames = { M5: candles(300_000), M15: candles(900_000), H1: candles(3_600_000) };
// Add an unfinished current M5 candle. The engine must ignore it.
frames.M5.push({ bar_time: new Date(now - 30_000).toISOString(), open: 4000, high: 4001, low: 3999, close: 4000.5 });
const validHistory = analyzeDarsMarket({ now, symbol: "XAUUSD-STD", quote: freshQuote, frames });
assert.equal(validHistory.frames.M5.ok, true);
assert.equal(validHistory.frames.M5.count, 70);
assert.equal(validHistory.decision, "WAIT"); // no sweep/reclaim: no forced entry
console.log("DARS Omniscient core safety tests passed.");


const fs = require("node:fs");
const path = require("node:path");
const dashboard = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
assert.equal(dashboard.split("<style").length - 1, dashboard.split("</style>").length - 1,
  "Dashboard stylesheet tags must be balanced.");
assert.ok(dashboard.includes('id="omniscientDashboard"'), "Omniscient dashboard must be present.");
assert.ok(dashboard.includes('id="darsOmniscientRuntime"'), "Omniscient runtime must be present.");
assert.ok(dashboard.includes("/api/dars-omniscient"), "Dashboard must call the authoritative analysis endpoint.");
assert.ok(dashboard.includes("/api/mt5-candles"), "Dashboard must use the MT5 candle feed.");
const candidateLabSource = fs.readFileSync(path.join(__dirname, "..", "api", "candidate-lab.js"), "utf8");
const engineReplaySource = fs.readFileSync(path.join(__dirname, "..", "lib", "dars-15-engine-backtest.js"), "utf8");
assert.ok(candidateLabSource.includes("filterClosedCandles"), "Candidate Lab must exclude unfinished MT5 candles.");
assert.ok(engineReplaySource.includes("filterClosedCandles"), "19-engine replay must exclude unfinished MT5 candles.");
console.log("DARS dashboard integration smoke tests passed.");


// DARS MT5 execution bridge foundation must fail closed and contain no order routing.
const executionStatus = require("../api/dars-execution-status");
(async () => {
  const response = {
    headers: {},
    statusCode: 200,
    setHeader(k, v) { this.headers[k] = v; return this; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    end() { return this; }
  };
  await executionStatus({ method: "GET" }, response);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.live_enabled, false);
  assert.equal(response.body.paper_enabled, false);
  assert.equal(response.body.emergency_stop, true);
  assert.equal(response.body.order_submission_enabled, false);

  const fs = require("node:fs");
  const path = require("node:path");
  const gateway = fs.readFileSync(path.join(__dirname, "..", "mt5", "DARS_Execution_Gateway.mq5"), "utf8");
  assert.ok(gateway.includes("input bool   InpEnableLiveTrading = false"));
  assert.ok(gateway.includes("void OnTick()"));
  assert.equal(gateway.includes("OrderSend"), false, "Foundation EA must not contain order submission.");
  assert.equal(gateway.includes("CTrade"), false, "Foundation EA must not contain CTrade.");
  console.log("DARS execution bridge fail-closed tests passed.");
})().catch(error => { console.error(error); process.exitCode = 1; });


// Execution-cost guard: reject abnormal absolute spread before issuing any setup.
const wideSpread = analyzeDarsMarket({
  now, symbol: "XAUUSD-STD",
  quote: { bid: 4000, ask: 4000.75, received_at: new Date(now).toISOString() },
  frames
});
assert.equal(wideSpread.decision, "WAIT");
assert.ok(wideSpread.diagnostics.some(x => /Spread exceeds/.test(x)));
assert.equal(wideSpread.quoteQuality.maxSpread, 0.50);
assert.equal(wideSpread.engine, "DARS_OMNISCIENT_QUANT_V3");
console.log("DARS execution-cost quality gate tests passed.");


// Adaptive strategy selector: regime candidate plus out-of-sample evidence gate.
const { selectAdaptiveStrategy, performanceGate } = require("../lib/dars-adaptive-selector");
const strongEvidence = {
  totalTrades: 100, holdoutTrades: 30, expectancyR: 0.08,
  profitFactor: 1.25, maxDrawdownR: 3.5, consecutiveLosses: 2,
  model: { validated: true, winProbability: 0.61 }
};
const trendCandidate = selectAdaptiveStrategy({ regime: "TRENDING", trend: "BULLISH" });
assert.equal(trendCandidate.candidate, "SUPERTREND");
assert.equal(trendCandidate.eligible, false);
assert.equal(trendCandidate.status, "BLOCKED_BY_EVIDENCE");

const rangeCandidate = selectAdaptiveStrategy({ regime: "RANGE_OR_TRANSITION", trend: "MIXED" });
assert.equal(rangeCandidate.candidate, "MEAN_REVERSION");
assert.equal(rangeCandidate.eligible, false);
assert.equal(rangeCandidate.status, "BLOCKED_BY_EVIDENCE");

const volatilityCandidate = selectAdaptiveStrategy({ regime: "HIGH_VOLATILITY", trend: "BULLISH" });
assert.equal(volatilityCandidate.candidate, "NO_TRADE");
assert.equal(volatilityCandidate.eligible, false);

const sweepUnproven = selectAdaptiveStrategy({
  regime: "TRENDING", trend: "BULLISH", sweepLow: true, strategyStats: {}
});
assert.equal(sweepUnproven.candidate, "LIQUIDITY_RECLAIM");
assert.equal(sweepUnproven.status, "BLOCKED_BY_EVIDENCE");
assert.equal(sweepUnproven.eligible, false);

const sweepProven = selectAdaptiveStrategy({
  regime: "TRENDING", trend: "BULLISH", sweepLow: true,
  strategyStats: { LIQUIDITY_RECLAIM: strongEvidence }
});
assert.equal(sweepProven.status, "PAPER_ELIGIBLE");
assert.equal(sweepProven.eligible, true);
assert.equal(performanceGate({ ...strongEvidence, totalTrades: 99 }).passed, false, "Promotion must wait for 100 closed forward-paper trades.");
assert.equal(performanceGate({ ...strongEvidence, holdoutTrades: 29 }).passed, false, "Promotion requires at least 30 untouched chronological holdout trades.");
assert.equal(performanceGate({ ...strongEvidence, holdoutTrades: 30 }).passed, true, "100 total trades with 30 holdout trades may pass if all other gates pass.");
assert.equal(performanceGate({ ...strongEvidence, profitFactor: 1.14 }).passed, false, "Promotion requires PF above the 1.15 floor.");
console.log("DARS adaptive selector tests passed.");


// New adaptive journal modules must load safely and fail closed without server credentials.
require("../api/dars-omniscient");
const paperJournalApi = require("../api/dars-paper-journal");
const { trainOutcomeModel, summarizeByStrategy } = require("../lib/dars-paper-research");
const { STRATEGIES, buildCandidates } = require("../lib/dars-strategy-engines");
assert.equal(trainOutcomeModel([]).ready, false);
assert.equal(buildCandidates({ frames: {}, quote: {} }).length, 0);
assert.equal(summarizeByStrategy([]).LIQUIDITY_RECLAIM.totalTrades, 0);
assert.equal(STRATEGIES.length, 19, "DARS must expose nineteen independently tracked strategy engines.");
assert.equal(new Set(STRATEGIES).size, 19, "Strategy identifiers must be unique.");
assert.equal(Object.keys(summarizeByStrategy([])).length, 19, "Every strategy must have its own research metrics across all 19 engines.");
const adaptivePaperHtml = fs.readFileSync(path.join(__dirname, "..", "adaptive-paper.html"), "utf8");
for (const strategy of ["MACD_CROSSOVER", "DONCHIAN_BREAKOUT", "ICHIMOKU_CLOUD", "SUPERTREND"]) {
  assert.ok(adaptivePaperHtml.includes(strategy), "Adaptive paper lab must display " + strategy + ".");
}
const journalSchema = fs.readFileSync(path.join(__dirname, "..", "supabase", "dars_paper_journal.sql"), "utf8");
for (const strategy of STRATEGIES) {
  assert.ok(journalSchema.includes("'" + strategy + "'"), "Supabase paper journal must allow " + strategy + ".");
}

const candidateSelection = selectAdaptiveStrategy({
  regime: "TRENDING", trend: "BULLISH", candidates: [{ strategy: "MOMENTUM" }], strategyStats: {}
});
assert.equal(candidateSelection.candidate, "MOMENTUM");
assert.equal(candidateSelection.status, "BLOCKED_BY_EVIDENCE");
assert.equal(candidateSelection.eligible, false);
const noSetupSelection = selectAdaptiveStrategy({ regime: "TRENDING", trend: "BULLISH", candidates: [] });
assert.equal(noSetupSelection.status, "NO_SETUP");

(async () => {
  const response = {
    statusCode: 200,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
  await paperJournalApi({ method: "GET" }, response);
  assert.equal(response.statusCode, 503, "Journal API must fail closed until Supabase credentials/schema are configured.");
  assert.equal(response.body.ok, false);
  console.log("DARS server journal and learning module smoke tests passed.");
})().catch(error => { console.error(error); process.exitCode = 1; });


// Adaptive allocation: every current regime candidate is ranked and weights respond to recent outcomes,
// while no strategy can bypass the independent evidence gate.
const { adaptiveScore } = require("../lib/dars-adaptive-selector");
const provenMomentum = {
  ...strongEvidence, totalTrades: 140, holdoutTrades: 42, expectancyR: 0.09,
  profitFactor: 1.3, maxDrawdownR: 2.8, consecutiveLosses: 1,
  recentExpectancyR: 0.12, recentProfitFactor: 1.45,
  model: { validated: true, winProbability: 0.62 }
};
const provenPullback = {
  ...provenMomentum, recentExpectancyR: -0.12, recentProfitFactor: 0.72,
  maxDrawdownR: 4.5, consecutiveLosses: 3
};
const adaptiveRanking = selectAdaptiveStrategy({
  regime: "TRENDING", trend: "BULLISH",
  candidates: [{ strategy: "MOMENTUM" }, { strategy: "PULLBACK" }],
  strategyStats: { MOMENTUM: provenMomentum, PULLBACK: provenPullback }
});
assert.equal(adaptiveRanking.status, "PAPER_ELIGIBLE");
assert.equal(adaptiveRanking.candidate, "MOMENTUM");
assert.equal(adaptiveRanking.strategyRanking.length, 2);
assert.ok(adaptiveRanking.strategyRanking[0].weight > adaptiveRanking.strategyRanking[1].weight);
assert.ok(Math.abs(adaptiveRanking.strategyRanking.reduce((sum, x) => sum + x.weight, 0) - 1) < 0.001);
assert.match(adaptiveRanking.adaptation, /re-ranked on each sync/);
const weakNoBypass = selectAdaptiveStrategy({
  regime: "TRENDING", trend: "BULLISH",
  candidates: [{ strategy: "MOMENTUM" }],
  strategyStats: { MOMENTUM: { ...provenMomentum, totalTrades: 9 } }
});
assert.equal(weakNoBypass.eligible, false, "Dynamic weighting must never bypass the 100-trade and 30-trade chronological holdout evidence gates.");
assert.equal(weakNoBypass.status, "BLOCKED_BY_EVIDENCE");
console.log("DARS adaptive allocation and evidence-gate tests passed.");


// Chronological fold stability and exact duplicate execution fingerprint tests.
const { chronologicalWalkForward, auditDuplicateCandidates } = require("../lib/dars-research-validation");
const wfTrades = Array.from({ length: 6 }, (_, i) => ({
  time: new Date(60_000 + i * 120_000).toISOString(),
  r: i % 2 === 0 ? 1 : 0.5
}));
const wfSummary = rows => ({
  trades: rows.length,
  expectancyR: rows.length ? rows.reduce((sum, row) => sum + row.r, 0) / rows.length : 0,
  netR: rows.reduce((sum, row) => sum + row.r, 0),
  profitFactor: 2,
  maxDrawdownR: 0
});
const wf = chronologicalWalkForward(wfTrades, 0, 720_000, wfSummary, 3);
assert.equal(wf.folds.length, 3);
assert.equal(wf.profitableFolds, 3);
assert.equal(wf.stable, true);

const identicalExecution = [
  { time: new Date(1000).toISOString(), side: "BUY", entry: 4000, exit: 4002, risk: 2, r: 0.9, reason: "TP1" },
  { time: new Date(2000).toISOString(), side: "SELL", entry: 4002, exit: 4004, risk: 2, r: -1.1, reason: "SL" },
  { time: new Date(3000).toISOString(), side: "BUY", entry: 4004, exit: 4006, risk: 2, r: 0.9, reason: "TP1" }
];
const duplicateRows = [
  { id: "A", holdout: { expectancyR: 0.3, profitFactor: 1.8, maxDrawdownR: 1 } , _auditTrades: identicalExecution },
  { id: "B", holdout: { expectancyR: 0.2, profitFactor: 1.5, maxDrawdownR: 2 } , _auditTrades: identicalExecution.map(x => ({ ...x })) },
  { id: "C", holdout: { expectancyR: 0.1, profitFactor: 1.2, maxDrawdownR: 1 } , _auditTrades: identicalExecution.map(x => ({ ...x, entry: x.entry + 10 })) }
];
const duplicateReport = auditDuplicateCandidates(duplicateRows);
assert.equal(duplicateReport.duplicateGroups, 1);
assert.equal(duplicateRows.find(x => x.id === "A").duplicateBehavior.isDuplicate, false);
assert.equal(duplicateRows.find(x => x.id === "B").duplicateBehavior.isDuplicate, true);
assert.equal(duplicateRows.find(x => x.id === "C").duplicateBehavior.isDuplicate, false);
console.log("DARS walk-forward and duplicate-strategy audit tests passed.");
