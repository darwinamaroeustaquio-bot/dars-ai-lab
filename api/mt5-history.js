// Dars AI Lab MT5 history ingestion.
// Candles are stored in the existing mt5_candles table used by the dashboard.
// Closed deals are stored in mt5_history. Secrets remain server-side.
const ALLOWED = new Set(["XAUUSD-STD", "XAUUSD", "EURUSD", "GBPUSD", "BTCUSD"]);
const FRAMES = new Set(["M5", "M15", "H1"]);

function send(res, status, body) {
  res.status(status);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Bridge-Token");
  return res.status(status).json(body);
}

function asIso(value) {
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value * 1000).toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return send(res, 204, {});
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    return send(res, 405, { ok: false, error: "POST only" });
  }

  const expected = String(process.env.MT5_BRIDGE_TOKEN || "");
  const supplied = String(req.headers["x-bridge-token"] || "");
  if (!expected || supplied.length !== expected.length || supplied !== expected)
    return send(res, 401, { ok: false, error: "Unauthorized bridge token" });

  const root = String(process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "").replace(/\/rest\/v1$/i, "");
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!root || !key) return send(res, 503, { ok: false, error: "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel." });

  const body = req.body || {};
  if (body.version !== 1 || !Array.isArray(body.candles) || !Array.isArray(body.deals))
    return send(res, 400, { ok: false, error: "Expected version:1, candles:[], deals:[]" });
  if (body.candles.length > 4600 || body.deals.length > 300)
    return send(res, 413, { ok: false, error: "Batch too large; maximum 4600 candles and 300 deals per request." });

  const account = String(body.account || "unknown");
  const fallbackSymbol = String(body.symbol || "unknown").slice(0, 32);
  const candles = [];
  for (const c of body.candles) {
    const symbol = String(c.symbol || fallbackSymbol);
    const timeframe = String(c.timeframe || "");
    const bar_time = asIso(c.time);
    const open = Number(c.open), high = Number(c.high), low = Number(c.low), close = Number(c.close);
    const tick_volume = Number(c.tick_volume || 0);
    if (!ALLOWED.has(symbol) || !FRAMES.has(timeframe) || !bar_time ||
        ![open, high, low, close, tick_volume].every(Number.isFinite) ||
        low <= 0 || high < Math.max(open, close, low) || low > Math.min(open, close, high)) {
      return send(res, 400, { ok: false, error: "Invalid candle payload." });
    }
    candles.push({ symbol, timeframe, bar_time, open, high, low, close, tick_volume: Math.max(0, Math.trunc(tick_volume)), source: "mt5_bridge", received_at: new Date().toISOString() });
  }

  const deals = [];
  for (const d of body.deals) {
    const symbol = String(d.symbol || fallbackSymbol);
    const record_time = asIso(d.time);
    if (!record_time || !Number.isFinite(Number(d.ticket)) || !Number.isFinite(Number(d.profit)))
      return send(res, 400, { ok: false, error: "Invalid closed-deal payload." });
    deals.push({
      account, record_type: "deal", symbol, timeframe: "DEAL", record_time,
      payload: { ...d, symbol, time: record_time, account }
    });
  }

  const headers = { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" };
  try {
    if (candles.length) {
      const r = await fetch(root + "/rest/v1/mt5_candles?on_conflict=symbol,timeframe,bar_time", {
        method: "POST", headers, body: JSON.stringify(candles)
      });
      if (!r.ok) return send(res, 502, { ok: false, error: "Saving candles failed. Run sql/mt5_candles.sql and supabase/mt5_candle_source.sql in Supabase.", upstream_status: r.status, detail: (await r.text()).slice(0, 300) });
    }
    if (deals.length) {
      const r = await fetch(root + "/rest/v1/mt5_history?on_conflict=account,record_type,symbol,timeframe,record_time,payload", {
        method: "POST", headers, body: JSON.stringify(deals)
      });
      if (!r.ok) return send(res, 502, { ok: false, error: "Saving closed trades failed. Run supabase/mt5_history.sql in Supabase.", upstream_status: r.status, detail: (await r.text()).slice(0, 300) });
    }
    return send(res, 200, { ok: true, account, candles_saved: candles.length, closed_deals_saved: deals.length, received_at: new Date().toISOString() });
  } catch (_) {
    return send(res, 502, { ok: false, error: "Could not reach Supabase." });
  }
};
