/** DARS adaptive ensemble: retain each engine's champion, then select from the cross-engine consensus. */
const MIN_HOLDOUT_TRADES=30,MIN_TOTAL_TRADES=100,MIN_EXPECTANCY_R=.02,MIN_PROFIT_FACTOR=1.10,MAX_DRAWDOWN_R=6,MAX_CONSECUTIVE_LOSSES=4;
const STRATEGIES=["LIQUIDITY_RECLAIM","TREND_FOLLOWING","MEAN_REVERSION","BREAKOUT","BREAKOUT_RETEST","MOMENTUM","PULLBACK","SUPPORT_RESISTANCE","VOLATILITY_EXPANSION","SESSION_BREAKOUT","RSI_DIVERGENCE","STOCHASTIC_REVERSION","CCI_REVERSION","WILLIAMS_REVERSION","MTF_CONFLUENCE"];
const REGIME_PREFERENCE={
 LIQUIDITY:["LIQUIDITY_RECLAIM","SUPPORT_RESISTANCE","RSI_DIVERGENCE","TREND_FOLLOWING","PULLBACK","MTF_CONFLUENCE","BREAKOUT_RETEST","MEAN_REVERSION","STOCHASTIC_REVERSION","CCI_REVERSION","WILLIAMS_REVERSION","MOMENTUM","BREAKOUT","SESSION_BREAKOUT","VOLATILITY_EXPANSION"],
 TREND:["TREND_FOLLOWING","BREAKOUT_RETEST","PULLBACK","MTF_CONFLUENCE","MOMENTUM","BREAKOUT","SESSION_BREAKOUT","VOLATILITY_EXPANSION","LIQUIDITY_RECLAIM","SUPPORT_RESISTANCE","RSI_DIVERGENCE","MEAN_REVERSION","STOCHASTIC_REVERSION","CCI_REVERSION","WILLIAMS_REVERSION"],
 RANGE:["MEAN_REVERSION","STOCHASTIC_REVERSION","CCI_REVERSION","WILLIAMS_REVERSION","SUPPORT_RESISTANCE","RSI_DIVERGENCE","LIQUIDITY_RECLAIM","PULLBACK","TREND_FOLLOWING","MTF_CONFLUENCE","BREAKOUT_RETEST","MOMENTUM","BREAKOUT","SESSION_BREAKOUT","VOLATILITY_EXPANSION"]
};
function finiteNumber(v){return typeof v==="number"&&Number.isFinite(v);}
function clamp(v,min,max){return Math.max(min,Math.min(max,v));}
function performanceGate(stats={}){
 const required=["totalTrades","holdoutTrades","expectancyR","profitFactor","maxDrawdownR","consecutiveLosses"],missing=required.filter(k=>!finiteNumber(stats[k]));
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
function familyFor({regime,sweepLow,sweepHigh}){if(sweepLow||sweepHigh)return"LIQUIDITY";if(regime==="HIGH_VOLATILITY")return"NONE";if(regime==="TRENDING")return"TREND";if(regime==="RANGE_OR_TRANSITION")return"RANGE";return"NONE";}
function adaptiveScore(strategy,stats={},preferenceIndex=0){
 const total=finiteNumber(stats.totalTrades)?stats.totalTrades:0,confidence=total/(total+50),exp=finiteNumber(stats.expectancyR)?clamp(stats.expectancyR,-.5,.5):0,recent=finiteNumber(stats.recentExpectancyR)?clamp(stats.recentExpectancyR,-.5,.5):0,pf=finiteNumber(stats.profitFactor)?clamp(Math.log(Math.max(.25,stats.profitFactor)),-1,1):0,rpf=finiteNumber(stats.recentProfitFactor)?clamp(Math.log(Math.max(.25,stats.recentProfitFactor)),-1,1):0,dd=finiteNumber(stats.maxDrawdownR)?clamp(stats.maxDrawdownR,0,12):0,streak=finiteNumber(stats.consecutiveLosses)?clamp(stats.consecutiveLosses,0,8):0,model=stats.model||{},edge=finiteNumber(model.winProbability)?clamp(model.winProbability-.5,-.25,.25):0;
 return Number((2+(1-confidence)*.25+confidence*(exp*2+pf*.35+recent*.8+rpf*.2+edge*.8-dd*.035-streak*.045)-preferenceIndex*.025).toFixed(5));
}
function setupQuality(c={}){
 const f=c.features||{},risk=Number(c.riskDistance),spread=Number(f.spread),spreadPenalty=Number.isFinite(risk)&&risk>0&&Number.isFinite(spread)?clamp(spread/risk,0,1)*.45:.2,alignment=Number(f.trendAlignment)===1?.12:0,sweep=Number(f.sweep)===1?.12:0,valid=[c.entry,c.stopLoss,c.takeProfit1,c.takeProfit2].every(v=>finiteNumber(Number(v)));
 return(valid?.35:0)+alignment+sweep-spreadPenalty;
}
function softmaxWeights(items){if(!items.length)return[];const max=Math.max(...items.map(x=>x.score)),raw=items.map(x=>Math.exp(clamp((x.score-max)*2,-20,0))),sum=raw.reduce((a,b)=>a+b,0)||1;return items.map((x,i)=>Number((raw[i]/sum).toFixed(4)));}
function selectAdaptiveStrategy({regime,trend,sweepLow,sweepHigh,strategyStats={},candidates}={}){
 const family=familyFor({regime,sweepLow,sweepHigh});
 if(family==="NONE")return{candidate:"NO_TRADE",status:"BLOCKED_BY_REGIME",eligible:false,rationale:regime==="HIGH_VOLATILITY"?"Elevated volatility: protect capital and wait.":"Market regime is not sufficiently clear.",evidence:null,strategyRanking:[],perEngineChampions:[],ensemble:null,adaptation:"The ensemble is blocked by an unsafe or unclassified regime."};
 const preference=REGIME_PREFERENCE[family];
 if(Array.isArray(candidates)&&!candidates.length)return{candidate:"NO_SETUP",status:"NO_SETUP",eligible:false,rationale:"No engine produced a valid closed-candle setup.",evidence:null,strategyRanking:[],perEngineChampions:[],ensemble:null,adaptation:"All 15 engines remain under observation; none produced a current setup."};
 const source=Array.isArray(candidates)?candidates:[{strategy:preference[0],diagnosticOnly:true}],grouped=new Map();
 for(const c of source){if(!STRATEGIES.includes(c.strategy))continue;const arr=grouped.get(c.strategy)||[];arr.push(c);grouped.set(c.strategy,arr);}
 const champions=[];
 for(const strategy of STRATEGIES){const options=grouped.get(strategy)||[];if(!options.length)continue;const stats=strategyStats[strategy]||{},pref=Math.max(0,preference.indexOf(strategy)),gate=performanceGate(stats),sorted=options.map(setup=>({setup,quality:setupQuality(setup)})).sort((a,b)=>b.quality-a.quality),winner=sorted[0],score=adaptiveScore(strategy,stats,pref)+winner.quality;champions.push({strategy,setup:winner.setup,alternatives:options.length,quality:Number(winner.quality.toFixed(4)),score,gate,stats});}
 if(!champions.length)return{candidate:"NO_SETUP",status:"NO_SETUP",eligible:false,rationale:"No recognized strategy engine produced a candidate.",evidence:null,strategyRanking:[],perEngineChampions:[],ensemble:null};
 champions.sort((a,b)=>b.score-a.score);const weights=softmaxWeights(champions);
 const ranking=champions.map((x,i)=>({strategy:x.strategy,score:Number(x.score.toFixed(5)),weight:weights[i],eligible:x.gate.passed,side:x.setup.side||null,setupQuality:x.quality,alternatives:x.alternatives,totalTrades:x.stats.totalTrades||0,holdoutTrades:x.stats.holdoutTrades||0,expectancyR:x.stats.expectancyR??null,recentExpectancyR:x.stats.recentExpectancyR??null,profitFactor:x.stats.profitFactor??null,reason:x.gate.reason}));
 const sides={BUY:0,SELL:0},votes={BUY:0,SELL:0};champions.forEach((x,i)=>{const side=x.setup.side;if(side==="BUY"||side==="SELL"){sides[side]+=weights[i];votes[side]++;}});
 const dominant=sides.BUY===sides.SELL?null:sides.BUY>sides.SELL?"BUY":"SELL",total=sides.BUY+sides.SELL,share=dominant&&total?sides[dominant]/total:0,consensus=!!dominant&&votes[dominant]>=2&&share>=.55;
 const eligibleOnSide=consensus?champions.filter(x=>x.setup.side===dominant&&x.gate.passed):[];eligibleOnSide.sort((a,b)=>b.score-a.score);
 const selected=eligibleOnSide[0]||champions[0],diagnosticOnly=!!selected.setup.diagnosticOnly,eligible=!!eligibleOnSide.length&&!diagnosticOnly,hasDirectionalVotes=votes.BUY+votes.SELL>0,status=eligible?"PAPER_ELIGIBLE":consensus?"BLOCKED_BY_EVIDENCE":hasDirectionalVotes?"BLOCKED_BY_ENSEMBLE":"BLOCKED_BY_EVIDENCE";
 const rationale="Each active engine contributes its own best current setup; the ensemble compares all engine champions using regime fit, setup quality, holdout edge, recent performance, sample confidence and risk.";
 const perEngineChampions=champions.map(x=>({strategy:x.strategy,side:x.setup.side||null,setup:x.setup,quality:x.quality,score:Number(x.score.toFixed(5)),evidence:x.gate}));
 const ensemble={direction:dominant,buyWeight:Number(sides.BUY.toFixed(4)),sellWeight:Number(sides.SELL.toFixed(4)),buyVotes:votes.BUY,sellVotes:votes.SELL,dominantShare:Number(share.toFixed(4)),consensus,minimumVotes:2,minimumShare:.55};
 return{candidate:selected.strategy,status,eligible,rationale,implementation:"Every engine keeps its own best candidate. The ensemble ranks all engine champions together; only a same-direction consensus candidate with passed evidence gates can become the active paper setup. All other champions remain in shadow research.",evidence:selected.gate,model:selected.stats.model||null,selectedSetup:eligible?selected.setup:null,evaluatedCandidates:champions.length,strategyRanking:ranking,perEngineChampions,ensemble,adaptation:"Per-engine champions and cross-engine consensus are recalculated on every market sync. Recent results change relative weights but cannot bypass holdout evidence, consensus or risk gates."};
}
module.exports={selectAdaptiveStrategy,performanceGate,adaptiveScore,setupQuality,ADAPTIVE_STRATEGY_GATES:{MIN_TOTAL_TRADES,MIN_HOLDOUT_TRADES,MIN_EXPECTANCY_R,MIN_PROFIT_FACTOR,MAX_DRAWDOWN_R,MAX_CONSECUTIVE_LOSSES},STRATEGY_FAMILIES:REGIME_PREFERENCE};
