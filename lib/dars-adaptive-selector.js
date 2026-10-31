/** DARS adaptive selector: regime-aware, evidence-weighted strategy allocation. */
const MIN_HOLDOUT_TRADES=30,MIN_TOTAL_TRADES=100,MIN_EXPECTANCY_R=.02,MIN_PROFIT_FACTOR=1.10,MAX_DRAWDOWN_R=6,MAX_CONSECUTIVE_LOSSES=4;
const REGIME_PREFERENCE={
  LIQUIDITY:["LIQUIDITY_RECLAIM","SUPPORT_RESISTANCE","RSI_DIVERGENCE"],
  TREND:["TREND_FOLLOWING","BREAKOUT_RETEST","PULLBACK","MTF_CONFLUENCE","MOMENTUM","BREAKOUT","SESSION_BREAKOUT","VOLATILITY_EXPANSION","LIQUIDITY_RECLAIM"],
  RANGE:["MEAN_REVERSION","STOCHASTIC_REVERSION","CCI_REVERSION","WILLIAMS_REVERSION","SUPPORT_RESISTANCE","RSI_DIVERGENCE"]
};
function finiteNumber(v){return typeof v==="number"&&Number.isFinite(v);}
function clamp(v,min,max){return Math.max(min,Math.min(max,v));}
function performanceGate(stats={}){
 const required=["totalTrades","holdoutTrades","expectancyR","profitFactor","maxDrawdownR","consecutiveLosses"];
 const missing=required.filter(k=>!finiteNumber(stats[k]));
 if(missing.length)return{passed:false,reason:"Insufficient verified strategy journal metrics: "+missing.join(", ")};
 if(stats.totalTrades<MIN_TOTAL_TRADES)return{passed:false,reason:"Needs at least "+MIN_TOTAL_TRADES+" closed paper trades."};
 if(stats.holdoutTrades<MIN_HOLDOUT_TRADES)return{passed:false,reason:"Needs at least "+MIN_HOLDOUT_TRADES+" untouched chronological holdout trades."};
 if(stats.expectancyR<MIN_EXPECTANCY_R)return{passed:false,reason:"Holdout expectancy is not sufficiently positive."};
 if(stats.profitFactor<MIN_PROFIT_FACTOR)return{passed:false,reason:"Holdout profit factor is below the minimum."};
 if(stats.maxDrawdownR>MAX_DRAWDOWN_R)return{passed:false,reason:"Holdout drawdown exceeds the configured evidence limit."};
 if(stats.consecutiveLosses>MAX_CONSECUTIVE_LOSSES)return{passed:false,reason:"Recent loss streak exceeds the safety limit."};
 if(stats.model?.validated!==true)return{passed:false,reason:"Outcome-learning model has not passed chronological holdout validation."};
 if(!finiteNumber(stats.model.winProbability)||stats.model.winProbability<.55)return{passed:false,reason:"ML-estimated win probability is below the 55% research threshold."};
 return{passed:true,reason:"Paper performance and outcome-learning holdout gates passed."};
}
function familyFor({regime,sweepLow,sweepHigh}){
 if(sweepLow||sweepHigh)return"LIQUIDITY";
 if(regime==="HIGH_VOLATILITY")return"NONE";
 if(regime==="TRENDING")return"TREND";
 if(regime==="RANGE_OR_TRANSITION")return"RANGE";
 return"NONE";
}
/**
 * Score is a research allocation weight, not a probability or promise of profit.
 * Recent results can move a strategy up/down, but never bypass the evidence gate.
 */
function adaptiveScore(strategy,stats={},preferenceIndex=0){
 const total=finiteNumber(stats.totalTrades)?stats.totalTrades:0;
 const sampleConfidence=total/(total+50);
 const expectancy=finiteNumber(stats.expectancyR)?clamp(stats.expectancyR,-.5,.5):0;
 const recent=finiteNumber(stats.recentExpectancyR)?clamp(stats.recentExpectancyR,-.5,.5):0;
 const pf=finiteNumber(stats.profitFactor)?clamp(Math.log(Math.max(.25,stats.profitFactor)),-1,1):0;
 const recentPf=finiteNumber(stats.recentProfitFactor)?clamp(Math.log(Math.max(.25,stats.recentProfitFactor)),-1,1):0;
 const dd=finiteNumber(stats.maxDrawdownR)?clamp(stats.maxDrawdownR,0,12):0;
 const streak=finiteNumber(stats.consecutiveLosses)?clamp(stats.consecutiveLosses,0,8):0;
 const model=stats.model||{};
 const modelEdge=finiteNumber(model.winProbability)?clamp(model.winProbability-.5,-.25,.25):0;
 const score=2.0 + (1-sampleConfidence)*.25 + sampleConfidence*(expectancy*2+pf*.35+recent*.8+recentPf*.2+modelEdge*.8-dd*.035-streak*.045) - preferenceIndex*.025;
 return Number(score.toFixed(5));
}
function rankCandidates(pool,preference){
 const ranked=pool.map(x=>({...x,score:adaptiveScore(x.strategy,x.stats,Math.max(0,preference.indexOf(x.strategy)))}))
  .sort((a,b)=>b.score-a.score||preference.indexOf(a.strategy)-preference.indexOf(b.strategy));
 const max=ranked.length?ranked[0].score:0;
 const raw=ranked.map(x=>Math.exp(clamp((x.score-max)*2,-20,0)));
 const total=raw.reduce((a,b)=>a+b,0)||1;
 return ranked.map((x,i)=>({strategy:x.strategy,score:x.score,weight:Number((raw[i]/total).toFixed(4)),eligible:x.gate.passed,totalTrades:x.stats.totalTrades||0,holdoutTrades:x.stats.holdoutTrades||0,expectancyR:x.stats.expectancyR??null,recentExpectancyR:x.stats.recentExpectancyR??null,profitFactor:x.stats.profitFactor??null,reason:x.gate.reason}));
}
function selectAdaptiveStrategy({regime,trend,sweepLow,sweepHigh,strategyStats={},candidates}={}){
 const family=familyFor({regime,sweepLow,sweepHigh});
 if(family==="NONE")return{candidate:"NO_TRADE",status:"BLOCKED_BY_REGIME",eligible:false,rationale:regime==="HIGH_VOLATILITY"?"Elevated volatility: protect capital and wait.":"Market regime is not sufficiently clear.",evidence:null,strategyRanking:[],adaptation:"No strategy allocation in an unsafe or unclassified regime."};
 const preference=REGIME_PREFERENCE[family];
 const hasCandidateList=Array.isArray(candidates);
 const matching=hasCandidateList?candidates.filter(c=>preference.includes(c.strategy)):null;
 if(hasCandidateList&&matching.length===0){
  return{candidate:preference[0],status:"NO_SETUP",eligible:false,rationale:"Market regime identified, but no closed-candle setup is currently present for the matching strategy family.",evidence:null,strategyRanking:[],adaptation:"Continue scanning all engines; no matching setup exists on the latest closed candle."};
 }
 const pool=hasCandidateList?matching.map(c=>({strategy:c.strategy,setup:c,gate:performanceGate(strategyStats[c.strategy]),stats:strategyStats[c.strategy]||{}})):
  [{strategy:preference[0],setup:null,gate:performanceGate(strategyStats[preference[0]]),stats:strategyStats[preference[0]]||{}}];
 const ranked=rankCandidates(pool,preference);
 const eligible=pool.filter(x=>x.gate.passed);
 const chosenPool=eligible.length?eligible:pool;
 const chosen=chosenPool.slice().sort((a,b)=>adaptiveScore(b.strategy,b.stats,preference.indexOf(b.strategy))-adaptiveScore(a.strategy,a.stats,preference.indexOf(a.strategy))||preference.indexOf(a.strategy)-preference.indexOf(b.strategy))[0];
 const rationale=family==="LIQUIDITY"?"Liquidity sweep/reclaim conditions detected; dynamically rank matching liquidity strategies.":
  family==="TREND"?"Directional market detected; dynamically rank trend, breakout and momentum candidates.":
  "Range/transition market detected; dynamically rank reversal and oscillator candidates.";
 return{
  candidate:chosen.strategy,status:chosen.gate.passed?"PAPER_ELIGIBLE":"BLOCKED_BY_EVIDENCE",
  eligible:chosen.gate.passed,rationale,implementation:"All 15 deterministic engines continue in shadow research. Current regime candidates are dynamically ranked using verified holdout edge, recent performance, sample confidence, drawdown and loss streak. Only evidence-qualified candidates can become active paper setups.",
  evidence:chosen.gate,model:chosen.stats.model||null,selectedSetup:chosen.setup||null,
  evaluatedCandidates:pool.length,strategyRanking:ranked,
  adaptation:eligible.length?"Qualified strategies are re-ranked on each sync; recent performance changes allocation weights, subject to fixed evidence and safety gates.":"Exploration continues in shadow paper mode. No candidate has earned active-paper qualification; ranking is informational and cannot bypass the evidence gate."
 };
}
module.exports={selectAdaptiveStrategy,performanceGate,adaptiveScore,ADAPTIVE_STRATEGY_GATES:{MIN_TOTAL_TRADES,MIN_HOLDOUT_TRADES,MIN_EXPECTANCY_R,MIN_PROFIT_FACTOR,MAX_DRAWDOWN_R,MAX_CONSECUTIVE_LOSSES},STRATEGY_FAMILIES:REGIME_PREFERENCE};
