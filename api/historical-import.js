// Import public Dukascopy historical XAUUSD candles into Supabase.
// Research data only; this is not VT Markets broker data and never sends orders.
const { getHistoricalRates } = require("dukascopy-node");
const TF = { M5: "m5", M15: "m15", H1: "h1" };
function send(res, status, body) {
  res.status(status);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  return res.json(body);
}
function normalizeRate(x) {
  // dukascopy-node JSON rows are objects; tolerate its documented array output too.
  const timestamp = Array.isArray(x) ? x[0] : x && x.timestamp;
  const open = Array.isArray(x) ? x[1] : x && x.open;
  const high = Array.isArray(x) ? x[2] : x && x.high;
  const low = Array.isArray(x) ? x[3] : x && x.low;
  const close = Array.isArray(x) ? x[4] : x && x.close;
  const volume = Array.isArray(x) ? x[5] : x && x.volume;
  if (!Number.isFinite(Number(timestamp)) ||
      ![open, high, low, close].every(v => Number.isFinite(Number(v)))) return null;
  return { timestamp: Number(timestamp), open: Number(open), high: Number(high),
    low: Number(low), close: Number(close), volume: Number(volume) || 0 };
}
module.exports = async (req, res) => {
  if (req.method !== "POST") return send(res, 405, { ok: false, error: "POST only" });
  const root = String(process.env.SUPABASE_URL || "").trim().replace(/\\/+$/, "").replace(/\\/rest\\/v1$/i, "");
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!root || !key) return send(res, 503, { ok: false, error: "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel first." });
  const body = req.body || {};
  const timeframe = String(body.timeframe || "M5").toUpperCase();
  if (!TF[timeframe]) return send(res, 400, { ok: false, error: "Use M5, M15 or H1." });

  const now = new Date();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const daysByTimeframe = { M5: 30, M15: 60, H1: 180 };
  const days = daysByTimeframe[timeframe];
  const start = new Date(end.getTime() - days * 86400000);

  try {
    const rates = await getHistoricalRates({
      instrument: "xauusd",
      dates: { from: start, to: end },
      timeframe: TF[timeframe],
      format: "json",
      priceType: "bid",
      // Retry empty/failed daily artifacts; the old zero-retry default could silently
      // leave large gaps and result in too few candles for the screening minimum.
      batchSize: 3,
      pauseBetweenBatchesMs: 500,
      retryCount: 4,
      retryOnEmpty: true,
      pauseBetweenRetriesMs: 750,
      failAfterRetryCount: true
    });
    if (!Array.isArray(rates) || !rates.length) {
      return send(res, 502, { ok: false, error: "Dukascopy returned no historical candles for this range. Retry later or check Vercel function logs.", timeframe, days });
    }

    const byTime = new Map();
    for (const rate of rates) {
      const x = normalizeRate(rate);
      if (!x) continue;
      byTime.set(x.timestamp, {
        symbol: "XAUUSD-STD", timeframe, bar_time: new Date(x.timestamp).toISOString(),
        open: x.open, high: x.high, low: x.low, close: x.close,
        tick_volume: Math.max(0, Math.trunc(x.volume)), received_at: new Date().toISOString()
      });
    }
    const rows = [...byTime.values()].sort((a, b) => a.bar_time.localeCompare(b.bar_time));
    if (rows.length < 250) {
      return send(res, 502, {
        ok: false,
        error: "Dukascopy returned only " + rows.length + " valid candles for " + timeframe + " across " + days + " days after retries. Nothing was saved. Check the instrument/data provider or Vercel logs; the importer will not report success below 250.",
        downloadedRaw: rates.length, validUniqueCandles: rows.length, timeframe, days,
        from: start.toISOString(), to: end.toISOString()
      });
    }

    let saved = 0;
    for (let i = 0; i < rows.length; i += 300) {
      const batch = rows.slice(i, i + 300);
      const upstream = await fetch(root + "/rest/v1/mt5_candles?on_conflict=symbol,timeframe,bar_time", {
        method: "POST",
        headers: {
          apikey: key, Authorization: "Bearer " + key,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates,return=minimal"
        },
        body: JSON.stringify(batch)
      });
      if (!upstream.ok) {
        const detail = (await upstream.text()).slice(0, 350);
        return send(res, 502, {
          ok: false, error: "Downloaded historical data but Supabase save failed.",
          upstream_status: upstream.status, detail, saved_before_error: saved,
          downloaded: rows.length, timeframe
        });
      }
      saved += batch.length;
    }
    return send(res, 200, {
      ok: true, source: "Dukascopy historical XAUUSD BID candles",
      symbol: "XAUUSD-STD", timeframe, days,
      from: start.toISOString(), to: end.toISOString(),
      downloaded: rows.length, saved, minimumRequired: 250, meetsMinimum: saved >= 250,
      message: "Historical candles saved. This is proxy XAUUSD history, not VT Markets broker-specific pricing; validate later against VT Markets."
    });
  } catch (e) {
    return send(res, 502, {
      ok: false, error: "Historical import failed after retry attempts. Check Vercel function logs and try again later.",
      detail: String(e && e.message || e).slice(0, 300), timeframe, days
    });
  }
};