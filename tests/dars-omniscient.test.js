const assert = require("node:assert/strict");
const { analyzeDarsMarket } = require("../lib/dars-omniscient");

const now = Date.now();
const freshQuote = { bid: 4000, ask: 4000.2, received_at: new Date(now).toISOString() };
const empty = analyzeDarsMarket({ now, symbol: "XAUUSD-STD", quote: freshQuote, frames: {} });
assert.equal(empty.decision, "WAIT");
assert.ok(empty.diagnostics.some(x => /Missing M5/.test(x)));

const stale = analyzeDarsMarket({ now, symbol: "XAUUSD-STD", quote: { ...freshQuote, received_at: new Date(now - 60_000).toISOString() }, frames: {} });
assert.equal(stale.decision, "WAIT");
assert.ok(stale.diagnostics.some(x => /stale/.test(x)));

const wrongSymbol = analyzeDarsMarket({ now, symbol: "GOLD", quote: freshQuote, frames: {} });
assert.equal(wrongSymbol.decision, "WAIT");
assert.ok(wrongSymbol.diagnostics.some(x => /Only the configured/.test(x)));

function candles(tfMs, count = 70) {
  return Array.from({ length: count }, (_, i) => {
    const close = 3900 + i * 0.5;
    return {
      bar_time: new Date(now - (count - i) * tfMs - 1000).toISOString(),
      open: close - 0.2, high: close + 0.4, low: close - 0.5, close
    };
  });
}
const frames = { M5: candles(300_000), M15: candles(900_000), H1: candles(3_600_000) };
// Add an unfinished current M5 candle. The engine must ignore it.
frames.M5.push({ bar_time: new Date(now - 30_000).toISOString(), open: 4000, high: 4001, low: 3999, close: 4000.5 });
const validHistory = analyzeDarsMarket({ now, symbol: "XAUUSD-STD", quote: freshQuote, frames });
assert.equal(validHistory.frames.M5.ok, true);
assert.equal(validHistory.frames.M5.count, 70);
assert.equal(validHistory.decision, "WAIT"); // no sweep/reclaim: no forced entry
console.log("DARS Omniscient core safety tests passed.");


const fs = require("node:fs");
const path = require("node:path");
const dashboard = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
assert.equal(dashboard.split("<style").length - 1, dashboard.split("</style>").length - 1,
  "Dashboard stylesheet tags must be balanced.");
assert.ok(dashboard.includes('id="omniscientDashboard"'), "Omniscient dashboard must be present.");
assert.ok(dashboard.includes('id="darsOmniscientRuntime"'), "Omniscient runtime must be present.");
assert.ok(dashboard.includes("/api/dars-omniscient"), "Dashboard must call the authoritative analysis endpoint.");
assert.ok(dashboard.includes("/api/mt5-candles"), "Dashboard must use the MT5 candle feed.");
console.log("DARS dashboard integration smoke tests passed.");
