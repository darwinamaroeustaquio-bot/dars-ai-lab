// DARS Omniscient read-only analysis endpoint. No broker order methods.
const { analyzeDarsMarket } = require("../lib/dars-omniscient");
const { summarizeByStrategy, scoreCandidates } = require("../lib/dars-paper-research");
const { buildCandidates } = require("../lib/dars-strategy-engines");

async function loadVerifiedStrategyStats() {
  const root = String(process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "").replace(/\/rest\/v1$/i, "");
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!root || !key) return { trades: [], stats: {} };
  try {
    const query = new URLSearchParams({ select: "strategy,status,closed_at,net_r,features", symbol: "eq.XAUUSD-STD", order: "closed_at.asc", limit: "2000" });
    const response = await fetch(root + "/rest/v1/dars_paper_trades?" + query, { headers: { apikey: key, Authorization: "Bearer " + key } });
    if (!response.ok) return { trades: [], stats: {} };
    const trades = await response.json();
    return { trades, stats: summarizeByStrategy(trades) };
  } catch (_) { return { trades: [], stats: {} }; }
}

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "POST only" });
  }
  const body = req.body || {};
  if (!body || typeof body !== "object" || !body.quote || !body.frames || typeof body.frames !== "object") {
    return res.status(400).json({ ok: false, error: "Expected symbol, quote and frames." });
  }
  for (const [tf, candles] of Object.entries(body.frames)) {
    if (!["M5", "M15", "H1"].includes(tf) || !Array.isArray(candles) || candles.length > 200) {
      return res.status(400).json({ ok: false, error: "Only M5, M15 and H1 arrays of up to 200 candles are accepted." });
    }
  }
  try {
    const research = await loadVerifiedStrategyStats();
    const input = { symbol: body.symbol, quote: body.quote, frames: body.frames, now: Date.now() };
    const first = analyzeDarsMarket({ ...input, strategyStats: research.stats });
    const candidates = buildCandidates({ frames: first.frames, quote: body.quote });
    scoreCandidates(research.trades, candidates, research.stats);
    const analysis = analyzeDarsMarket({ ...input, strategyStats: research.stats });
    return res.status(200).json({ ok: true, analysis });
  } catch (_) {
    return res.status(500).json({ ok: false, error: "DARS analysis failed safely. No setup was generated." });
  }
};
