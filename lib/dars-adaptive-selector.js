/** DARS adaptive selector: choose among current candidates using regime fit and verified paper evidence. */
const MIN_HOLDOUT_TRADES=30,MIN_TOTAL_TRADES=100,MIN_EXPECTANCY_R=.02,MIN_PROFIT_FACTOR=1.10,MAX_DRAWDOWN_R=6,MAX_CONSECUTIVE_LOSSES=4;
const REGIME_PREFERENCE={
  LIQUIDITY:["LIQUIDITY_RECLAIM","SUPPORT_RESISTANCE","RSI_DIVERGENCE"],
  TREND:["TREND_FOLLOWING","BREAKOUT_RETEST","PULLBACK","MTF_CONFLUENCE","MOMENTUM","BREAKOUT","SESSION_BREAKOUT","VOLATILITY_EXPANSION","LIQUIDITY_RECLAIM"],
  RANGE:["MEAN_REVERSION","STOCHASTIC_REVERSION","CCI_REVERSION","WILLIAMS_REVERSION","SUPPORT_RESISTANCE","RSI_DIVERGENCE"]
};
function finiteNumber(v){return typeof v==="number"&&Number.isFinite(v);}
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
function selectAdaptiveStrategy({regime,trend,sweepLow,sweepHigh,strategyStats={},candidates}={}){
 const family=familyFor({regime,sweepLow,sweepHigh});
 if(family==="NONE")return{candidate:"NO_TRADE",status:"BLOCKED_BY_REGIME",eligible:false,rationale:regime==="HIGH_VOLATILITY"?"Elevated volatility: protect capital and wait.":"Market regime is not sufficiently clear.",evidence:null};
 const preference=REGIME_PREFERENCE[family];
 const hasCandidateList=Array.isArray(candidates);
 const matching=hasCandidateList?candidates.filter(c=>preference.includes(c.strategy)):null;
 if(hasCandidateList&&matching.length===0){
  return{candidate:preference[0],status:"NO_SETUP",eligible:false,rationale:"Market regime identified, but no closed-candle setup is currently present for the matching strategy family.",evidence:null};
 }
 const pool=hasCandidateList?matching.map(c=>({strategy:c.strategy,setup:c,gate:performanceGate(strategyStats[c.strategy]),stats:strategyStats[c.strategy]||{}})):
  [{strategy:preference[0],setup:null,gate:performanceGate(strategyStats[preference[0]]),stats:strategyStats[preference[0]]||{}}];
 const eligible=pool.filter(x=>x.gate.passed);
 const score=x=>{
  const s=x.stats||{},m=s.model||{};
  return (Number(s.expectancyR)||0)*3+Math.log(Math.max(1,Number(s.profitFactor)||1))*.5-
    (Number(s.maxDrawdownR)||0)*.05+(Number(m.winProbability)||0)*.5;
 };
 const chosen=(eligible.length?eligible:pool).slice().sort((a,b)=>{
  if(eligible.length){const diff=score(b)-score(a);if(Math.abs(diff)>1e-9)return diff;}
  return preference.indexOf(a.strategy)-preference.indexOf(b.strategy);
 })[0];
 const rationale=family==="LIQUIDITY"?"Liquidity sweep/reclaim conditions detected; compare matching strategies.":
  family==="TREND"?"Directional market detected; compare trend, breakout and momentum candidates.":
  "Range/transition market detected; compare reversal and oscillator candidates.";
 return{
  candidate:chosen.strategy,status:chosen.gate.passed?"PAPER_ELIGIBLE":"BLOCKED_BY_EVIDENCE",
  eligible:chosen.gate.passed,rationale,implementation:"Fifteen deterministic setup engines are evaluated; only a strategy with validated paper evidence can be selected for active paper mode.",
  evidence:chosen.gate,model:chosen.stats.model||null,
  selectedSetup:chosen.setup||null,
  evaluatedCandidates:pool.length
 };
}
module.exports={selectAdaptiveStrategy,performanceGate,ADAPTIVE_STRATEGY_GATES:{MIN_TOTAL_TRADES,MIN_HOLDOUT_TRADES,MIN_EXPECTANCY_R,MIN_PROFIT_FACTOR,MAX_DRAWDOWN_R,MAX_CONSECUTIVE_LOSSES},STRATEGY_FAMILIES:REGIME_PREFERENCE};
