// DARS Omniscient read-only analysis endpoint. No broker order methods.
const { analyzeDarsMarket } = require("../lib/dars-omniscient");

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
    const analysis = analyzeDarsMarket({
      symbol: body.symbol,
      quote: body.quote,
      frames: body.frames,
      now: Date.now()
    });
    return res.status(200).json({ ok: true, analysis });
  } catch (_) {
    return res.status(500).json({ ok: false, error: "DARS analysis failed safely. No setup was generated." });
  }
};
