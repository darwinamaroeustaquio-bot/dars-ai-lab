export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "POST only" });
  }

  const expected = process.env.MT5_BRIDGE_TOKEN;
  const supplied = req.headers["x-bridge-token"];
  if (!expected || !supplied || supplied !== expected) {
    return res.status(401).json({ ok: false, error: "Unauthorized bridge token" });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ ok: false, error: "Missing Supabase environment variables" });
  }

  const body = req.body || {};
  if (body.version !== 1 || !Array.isArray(body.candles) || !Array.isArray(body.deals)) {
    return res.status(400).json({ ok: false, error: "Expected version:1, candles:[], deals:[]" });
  }
  if (body.candles.length > 500 || body.deals.length > 1000) {
    return res.status(413).json({ ok: false, error: "Batch too large" });
  }

  const account = String(body.account || "unknown");
  const symbol = String(body.symbol || "unknown").slice(0, 32);
  const timeframe = String(body.timeframe || "unknown").slice(0, 8);
  const rows = [
    ...body.candles.map(c => ({
      account, record_type: "candle", symbol: String(c.symbol || symbol),
      timeframe: String(c.timeframe || timeframe), record_time: c.time,
      payload: c
    })),
    ...body.deals.map(d => ({
      account, record_type: "deal", symbol: String(d.symbol || symbol),
      timeframe: null, record_time: d.time, payload: d
    }))
  ];
  if (!rows.length) return res.status(200).json({ ok: true, inserted: 0 });

  const endpoint = supabaseUrl.replace(/\/$/, "") + "/rest/v1/mt5_history";
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: "Bearer " + serviceKey,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal"
    },
    body: JSON.stringify(rows)
  });
  if (!response.ok) {
    const detail = await response.text();
    return res.status(502).json({ ok: false, error: "Supabase insert failed", detail: detail.slice(0, 500) });
  }
  return res.status(200).json({ ok: true, inserted: rows.length, account, symbol });
}
