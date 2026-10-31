const assert = require("node:assert/strict");
const { analyzeDarsMarket } = require("../lib/dars-omniscient");

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
assert.equal(trendCandidate.candidate, "TREND_FOLLOWING");
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
  candidates: [
    { strategy: "LIQUIDITY_RECLAIM", side: "BUY", entry: 4000, stopLoss: 3998, takeProfit1: 4003, takeProfit2: 4005, riskDistance: 2, features: { spread: 0.2, atr: 3, sweep: 1 } },
    { strategy: "SUPPORT_RESISTANCE", side: "BUY", entry: 4000, stopLoss: 3998, takeProfit1: 4003, takeProfit2: 4005, riskDistance: 2, features: { spread: 0.2, atr: 3, trendAlignment: 1 } }
  ],
  strategyStats: { LIQUIDITY_RECLAIM: strongEvidence, SUPPORT_RESISTANCE: strongEvidence }
});
assert.equal(sweepProven.status, "PAPER_ELIGIBLE");
assert.equal(sweepProven.eligible, true);
assert.equal(performanceGate({ ...strongEvidence, holdoutTrades: 10 }).passed, false);
console.log("DARS adaptive selector tests passed.");


// New adaptive journal modules must load safely and fail closed without server credentials.
require("../api/dars-omniscient");
const paperJournalApi = require("../api/dars-paper-journal");
const { trainOutcomeModel, summarizeByStrategy } = require("../lib/dars-paper-research");
const { STRATEGIES, buildCandidates } = require("../lib/dars-strategy-engines");
assert.equal(trainOutcomeModel([]).ready, false);
assert.equal(buildCandidates({ frames: {}, quote: {} }).length, 0);
assert.equal(summarizeByStrategy([]).LIQUIDITY_RECLAIM.totalTrades, 0);
assert.equal(STRATEGIES.length, 15, "DARS must expose fifteen independently tracked strategy engines.");
assert.equal(new Set(STRATEGIES).size, 15, "Strategy identifiers must be unique.");
assert.equal(Object.keys(summarizeByStrategy([])).length, 15, "Every strategy must have its own research metrics.");
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
  candidates: [{ strategy: "MOMENTUM", side: "BUY" }, { strategy: "PULLBACK", side: "BUY" }],
  strategyStats: { MOMENTUM: provenMomentum, PULLBACK: provenPullback }
});
assert.equal(adaptiveRanking.status, "PAPER_ELIGIBLE");
assert.equal(adaptiveRanking.candidate, "MOMENTUM");
assert.equal(adaptiveRanking.strategyRanking.length, 2);
assert.ok(adaptiveRanking.strategyRanking[0].weight > adaptiveRanking.strategyRanking[1].weight);
assert.ok(Math.abs(adaptiveRanking.strategyRanking.reduce((sum, x) => sum + x.weight, 0) - 1) < 0.001);
assert.match(adaptiveRanking.adaptation, /recalculated on every market sync/);
const weakNoBypass = selectAdaptiveStrategy({
  regime: "TRENDING", trend: "BULLISH",
  candidates: [{ strategy: "MOMENTUM" }],
  strategyStats: { MOMENTUM: { ...provenMomentum, totalTrades: 20 } }
});
assert.equal(weakNoBypass.eligible, false, "Dynamic weighting must never bypass the 100-trade evidence gate.");
assert.equal(weakNoBypass.status, "BLOCKED_BY_EVIDENCE");
const champions = selectAdaptiveStrategy({
  regime: "TRENDING",
  candidates: [
    { strategy: "MOMENTUM", side: "BUY", entry: 4000, stopLoss: 3998, takeProfit1: 4003, takeProfit2: 4005, riskDistance: 2, features: { spread: .2, atr: 3 } },
    { strategy: "PULLBACK", side: "BUY", entry: 4000, stopLoss: 3998, takeProfit1: 4003, takeProfit2: 4005, riskDistance: 2, features: { spread: .2, atr: 3 } },
    { strategy: "MEAN_REVERSION", side: "SELL", entry: 4000, stopLoss: 4002, takeProfit1: 3997, takeProfit2: 3995, riskDistance: 2, features: { spread: .2, atr: 3 } }
  ],
  strategyStats: { MOMENTUM: provenMomentum, PULLBACK: provenMomentum, MEAN_REVERSION: provenMomentum }
});
assert.equal(champions.perEngineChampions.length, 3);
assert.equal(champions.ensemble.buyVotes, 2);
assert.equal(champions.ensemble.sellVotes, 1);
assert.equal(champions.ensemble.consensus, true);
assert.equal(champions.status, "PAPER_ELIGIBLE");
assert.ok(champions.selectedSetup);
assert.equal(champions.perEngineChampions.some(x => x.strategy === "MEAN_REVERSION"), true,
  "Opposing engine champion remains in the ensemble research rather than being discarded.");
console.log("DARS per-engine champions and cross-engine ensemble tests passed.");

