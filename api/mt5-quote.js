// Read-only MT5 quote bridge. Secrets stay in Vercel environment variables.
const ALLOWED = new Set(["XAUUSD-STD", "XAUUSD", "EURUSD", "GBPUSD", "BTCUSD"]);

function send(res, status, body) {
  res.status(status);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Bridge-Token");
  return res.json(body);
}

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return send(res, 204, {});
  // Accept either the Supabase project URL or a URL ending in /rest/v1.
  // Normalize to the project root because this API appends /rest/v1 below.
  const supabaseUrl = String(process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "").replace(/\/rest\/v1$/i, "");
  const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!supabaseUrl || !serviceKey) return send(res, 503, { ok: false, error: "Server setup incomplete: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel." });

  if (req.method === "POST") {
    const expected = String(process.env.MT5_BRIDGE_TOKEN || "");
    const provided = String(req.headers["x-bridge-token"] || "");
    if (!expected || provided.length !== expected.length || provided !== expected) {
      return send(res, 401, { ok: false, error: "Unauthorized bridge token." });
    }
    const body = req.body || {};
    const symbol = String(body.symbol || "");
    const bid = Number(body.bid), ask = Number(body.ask), last = Number(body.last || 0);
    const digits = Number(body.digits), spread = Number(body.spread || 0);
    if (!ALLOWED.has(symbol) || !Number.isFinite(bid) || !Number.isFinite(ask) || bid <= 0 || ask <= 0 || ask < bid) {
      return send(res, 400, { ok: false, error: "Invalid symbol or quote values." });
    }
    const quote = { symbol, bid, ask, last, digits: Number.isFinite(digits) ? digits : null, spread: Number.isFinite(spread) ? spread : null, received_at: new Date().toISOString() };
    const url = supabaseUrl + "/rest/v1/mt5_quotes?on_conflict=symbol";
    try {
      const upstream = await fetch(url, {
        method: "POST",
        headers: { apikey: serviceKey, Authorization: "Bearer " + serviceKey, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify([quote])
      });
      if (!upstream.ok) {
        return send(res, 502, { ok: false, error: "Quote storage failed. Check the mt5_quotes table, Supabase URL, and service-role key.", upstream_status: upstream.status });
      }
      return send(res, 200, { ok: true, symbol, received_at: quote.received_at });
    } catch (_) {
      return send(res, 502, { ok: false, error: "Could not reach quote storage." });
    }
  }

  if (req.method === "GET") {
    const symbol = String(req.query.symbol || "XAUUSD-STD");
    if (!ALLOWED.has(symbol)) return send(res, 400, { ok: false, error: "Unsupported symbol." });
    try {
      const url = supabaseUrl + "/rest/v1/mt5_quotes?select=symbol,bid,ask,last,digits,spread,received_at&symbol=eq." + encodeURIComponent(symbol) + "&limit=1";
      const upstream = await fetch(url, { headers: { apikey: serviceKey, Authorization: "Bearer " + serviceKey } });
      if (!upstream.ok) {
        return send(res, 502, { ok: false, error: "Could not read quote storage. Check the mt5_quotes table, Supabase URL, and service-role key.", upstream_status: upstream.status });
      }
      const rows = await upstream.json();
      if (!rows.length) return send(res, 200, { ok: true, connected: false, symbol, message: "No MT5 quote received yet." });
      const quote = rows[0];
      const ageSeconds = Math.max(0, (Date.now() - new Date(quote.received_at).getTime()) / 1000);
      return send(res, 200, { ok: true, connected: ageSeconds <= 20, age_seconds: Math.round(ageSeconds), quote });
    } catch (_) {
      return send(res, 502, { ok: false, error: "Could not reach quote storage." });
    }
  }
  res.setHeader("Allow", "GET, POST, OPTIONS");
  return send(res, 405, { ok: false, error: "Method not allowed." });
};
