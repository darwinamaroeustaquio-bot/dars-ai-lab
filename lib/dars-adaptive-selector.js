/** DARS adaptive strategy selector: deterministic regime choice plus verified paper/ML evidence. */
const MIN_HOLDOUT_TRADES=30,MIN_TOTAL_TRADES=100,MIN_EXPECTANCY_R=.02,MIN_PROFIT_FACTOR=1.10,MAX_DRAWDOWN_R=6,MAX_CONSECUTIVE_LOSSES=4;
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
function selectAdaptiveStrategy({regime,trend,sweepLow,sweepHigh,strategyStats={}}={}){
 let candidate,rationale;
 if(regime==="HIGH_VOLATILITY"){candidate="NO_TRADE";rationale="Elevated volatility: protect capital and wait.";}
 else if(sweepLow||sweepHigh){candidate="LIQUIDITY_RECLAIM";rationale="A closed-candle liquidity sweep/reclaim is present.";}
 else if(regime==="TRENDING"&&(trend==="BULLISH"||trend==="BEARISH")){candidate="TREND_FOLLOWING";rationale="Directional regime detected; trend-following is the research candidate.";}
 else if(regime==="RANGE_OR_TRANSITION"||trend==="MIXED"){candidate="MEAN_REVERSION";rationale="Range/transition regime detected; mean-reversion is the research candidate.";}
 else{candidate="NO_TRADE";rationale="Market regime is not sufficiently clear.";}
 if(candidate==="NO_TRADE")return{candidate,status:"BLOCKED_BY_REGIME",eligible:false,rationale,evidence:null};
 const evidence=performanceGate(strategyStats[candidate]);
 return{candidate,status:evidence.passed?"PAPER_ELIGIBLE":"BLOCKED_BY_EVIDENCE",eligible:evidence.passed,rationale,implementation:"Deterministic setup engine implemented; selection remains paper-only and evidence-gated.",evidence,model:strategyStats[candidate]?.model||null};
}
module.exports={selectAdaptiveStrategy,performanceGate,ADAPTIVE_STRATEGY_GATES:{MIN_TOTAL_TRADES,MIN_HOLDOUT_TRADES,MIN_EXPECTANCY_R,MIN_PROFIT_FACTOR,MAX_DRAWDOWN_R,MAX_CONSECUTIVE_LOSSES}};
