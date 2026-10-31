// DARS MT5 execution interlock — FOUNDATION ONLY.
// This endpoint intentionally cannot enable live trading in this release.
// A later, separately reviewed release must add authenticated order intents,
// server-side approval state, idempotency and broker-side risk validation.
module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET, OPTIONS");
    return res.status(405).json({ ok: false, error: "GET only" });
  }
  return res.status(200).json({
    ok: true,
    component: "DARS_MT5_EXECUTION_BRIDGE",
    stage: "FOUNDATION_ONLY",
    connected: true,
    paper_enabled: false,
    live_enabled: false,
    emergency_stop: true,
    order_submission_enabled: false,
    reason: "Live execution is locked pending complete implementation, demo validation and explicit user approval."
  });
};
