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

module.exports = { TIMEFRAME_MS, filterClosedCandles };
