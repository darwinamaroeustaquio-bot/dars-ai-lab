// DARS Omniscient: verified market analysis, manual execution only.
// TP1 is the sole target. No order commands are created or sent.
const { analyzeDarsMarket } = require("../lib/dars-omniscient");
const { analyzeSevenCandidatePool } = require("../lib/dars-seven-candidate-paper");

function stripTp2(rows) {
  return (Array.isArray(rows) ? rows : []).map(row => {
    const clean = { ...row };
    delete clean.takeProfit2;
    delete clean.rewardRiskTP2;
    return clean;
  });
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "POST only" });
  }
  const body = req.body || {};
  if (!body.quote || !body.frames || typeof body.frames !== "object") {
    return res.status(400).json({ ok: false, error: "Expected symbol, quote and frames." });
  }
  try {
    const base = analyzeDarsMarket({
      symbol: body.symbol, quote: body.quote, frames: body.frames, now: Date.now()
    });
    if (base.diagnostics?.length || !base.frames?.M5?.ok ||
        !base.frames?.M15?.ok || !base.frames?.H1?.ok) {
      base.engine = "DARS_MULTI_SETUP_TP1_ONLY";
      base.strategySelection = {
        candidate: "NO_TRADE", status: "BLOCKED_BY_MARKET_DATA", eligible: false,
        rationale: base.engineBlockReason || "Verified market data is not ready.",
        evaluatedCandidates: 8, strategyRanking: []
      };
      base.engineBoard = [];
      base.decision = "WAIT";
      base.setup = null;
      base.tp1Management = { status: "DATA_NOT_READY", decision: "WAIT", score: null, scoreIsProbability: false };
      return res.status(200).json({ ok: true, analysis: base });
    }

    const result = analyzeSevenCandidatePool({
      frames: base.frames, quote: body.quote,
      paperTrades: Array.isArray(body.paperTrades) ? body.paperTrades.slice(-5000) : [],
      marketBlockReason: base.engineBlockReason || null
    });

    const active = body.activeSetup && ["BUY", "SELL"].includes(body.activeSetup.side)
      ? body.activeSetup : null;
    let tp1Management = {
      status: "NO_ACTIVE_SETUP", decision: "WAIT", score: null,
      scoreIsProbability: false, note: "Waiting for a valid setup."
    };
    if (active) {
      const bid = Number(body.quote.bid), ask = Number(body.quote.ask);
      const tp1 = Number(active.takeProfit1), sl = Number(active.stopLoss);
      const tp1Reached = body.tp1Reached === true ||
        (active.side === "BUY" ? bid >= tp1 : ask <= tp1);
      const slReached = active.side === "BUY" ? bid <= sl : ask >= sl;
      if (slReached) {
        tp1Management = {
          status: "STOP_REACHED", decision: "STOP_LOSS_REACHED", score: null,
          scoreIsProbability: false, note: "Stop level reached. Review and close the manual position."
        };
      } else if (tp1Reached) {
        tp1Management = {
          status: "TP1_HIT", decision: "CLOSE_AT_TP1", score: null,
          scoreIsProbability: false, note: "TP1 reached. Close the full manual position here; there is no TP2."
        };
      } else {
        tp1Management = {
          status: "MONITORING_TO_TP1", decision: "WAIT_FOR_TP1", score: null,
          scoreIsProbability: false, note: "Monitoring the active setup toward its single TP1 target."
        };
      }
    }

    const setup = result.setup ? {
      side: result.setup.side, entry: result.setup.entry, stopLoss: result.setup.stopLoss,
      takeProfit1: result.setup.takeProfit1, riskDistance: result.setup.riskDistance,
      rewardRiskTP1: result.setup.rewardRiskTP1 || 1,
      strategy: result.setup.strategy, strategyId: result.setup.strategyId,
      strategyScore: result.selection?.score ?? null,
      liveFitScore: result.selection?.liveFitScore ?? null,
      family: result.setup.family, profile: result.setup.profile,
      signalBarTime: result.setup.signalBarTime,
      oscillator: result.setup.oscillator, previousOscillator: result.setup.previousOscillator,
      lowerThreshold: result.setup.lowerThreshold, upperThreshold: result.setup.upperThreshold,
      features: { atr: result.setup.atr14, oscillator: result.setup.oscillator },
      source: "Live MT5 quote + verified closed candles; eight-candidate research pool",
      note: result.setup.note, execution: "MANUAL_ONLY",
      targetPolicy: "TP1_ONLY_CLOSE_FULL_POSITION"
    } : null;

    const selection = result.selection ? {
      ...result.selection, strategyRanking: stripTp2(result.selection.strategyRanking)
    } : result.selection;
    const analysis = {
      ...base, engine: "DARS_MULTI_SETUP_TP1_ONLY",
      decision: setup?.side || "WAIT", setup, strategySelection: selection,
      engineBoard: stripTp2(result.board), diagnostics: result.diagnostics || [],
      tp1Management
    };
    return res.status(200).json({ ok: true, analysis });
  } catch (error) {
    return res.status(500).json({
      ok: false, error: "DARS analysis failed safely. No setup or broker order was generated."
    });
  }
};
