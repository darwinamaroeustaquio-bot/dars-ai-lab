/**
 * DARS adaptive strategy selector.
 * Chooses a research candidate from observable regime features, then applies
 * an out-of-sample evidence gate. It does not generate orders or claim edge.
 */
const MIN_HOLDOUT_TRADES = 30;
const MIN_TOTAL_TRADES = 80;
const MIN_EXPECTANCY_R = 0.02;
const MIN_PROFIT_FACTOR = 1.10;
const MAX_DRAWDOWN_R = 6;
const MAX_CONSECUTIVE_LOSSES = 4;

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function performanceGate(stats = {}) {
  const required = ["totalTrades", "holdoutTrades", "expectancyR", "profitFactor", "maxDrawdownR", "consecutiveLosses"];
  const missing = required.filter(key => !finiteNumber(stats[key]));
  if (missing.length) return { passed: false, reason: "Insufficient verified strategy journal metrics: " + missing.join(", ") };
  if (stats.totalTrades < MIN_TOTAL_TRADES) return { passed: false, reason: "Needs at least " + MIN_TOTAL_TRADES + " total paper trades." };
  if (stats.holdoutTrades < MIN_HOLDOUT_TRADES) return { passed: false, reason: "Needs at least " + MIN_HOLDOUT_TRADES + " untouched holdout trades." };
  if (stats.expectancyR < MIN_EXPECTANCY_R) return { passed: false, reason: "Holdout expectancy is not sufficiently positive." };
  if (stats.profitFactor < MIN_PROFIT_FACTOR) return { passed: false, reason: "Holdout profit factor is below the minimum." };
  if (stats.maxDrawdownR > MAX_DRAWDOWN_R) return { passed: false, reason: "Drawdown exceeds the configured evidence limit." };
  if (stats.consecutiveLosses > MAX_CONSECUTIVE_LOSSES) return { passed: false, reason: "Recent loss streak exceeds the safety limit." };
  if (!stats.model || stats.model.validated !== true) return { passed: false, reason: "Outcome-learning model has not passed chronological holdout validation." };\n  return { passed: true, reason: "Paper performance and outcome-learning holdout gates passed." };
}

function selectAdaptiveStrategy({ regime, trend, sweepLow, sweepHigh, strategyStats = {} } = {}) {
  let candidate;
  let rationale;
  if (regime === "HIGH_VOLATILITY") {
    candidate = "NO_TRADE";
    rationale = "Elevated volatility: protect capital and wait.";
  } else if (sweepLow || sweepHigh) {
    candidate = "LIQUIDITY_RECLAIM";
    rationale = "A closed-candle liquidity sweep/reclaim is present; use only the existing validated reclaim rules.";
  } else if (regime === "TRENDING" && (trend === "BULLISH" || trend === "BEARISH")) {
    candidate = "TREND_FOLLOWING";
    rationale = "Directional regime detected; trend-following is the research candidate.";
  } else if (regime === "RANGE_OR_TRANSITION" || trend === "MIXED") {
    candidate = "MEAN_REVERSION";
    rationale = "Range/transition regime detected; mean-reversion is the research candidate.";
  } else {
    candidate = "NO_TRADE";
    rationale = "Market regime is not sufficiently clear.";
  }

  if (candidate === "NO_TRADE") {
    return { candidate, status: "BLOCKED_BY_REGIME", eligible: false, rationale, evidence: null };
  }
  const evidence = performanceGate(strategyStats[candidate]);
  const implemented = ["LIQUIDITY_RECLAIM", "TREND_FOLLOWING", "MEAN_REVERSION"].includes(candidate);
  return {
    candidate,
    status: !implemented ? "RESEARCH_ONLY_NOT_IMPLEMENTED" : evidence.passed ? "PAPER_ELIGIBLE" : "BLOCKED_BY_EVIDENCE",
    eligible: implemented && evidence.passed,
    rationale,
    implementation: implemented ? "Deterministic candidate engine implemented; paper eligibility still requires verified out-of-sample evidence." : "No entry engine is implemented.",
    evidence
  };
}

module.exports = {
  selectAdaptiveStrategy,
  performanceGate,
  ADAPTIVE_STRATEGY_GATES: {
    MIN_TOTAL_TRADES, MIN_HOLDOUT_TRADES, MIN_EXPECTANCY_R,
    MIN_PROFIT_FACTOR, MAX_DRAWDOWN_R, MAX_CONSECUTIVE_LOSSES
  }
};
