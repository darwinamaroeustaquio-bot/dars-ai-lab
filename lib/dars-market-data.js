// Shared MT5 candle-finalization guard for historical research.
// MT5 bridge intentionally uploads the forming bar; backtests must only consume completed bars.
const TIMEFRAME_MS = Object.freeze({ M1: 60_000, M5: 300_000, M15: 900_000, M30: 1_800_000, H1: 3_600_000, H4: 14_400_000 });

function filterClosedCandles(rows, timeframe, now = Date.now()) {
  const duration = TIMEFRAME_MS[String(timeframe || "").toUpperCase()];
  if (!Array.isArray(rows) || !duration) {
    return { candles: [], excludedForming: 0, excludedInvalidTime: Array.isArray(rows) ? rows.length : 0 };
  }
  const candles = [];
  let excludedForming = 0;
  let excludedInvalidTime = 0;
  for (const row of rows) {
    const rawTime = row && (row.bar_time ?? row.time ?? row.timestamp);
    const timeMs = typeof rawTime === "number" ? (rawTime < 1e12 ? rawTime * 1000 : rawTime) : Date.parse(rawTime);
    if (!Number.isFinite(timeMs)) {
      excludedInvalidTime++;
      continue;
    }
    // A bar is closed only when its full timeframe has elapsed.
    if (timeMs + duration > now) {
      excludedForming++;
      continue;
    }
    candles.push({ ...row, timeMs });
  }
  return { candles, excludedForming, excludedInvalidTime };
}

async function readFreshMt5Spread(root, key, symbol = "XAUUSD-STD", now = Date.now()) {
  const query = new URLSearchParams({ select: "bid,ask,received_at", symbol: "eq." + symbol, limit: "1" });
  const response = await fetch(root.replace(/\/+$/, "") + "/rest/v1/mt5_quotes?" + query.toString(), {
    headers: { apikey: key, Authorization: "Bearer " + key }
  });
  if (!response.ok) throw new Error("Could not read the latest MT5 quote for spread benchmark (" + response.status + ").");
  const rows = await response.json();
  if (!Array.isArray(rows) || !rows.length) return { spreadPrice: null, reason: "No MT5 quote is stored." };
  const quote = rows[0], bid = Number(quote.bid), ask = Number(quote.ask), received = Date.parse(quote.received_at);
  if (!(bid > 0 && ask >= bid) || !Number.isFinite(received)) return { spreadPrice: null, reason: "Stored MT5 quote is invalid." };
  const ageMs = now - received;
  if (ageMs < 0 || ageMs > 20_000) return { spreadPrice: null, reason: "Latest MT5 quote is stale.", receivedAt: quote.received_at, ageSeconds: Math.round(ageMs / 1000) };
  return { spreadPrice: ask - bid, receivedAt: quote.received_at, ageSeconds: Math.round(ageMs / 1000), source: "fresh MT5 bid/ask snapshot" };
}

module.exports = { TIMEFRAME_MS, filterClosedCandles, readFreshMt5Spread };
