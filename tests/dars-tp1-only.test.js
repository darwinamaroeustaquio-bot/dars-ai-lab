const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const api = fs.readFileSync(path.join(root, "api", "dars-omniscient.js"), "utf8");
const dashboard = fs.readFileSync(path.join(root, "index.html"), "utf8");

assert.ok(api.includes('base.engineStatus !== "SCANNED"'), "Only a blocked engine/data status should stop the candidate scan.");
assert.ok(api.includes('decision: "CLOSE_AT_TP1"'), "TP1 hit must request a full manual close.");
assert.ok(api.includes('targetPolicy: "TP1_ONLY_CLOSE_FULL_POSITION"'), "The API must declare TP1-only management.");
assert.ok(!api.includes("mt5_demo_execution_commands"), "The read-only analysis endpoint must not enqueue broker execution commands.");
assert.ok(!api.includes("HOLD_REMAINDER_TO_TP2"), "TP2 continuation logic must not return.");

assert.ok(dashboard.includes('<option value="XAUUSD-STD" selected>'), "Gold STD must be the selected dashboard symbol.");
assert.ok(!dashboard.includes("XAUUSD-VIP"), "Main dashboard feeds must not silently switch back to VIP.");
assert.ok(dashboard.includes('id="omniTP1Status"'), "The dashboard must show TP1 status.");
assert.ok(!dashboard.includes('id="omniTP2"'), "The main DARS dashboard must not display a TP2 target.");
assert.ok(dashboard.includes("state.completedSetup={...active,status:management.status}"), "Completed TP1/SL status must remain visible after the active monitor clears.");

console.log("DARS TP1-only, Gold STD, manual-execution and analysis-gate tests passed.");
