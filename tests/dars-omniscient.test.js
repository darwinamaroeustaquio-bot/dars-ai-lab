const assert = require("node:assert/strict");
const { analyzeDarsMarket } = require("../lib/dars-omniscient");

const now = Date.now();
const result = analyzeDarsMarket({ now, symbol: "XAUUSD-STD", quote: { bid: 4000, ask: 4000.2, received_at: new Date(now).toISOString() }, frames: {} });
assert.equal(result.decision, "WAIT");
assert.ok(result.diagnostics.some(x => /Missing M5/.test(x)));

const stale = analyzeDarsMarket({ now, symbol: "XAUUSD-STD", quote: { bid: 4000, ask: 4000.2, received_at: new Date(now - 60_000).toISOString() }, frames: {} });
assert.equal(stale.decision, "WAIT");
assert.ok(stale.diagnostics.some(x => /stale/.test(x)));

const wrongSymbol = analyzeDarsMarket({ now, symbol: "GOLD", quote: { bid: 4000, ask: 4000.2, received_at: new Date(now).toISOString() }, frames: {} });
assert.equal(wrongSymbol.decision, "WAIT");
assert.ok(wrongSymbol.diagnostics.some(x => /Only the configured/.test(x)));
console.log("DARS Omniscient core safety tests passed.");
