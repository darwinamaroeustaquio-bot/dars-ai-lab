const assert = require("node:assert/strict");
const { CANDIDATES, analyzeSevenCandidatePool } = require("../lib/dars-seven-candidate-paper");

assert.equal(CANDIDATES.length, 7, "the paper pool must contain exactly seven candidates");
assert.deepEqual(CANDIDATES.map(x=>x.id), [
  "WILLIAMS_REVERSION-STRICT-V2",
  "STOCHASTIC_REVERSION-BASE-V4",
  "WILLIAMS_REVERSION-BASE-V4",
  "WILLIAMS_REVERSION-SENSITIVE-V4",
  "STOCHASTIC_REVERSION-STRICT-V4",
  "WILLIAMS_REVERSION-STRICT-V4",
  "STOCHASTIC_REVERSION-BASE-V2"
]);

const candles=[];
for(let i=0;i<70;i++){
  const close=i===68?96:i===69?98:100+Math.sin(i/3)*1.5;
  candles.push({open:close-.2,high:105,low:95,close,timeMs:Date.now()-(70-i)*300000});
}
const frame={ok:true,candles,atr14:1,regime:"RANGE_OR_TRANSITION",trend:"MIXED"};
const frames={M5:frame,M15:{ok:true,regime:"RANGE_OR_TRANSITION"},H1:{ok:true,regime:"RANGE_OR_TRANSITION"}};
const result=analyzeSevenCandidatePool({frames,quote:{bid:100,ask:100.1},paperTrades:[]});
assert.equal(result.board.length,7,"all seven candidates must be ranked");
assert.equal(result.selection.candidate,"WILLIAMS_REVERSION-STRICT-V2","historical prior leader should lead when candidates signal and no forward data exists");
assert.equal(result.setup.strategyId,"WILLIAMS_REVERSION-STRICT-V2");
assert.equal(result.setup.side,"BUY");
assert.equal(result.setup.maxBars,12);
assert.equal(result.setup.stopMultiple,1);
assert.equal(result.setup.targetR,1.5);
assert.ok(Math.abs(result.setup.stopLoss-result.setup.entry-1)<1e-8);
assert.ok(Math.abs(result.setup.takeProfit2-result.setup.entry-1.5)<1e-8);

const trendResult=analyzeSevenCandidatePool({frames:{...frames,M5:{...frame,regime:"TRENDING"}},quote:{bid:100,ask:100.1},paperTrades:[]});
assert.equal(trendResult.selection.candidate,"NO_TRADE","reversion strategies must stand aside in a trend");
assert.equal(trendResult.setup,null);

console.log("DARS seven-candidate paper tests passed.");
