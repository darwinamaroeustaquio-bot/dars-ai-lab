const assert = require("node:assert/strict");
const { CANDIDATES, MIN_ENTRY_SCORE, analyzeSevenCandidatePool } = require("../lib/dars-seven-candidate-paper");
assert.equal(MIN_ENTRY_SCORE, 60, "paper entries must require a 60 percent strategy score");

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
assert.ok(Math.abs(result.setup.entry-result.setup.stopLoss-1)<1e-8);
assert.ok(Math.abs(result.setup.takeProfit2-result.setup.entry-1.5)<1e-8);


const weakButNotPausedForward = Array.from({length:10}, (_,i)=>({
  strategyId:"WILLIAMS_REVERSION-STRICT-V2", status:"CLOSED",
  netR:i%2===0?1.01:-1,
  openedAt:new Date(Date.now()-((10-i)*300000)).toISOString()
}));
const belowGate = analyzeSevenCandidatePool({frames,quote:{bid:100,ask:100.1},paperTrades:weakButNotPausedForward});
const weakRow = belowGate.board.find(x=>x.strategy==="WILLIAMS_REVERSION-STRICT-V2");
assert.equal(weakRow.detected,true,"the signal can exist while failing the score gate");
assert.ok(weakRow.score<MIN_ENTRY_SCORE,"forward evidence should lower the score below the entry gate");
assert.equal(weakRow.paused,false,"the test candidate remains inside the independent forward risk guard");
assert.equal(weakRow.eligible,false,"a score below 60 must not be entry eligible");
assert.equal(belowGate.setup,null,"no paper entry may open below the minimum score");
assert.match(belowGate.selection.rationale,/60% minimum/);
const manualBelowGate = analyzeSevenCandidatePool({
  frames,quote:{bid:100,ask:100.1},paperTrades:weakButNotPausedForward,
  preferredCandidateId:"WILLIAMS_REVERSION-STRICT-V2"
});
assert.equal(manualBelowGate.setup,null,"manual selection must not bypass the score gate");
assert.equal(manualBelowGate.selection.status,"MANUAL_NO_SIGNAL");
const trendResult=analyzeSevenCandidatePool({frames:{...frames,M5:{...frame,regime:"TRENDING"}},quote:{bid:100,ask:100.1},paperTrades:[]});
assert.equal(trendResult.selection.candidate,"NO_TRADE","reversion strategies must stand aside in a trend");
assert.equal(trendResult.setup,null);

console.log("DARS seven-candidate paper tests passed.");
