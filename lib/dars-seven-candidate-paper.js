/**
 * DARS fixed seven-candidate paper pool.
 * The holdout metrics below are research priors supplied by the user, not guarantees.
 * Entry thresholds are provisional standard oscillator bands because the supplied
 * report table did not include the exact indicator periods/thresholds.
 */
const CANDIDATES = [
  { id:"WILLIAMS_REVERSION-STRICT-V2", family:"WILLIAMS_REVERSION", profile:"STRICT", period:14, lower:-80, upper:-20, sl:1, targetR:1.5, maxBars:12, dev:64, holdout:30, winRate:56.7, netR:7.63, expectancyR:.25, profitFactor:1.54, maxDrawdownR:3.39 },
  { id:"STOCHASTIC_REVERSION-BASE-V4", family:"STOCHASTIC_REVERSION", profile:"BASE", period:14, lower:25, upper:75, sl:1.5, targetR:2.5, maxBars:20, dev:49, holdout:24, winRate:45.8, netR:3.50, expectancyR:.15, profitFactor:1.27, maxDrawdownR:3.10 },
  { id:"WILLIAMS_REVERSION-BASE-V4", family:"WILLIAMS_REVERSION", profile:"BASE", period:14, lower:-75, upper:-25, sl:1.5, targetR:2.5, maxBars:20, dev:52, holdout:24, winRate:45.8, netR:3.52, expectancyR:.15, profitFactor:1.27, maxDrawdownR:3.10 },
  { id:"WILLIAMS_REVERSION-SENSITIVE-V4", family:"WILLIAMS_REVERSION", profile:"SENSITIVE", period:14, lower:-70, upper:-30, sl:1.5, targetR:2.5, maxBars:20, dev:63, holdout:27, winRate:44.4, netR:3.53, expectancyR:.13, profitFactor:1.23, maxDrawdownR:3.91 },
  { id:"STOCHASTIC_REVERSION-STRICT-V4", family:"STOCHASTIC_REVERSION", profile:"STRICT", period:14, lower:20, upper:80, sl:1.5, targetR:2.5, maxBars:20, dev:58, holdout:27, winRate:44.4, netR:3.52, expectancyR:.13, profitFactor:1.23, maxDrawdownR:3.91 },
  { id:"WILLIAMS_REVERSION-STRICT-V4", family:"WILLIAMS_REVERSION", profile:"STRICT", period:14, lower:-80, upper:-20, sl:1.5, targetR:2.5, maxBars:20, dev:54, holdout:27, winRate:40.7, netR:3.06, expectancyR:.11, profitFactor:1.18, maxDrawdownR:3.89 },
  { id:"STOCHASTIC_REVERSION-BASE-V2", family:"STOCHASTIC_REVERSION", profile:"BASE", period:14, lower:25, upper:75, sl:1, targetR:1.5, maxBars:12, dev:64, holdout:26, winRate:50.0, netR:2.26, expectancyR:.09, profitFactor:1.17, maxDrawdownR:4.34 }
];
function oscillator(candles, end, family, period) {
  if (end - period + 1 < 0) return null;
  const window = candles.slice(end-period+1, end+1);
  const high = Math.max(...window.map(c=>Number(c.high)));
  const low = Math.min(...window.map(c=>Number(c.low)));
  const close = Number(window[window.length-1].close);
  if (!(high > low)) return family === "STOCHASTIC_REVERSION" ? 50 : -50;
  return family === "STOCHASTIC_REVERSION" ? 100*(close-low)/(high-low) : -100*(high-close)/(high-low);
}
function metricsFor(trades, id) {
  const rows = (Array.isArray(trades)?trades:[]).filter(t=>t && t.strategyId===id && t.status==="CLOSED")
    .slice().sort((a,b)=>Date.parse(a.closedAt||a.closed_at||a.openedAt)-Date.parse(b.closedAt||b.closed_at||b.openedAt));
  let wins=0,grossWin=0,grossLoss=0,eq=0,peak=0,dd=0,streak=0,maxStreak=0;
  for(const t of rows){const r=Number(t.netR)||0;eq+=r;peak=Math.max(peak,eq);dd=Math.max(dd,peak-eq);if(r>0){wins++;grossWin+=r;streak=0;}else if(r<0){grossLoss+=-r;streak++;maxStreak=Math.max(maxStreak,streak);}}
  return { trades:rows.length, winRate:rows.length?wins/rows.length*100:null, expectancyR:rows.length?eq/rows.length:null, profitFactor:grossLoss?grossWin/grossLoss:grossWin?99:null, maxDrawdownR:dd, consecutiveLosses:maxStreak, netR:eq };
}
function clamp(value,min,max){return Math.max(min,Math.min(max,Number(value)||0));}
function componentScore({expectancyR,profitFactor,maxDrawdownR,winRate,trades}) {
  const expectancy=clamp(((Number(expectancyR)||0)+.05)/.35*100,0,100);
  const pf=clamp(((Number(profitFactor)||0)-.8)/1.2*100,0,100);
  const drawdown=clamp((8-(Number(maxDrawdownR)||0))/8*100,0,100);
  const wins=clamp(((Number(winRate)||0)-35)/30*100,0,100);
  const sample=clamp((Number(trades)||0)/60*100,0,100);
  return expectancy*.30+pf*.25+drawdown*.20+wins*.10+sample*.15;
}
function score(candidate, forward) {
  const prior=componentScore({expectancyR:candidate.expectancyR,profitFactor:candidate.profitFactor,maxDrawdownR:candidate.maxDrawdownR,winRate:candidate.winRate,trades:candidate.holdout});
  if(!forward.trades)return Number(prior.toFixed(1));
  const current=componentScore(forward);
  const weight=Math.min(.65,forward.trades/(forward.trades+30));
  const penalty=Math.min(12,Math.max(0,forward.consecutiveLosses-2)*2);
  return Number(clamp(prior*(1-weight)+current*weight-penalty,0,100).toFixed(1));
}
function analyzeSevenCandidatePool({frames,quote,paperTrades=[],preferredCandidateId=null}={}) {
  const m5=frames?.M5,m15=frames?.M15,h1=frames?.H1;
  const empty={candidate:"NO_TRADE",status:"NO_SETUP",eligible:false,rationale:"No qualified setup from the fixed seven-candidate pool.",strategyRanking:[],evaluatedCandidates:7};
  if(!m5?.ok||!m15?.ok||!h1?.ok)return {selection:{...empty,status:"WAITING_FOR_CANDLES",rationale:"Waiting for verified M5, M15 and H1 candles."},setup:null,board:[],diagnostics:["Required MT5 candle frames are not ready."]};
  if(m5.regime==="HIGH_VOLATILITY"||m15.regime==="HIGH_VOLATILITY")return {selection:{...empty,status:"BLOCKED_BY_REGIME",rationale:"High volatility detected; reversion candidates are paused."},setup:null,board:[],diagnostics:["High volatility: NO TRADE."]};
  if(m5.regime!=="RANGE_OR_TRANSITION")return {selection:{...empty,status:"BLOCKED_BY_REGIME",rationale:"The seven reversion candidates only trade a range/transition regime."},setup:null,board:[],diagnostics:["Market is trending; oscillator reversion entries are blocked."]};
  const candles=m5.candles||[],last=candles[candles.length-1],prevIndex=candles.length-2;
  const atr=Number(m5.atr14),bid=Number(quote?.bid),ask=Number(quote?.ask);
  if(candles.length<60||!last||!(atr>0)||!(bid>0&&ask>=bid))return {selection:{...empty,status:"WAITING_FOR_DATA",rationale:"Insufficient verified closed candles or live quote."},setup:null,board:[],diagnostics:["Insufficient verified data."]};
  const results=CANDIDATES.map(c=>{
    const current=oscillator(candles,candles.length-1,c.family,c.period);
    const previous=oscillator(candles,prevIndex,c.family,c.period);
    let side=null;
    if(current!==null&&previous!==null){
      if(previous<c.lower&&current>previous)side="BUY";
      else if(previous>c.upper&&current<previous)side="SELL";
    }
    const forward=metricsFor(paperTrades,c.id);
    const rankScore=score(c,forward);
    const forwardPaused=forward.trades>=10 && ((forward.expectancyR??0)<=0 || (forward.profitFactor??0)<1 || forward.maxDrawdownR>6 || forward.consecutiveLosses>4);
    const detected=!!side;
    let setup=null;
    if(detected&&!forwardPaused){
      const entry=side==="BUY"?ask:bid,sign=side==="BUY"?1:-1,risk=atr*c.sl;
      setup={strategy:c.id,strategyId:c.id,family:c.family,profile:c.profile,side,entry,stopLoss:entry-sign*risk,
        takeProfit1:entry+sign*risk, takeProfit2:entry+sign*risk*c.targetR,
        riskDistance:risk,targetR:c.targetR,stopMultiple:c.sl,maxBars:c.maxBars,
        rewardRiskTP1:1,rewardRiskTP2:c.targetR,atr14:atr,oscillator:current,previousOscillator:previous,
        lowerThreshold:c.lower,upperThreshold:c.upper,signalBarTime:last.timeMs||last.bar_time||null,
        note:"Closed-M5 oscillator turn in range regime; paper-only setup."};
    }
    return {...c,score:Number(rankScore.toFixed(5)),forward,detected,paused:forwardPaused,setup};
  });
  const signalled=results.filter(x=>x.setup).sort((a,b)=>b.score-a.score);
  const ranking=results.slice().sort((a,b)=>b.score-a.score).map(x=>({
    strategy:x.id,score:x.score,detected:x.detected,eligible:!!x.setup,paused:x.paused,
    family:x.family,profile:x.profile,parameters:{period:x.period,lower:x.lower,upper:x.upper,sl:x.sl,targetR:x.targetR,maxBars:x.maxBars},
    developmentTrades:x.dev,holdoutTrades:x.holdout,holdoutWinRate:x.winRate,holdoutNetR:x.netR,
    holdoutExpectancyR:x.expectancyR,holdoutProfitFactor:x.profitFactor,holdoutMaxDrawdownR:x.maxDrawdownR,
    forwardTrades:x.forward.trades,forwardWinRate:x.forward.winRate,forwardExpectancyR:x.forward.expectancyR,
    forwardProfitFactor:x.forward.profitFactor,forwardMaxDrawdownR:x.forward.maxDrawdownR,
    reason:x.paused?"Paused by forward-paper risk guard":x.detected?"Closed-candle setup detected":"No setup on latest closed M5 candle"
  }));
  const chosen=preferredCandidateId?signalled.find(x=>x.id===preferredCandidateId):signalled[0];
  if(!chosen){
    const selected=preferredCandidateId?results.find(x=>x.id===preferredCandidateId):null;
    const reason=preferredCandidateId
      ? (selected?.paused?"The manually selected strategy is paused by its forward-paper risk guard. No substitute strategy will be used.":"The manually selected strategy has no valid trigger on the latest closed M5 candle. No substitute strategy will be used.")
      :"No active BUY/SELL trigger among the seven candidates on the latest closed M5 candle.";
    return {selection:{...empty,candidate:preferredCandidateId||"NO_TRADE",status:preferredCandidateId?(selected?.paused?"MANUAL_STRATEGY_PAUSED":"MANUAL_NO_SIGNAL"):"NO_SETUP",rationale:reason,mode:preferredCandidateId?"MANUAL":"ROBOT_AUTO",strategyRanking:ranking},setup:null,board:ranking,diagnostics:[reason]};
  }
  const setup=chosen.setup;
  return {
    selection:{candidate:chosen.id,status:"FORWARD_PAPER_REVIEW",eligible:true,mode:preferredCandidateId?"MANUAL":"ROBOT_AUTO",rationale:"Selected from the fixed seven-candidate pool using the supplied holdout research prior plus available forward-paper results.",evidence:{passed:false,reason:"Research candidate only; continue forward paper validation. Not a proven winner."},evaluatedCandidates:7,strategyRanking:ranking,adaptation:"Selection is re-ranked among current closed-candle signals. A strategy is paused after at least 10 forward trades if expectancy is non-positive, PF is below 1, drawdown exceeds 6R, or loss streak exceeds 4."},
    setup,board:ranking,diagnostics:["Paper-only setup selected from the fixed seven-candidate pool. No broker order is sent."]
  };
}
module.exports={CANDIDATES,analyzeSevenCandidatePool,metricsFor};
