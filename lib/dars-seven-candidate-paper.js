/**
 * DARS eight-candidate paper pool.
 * The holdout metrics below are research priors supplied by the user, not guarantees.
 * Entry thresholds are provisional standard oscillator bands because the supplied
 * report table did not include the exact indicator periods/thresholds.
 */
const MIN_ENTRY_SCORE = 60;
const { detectEhlBreakout, STRATEGY_ID: EHL_ID } = require('./dars-ehl-breakout');
const CANDIDATES = [
  { id:"GOLD-583", family:"SWEEP_MSS", profile:"Sweep 5 / confirm 4", sweepLookback:5, confirmBars:4, sl:1, targetR:1.5, netR:9.97, profitFactor:1.48 },
  { id:"GOLD-589", family:"SWEEP_MSS", profile:"Sweep 8 / confirm 3", sweepLookback:8, confirmBars:3, sl:1, targetR:1.5, netR:8.17, profitFactor:1.57 },
  { id:"GOLD-580", family:"SWEEP_MSS", profile:"Sweep 5 / confirm 3", sweepLookback:5, confirmBars:3, sl:1, targetR:1.5, netR:7.62, profitFactor:1.43 },
  { id:"GOLD-294", family:"CCI_REVERSION", profile:"CCI20 ±100", period:20, lower:-100, upper:100, sl:1.5, targetR:1.5, holdout:64, winRate:null, netR:6.62, expectancyR:.17, profitFactor:1.46, maxDrawdownR:4.28 },
  { id:"GOLD-257", family:"STOCHASTIC_REVERSION", profile:"Stochastic14 20/80", period:14, lower:20, upper:80, sl:2, targetR:3, holdout:65, winRate:55.4, netR:12.29, expectancyR:.189, profitFactor:1.53, maxDrawdownR:4.09 },
  { id:"GOLD-265", family:"STOCHASTIC_REVERSION", profile:"Stochastic14 30/70", period:14, lower:30, upper:70, sl:2, targetR:3, holdout:65, winRate:56.9, netR:13.39, expectancyR:.206, profitFactor:1.61, maxDrawdownR:3.05 },
  { id:"GOLD-425", family:"WILLIAMS_REVERSION", profile:"Williams14 -80/-20", period:14, lower:-80, upper:-20, sl:2, targetR:3, holdout:65, winRate:55.4, netR:12.29, expectancyR:.189, profitFactor:1.53, maxDrawdownR:4.09 },
  { id:EHL_ID, family:"EHL_BREAKOUT", profile:"EHL v1.10 · DISCOVERY", period:null, lower:null, upper:null, sl:1, targetR:2, holdout:0, discovery:true }
];
function oscillator(candles, end, family, period) {
  if (end-period+1<0) return null;
  const w=candles.slice(end-period+1,end+1);
  if(family==="CCI_REVERSION"){
    const tp=w.map(x=>(Number(x.high)+Number(x.low)+Number(x.close))/3);
    const avg=tp.reduce((a,b)=>a+b,0)/tp.length;
    const dev=tp.reduce((a,v)=>a+Math.abs(v-avg),0)/tp.length;
    return dev?(tp[tp.length-1]-avg)/(.015*dev):0;
  }
  const high=Math.max(...w.map(x=>Number(x.high))),low=Math.min(...w.map(x=>Number(x.low)));
  const close=Number(w[w.length-1].close);
  if(!(high>low))return family==="STOCHASTIC_REVERSION"?50:-50;
  return family==="STOCHASTIC_REVERSION"?100*(close-low)/(high-low):-100*(high-close)/(high-low);
}
function sweepMssSignal(candles,c,atr){
  const end=candles.length-1,first=Math.max(c.sweepLookback,end-c.confirmBars);
  for(let i=end-1;i>=first;i--){
    if(i-c.sweepLookback<0)continue;
    const prior=candles.slice(i-c.sweepLookback,i),bar=candles[i],last=candles[end];
    const pLow=Math.min(...prior.map(x=>Number(x.low))),pHigh=Math.max(...prior.map(x=>Number(x.high)));
    if(Number(bar.low)<pLow&&Number(bar.close)>pLow&&Number(last.close)>Number(bar.high)&&Number(last.close)>Number(last.open))
      return {side:"BUY",stop:Math.min(Number(bar.low),pLow)-atr*.15,sweepBar:bar};
    if(Number(bar.high)>pHigh&&Number(bar.close)<pHigh&&Number(last.close)<Number(bar.low)&&Number(last.close)<Number(last.open))
      return {side:"SELL",stop:Math.max(Number(bar.high),pHigh)+atr*.15,sweepBar:bar};
  }
  return null;
}
function metricsFor(trades, id) {
  const rows = (Array.isArray(trades)?trades:[]).filter(t=>t && t.strategyId===id && t.status==="CLOSED")
    .slice().sort((a,b)=>Date.parse(a.closedAt||a.closed_at||a.openedAt)-Date.parse(b.closedAt||b.closed_at||b.openedAt));
  let wins=0,grossWin=0,grossLoss=0,eq=0,peak=0,dd=0,streak=0,maxStreak=0;
  for(const t of rows){const r=Number(t.netR)||0;eq+=r;peak=Math.max(peak,eq);dd=Math.max(dd,peak-eq);if(r>0){wins++;grossWin+=r;streak=0;}else if(r<0){grossLoss+=-r;streak++;maxStreak=Math.max(maxStreak,streak);}}
  return { trades:rows.length, wins, losses:rows.length-wins, winRate:rows.length?wins/rows.length*100:null, expectancyR:rows.length?eq/rows.length:null, profitFactor:grossLoss?grossWin/grossLoss:grossWin?99:null, maxDrawdownR:dd, consecutiveLosses:maxStreak, netR:eq };
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
function score(candidate, forward, liveFit=0) {
  const prior=componentScore({expectancyR:candidate.expectancyR,profitFactor:candidate.profitFactor,maxDrawdownR:candidate.maxDrawdownR,winRate:candidate.winRate,trades:candidate.holdout});
  let research=prior;
  if(forward.trades){const current=componentScore(forward);const weight=Math.min(.65,forward.trades/(forward.trades+30));research=prior*(1-weight)+current*weight;}
  const penalty=Math.min(12,Math.max(0,forward.consecutiveLosses-2)*2);
  // Weak forward evidence reduces ranking even when the latest setup looks attractive.
  const weakForwardPenalty=forward.trades>=10 && ((forward.expectancyR??0)<.02 || (forward.profitFactor??0)<1.05 || forward.maxDrawdownR>6 || forward.consecutiveLosses>4) ? 25 : 0;
  // 45% research evidence + 55% current market fit, with a forward-quality penalty. Not a win probability.
  return Number(clamp(research*.45+clamp(liveFit,0,100)*.55-penalty-weakForwardPenalty,0,100).toFixed(1));
}
function analyzeSevenCandidatePool({frames,quote,paperTrades=[],preferredCandidateId=null,marketBlockReason=null}={}) {
  const m5=frames?.M5,m15=frames?.M15,h1=frames?.H1;
  const empty={candidate:"NO_TRADE",status:"NO_SETUP",eligible:false,rationale:"No qualified setup from the eight-candidate pool.",strategyRanking:[],evaluatedCandidates:CANDIDATES.length};
  if(!m5?.ok||!m15?.ok||!h1?.ok)return {selection:{...empty,status:"WAITING_FOR_CANDLES",rationale:"Waiting for verified M5, M15 and H1 candles."},setup:null,board:[],diagnostics:["Required MT5 candle frames are not ready."]};
  const candles=m5.candles||[],last=candles[candles.length-1],prevIndex=candles.length-2;
  const atr=Number(m5.atr14),bid=Number(quote?.bid),ask=Number(quote?.ask);
  if(candles.length<60||!last||!(atr>0)||!(bid>0&&ask>=bid))return {selection:{...empty,status:"WAITING_FOR_DATA",rationale:"Insufficient verified closed candles or live quote."},setup:null,board:[],diagnostics:["Insufficient verified data."]};
  const ehlSetup=detectEhlBreakout({frames:{M5:m5},quote});
  const results=CANDIDATES.map(c=>{
    if(c.discovery){
      const forward=metricsFor(paperTrades,c.id), detected=!!ehlSetup, liveScore=detected?75:0;
      const forwardScore=forward.trades?componentScore(forward):liveScore;
      const weight=forward.trades?Math.min(.65,forward.trades/(forward.trades+30)):0;
      const rankScore=detected?Number((liveScore*(1-weight)+forwardScore*weight).toFixed(1)):0;
      const forwardPaused=forward.trades>=10 && ((forward.expectancyR??0)<=0 || (forward.profitFactor??0)<1 || forward.maxDrawdownR>6 || forward.consecutiveLosses>4);
      return {...c,score:rankScore,liveFitScore:liveScore,forward,detected,paused:forwardPaused,
        setup:detected&&!forwardPaused&&rankScore>=MIN_ENTRY_SCORE?{...ehlSetup}:null};
    }
    if(c.family==="SWEEP_MSS"){
      const sig=!marketBlockReason?sweepMssSignal(candles,c,atr):null;
      const aligned=sig&&(sig.side==="BUY"?m15.trend==="BULLISH"&&h1.trend==="BULLISH":m15.trend==="BEARISH"&&h1.trend==="BEARISH");
      const detected=!!aligned,side=aligned?sig.side:null;
      const liveFit=detected?100:0;
      const forwardScore=forward.trades?componentScore(forward):50;
      const forwardWeight=forward.trades?Math.min(.65,forward.trades/(forward.trades+30)):0;
      const researchScore=50*(1-forwardWeight)+forwardScore*forwardWeight;
      const lossPenalty=Math.min(12,Math.max(0,forward.consecutiveLosses-2)*2);
      const rankScore=Number(clamp(researchScore*.45+liveFit*.55-lossPenalty,0,100).toFixed(1));
      const paused=forward.trades>=10&&((forward.expectancyR??0)<=0||(forward.profitFactor??0)<1||forward.maxDrawdownR>6||forward.consecutiveLosses>4);
      let setup=null;
      if(detected&&!paused&&rankScore>=MIN_ENTRY_SCORE){
        const entry=side==="BUY"?ask:bid,sign=side==="BUY"?1:-1,risk=Math.abs(entry-sig.stop);
        if(risk>=atr*.2&&risk<=atr*3)setup={strategy:c.id,strategyId:c.id,family:c.family,profile:c.profile,side,entry,stopLoss:sig.stop,takeProfit1:entry+sign*risk,takeProfit2:entry+sign*risk*c.targetR,riskDistance:risk,targetR:c.targetR,stopMultiple:c.sl,rewardRiskTP1:1,rewardRiskTP2:c.targetR,atr14:atr,signalBarTime:last.timeMs||last.bar_time||null,note:"Closed-M5 liquidity sweep reclaim followed by MSS confirmation within "+c.confirmBars+" bars; aligned M15/H1 trend."};
      }
      return {...c,score:rankScore,liveFitScore:liveFit,forward,detected,side,paused,setup};
    }
    const current=oscillator(candles,candles.length-1,c.family,c.period);
    const previous=oscillator(candles,prevIndex,c.family,c.period);
    const regimeAllowed=!marketBlockReason&&m5.regime==="RANGE_OR_TRANSITION"&&m15.regime!=="HIGH_VOLATILITY"&&m5.regime!=="HIGH_VOLATILITY";
    let side=null;
    if(regimeAllowed&&current!==null&&previous!==null){
      if(previous<c.lower&&current>previous)side="BUY";
      else if(previous>c.upper&&current<previous)side="SELL";
    }
    const forward=metricsFor(paperTrades,c.id);
    const detected=!!side;
    const distance=current===null?100:Math.min(Math.abs(current-c.lower),Math.abs(current-c.upper));
    const proximity=clamp(100-distance*4,0,100);
    const momentum=previous===null||current===null?0:clamp(Math.abs(current-previous)*5,0,100);
    const liveFit=(regimeAllowed?100:0)*.35+(detected?100:proximity)*.45+(detected?momentum:momentum*.5)*.20;
    const rankScore=score(c,forward,liveFit);
    const forwardPaused=forward.trades>=10 && ((forward.expectancyR??0)<=0 || (forward.profitFactor??0)<1 || forward.maxDrawdownR>6 || forward.consecutiveLosses>4);
    let setup=null;
    if(detected&&!forwardPaused&&rankScore>=MIN_ENTRY_SCORE){
      const entry=side==="BUY"?ask:bid,sign=side==="BUY"?1:-1,risk=atr*c.sl;
      setup={strategy:c.id,strategyId:c.id,family:c.family,profile:c.profile,side,entry,stopLoss:entry-sign*risk,
        takeProfit1:entry+sign*risk, takeProfit2:entry+sign*risk*c.targetR,
        riskDistance:risk,targetR:c.targetR,stopMultiple:c.sl,maxBars:c.maxBars,
        rewardRiskTP1:1,rewardRiskTP2:c.targetR,atr14:atr,oscillator:current,previousOscillator:previous,
        lowerThreshold:c.lower,upperThreshold:c.upper,signalBarTime:last.timeMs||last.bar_time||null,
        note:"Closed-M5 oscillator turn in range regime; paper-only setup."};
    }
    return {...c,score:Number(rankScore.toFixed(1)),liveFitScore:Number(liveFit.toFixed(1)),forward,detected,side,paused:forwardPaused,setup};
  });
  const regimeAllowed=!marketBlockReason&&m5.regime==="RANGE_OR_TRANSITION"&&m15.regime!=="HIGH_VOLATILITY"&&m5.regime!=="HIGH_VOLATILITY";
  const signalled=results.filter(x=>x.setup).sort((a,b)=>b.score-a.score);
  const ranking=results.slice().sort((a,b)=>b.score-a.score).map(x=>({
    strategy:x.id,score:x.score,liveFitScore:x.liveFitScore,detected:x.detected,eligible:!!x.setup,paused:x.paused,
    side:x.setup?.side||x.side||null,entry:x.setup?.entry??null,stopLoss:x.setup?.stopLoss??null,takeProfit1:x.setup?.takeProfit1??null,takeProfit2:x.setup?.takeProfit2??null,
    family:x.family,profile:x.profile,parameters:{period:x.period,lower:x.lower,upper:x.upper,sl:x.sl,targetR:x.targetR,maxBars:x.maxBars},
    developmentTrades:x.dev,holdoutTrades:x.holdout,holdoutWinRate:x.winRate,holdoutNetR:x.netR,
    holdoutExpectancyR:x.expectancyR,holdoutProfitFactor:x.profitFactor,holdoutMaxDrawdownR:x.maxDrawdownR,discovery:!!x.discovery,
    forwardTrades:x.forward.trades,forwardWins:x.forward.wins,forwardLosses:x.forward.losses,forwardWinRate:x.forward.winRate,
    forwardNetR:x.forward.netR,forwardExpectancyR:x.forward.expectancyR,forwardProfitFactor:x.forward.profitFactor,
    forwardMaxDrawdownR:x.forward.maxDrawdownR,
    reason:x.paused?"Paused by forward-paper risk guard":x.discovery?(x.detected?"EHL discovery signal · paper validation only":"No confirmed EHL breakout"):marketBlockReason?("Blocked: "+marketBlockReason):!((m5.regime==="RANGE_OR_TRANSITION")&&m15.regime!=="HIGH_VOLATILITY")?"Blocked by market regime":x.detected&&x.score<MIN_ENTRY_SCORE?"Score "+x.score+"% is below the "+MIN_ENTRY_SCORE+"% entry minimum":x.detected?"Closed-candle setup detected":"No setup on latest closed M5 candle"
  }));
  const ehlRegimeAllowed=!marketBlockReason&&m5.regime!=="HIGH_VOLATILITY"&&m15.regime!=="HIGH_VOLATILITY";
  if(!regimeAllowed&&!(ehlRegimeAllowed&&ehlSetup))return {selection:{...empty,status:"BLOCKED_BY_REGIME",rationale:marketBlockReason||((m5.regime==="HIGH_VOLATILITY"||m15.regime==="HIGH_VOLATILITY")?"High volatility detected; all candidates are paused.":"Seven reversion candidates require a range/transition regime; EHL has no confirmed breakout.")},setup:null,board:ranking,diagnostics:["Eight strategies evaluated; no permitted setup in the current market regime."]};
  const chosen=preferredCandidateId?signalled.find(x=>x.id===preferredCandidateId):signalled[0];
  if(!chosen){
    const selected=preferredCandidateId?results.find(x=>x.id===preferredCandidateId):null;
    const reason=preferredCandidateId
      ? (selected?.paused?"The manually selected strategy is paused by its forward-paper risk guard. No substitute strategy will be used.":selected?.detected&&selected.score<MIN_ENTRY_SCORE?`The manually selected strategy scored ${selected.score}%, below the ${MIN_ENTRY_SCORE}% minimum. No paper trade will open.`:"The manually selected strategy has no valid trigger on the latest closed M5 candle. No substitute strategy will be used.")
      :`No candidate met both the closed-candle signal rules and the ${MIN_ENTRY_SCORE}% minimum score.`;
    return {selection:{...empty,candidate:preferredCandidateId||"NO_TRADE",status:preferredCandidateId?(selected?.paused?"MANUAL_STRATEGY_PAUSED":"MANUAL_NO_SIGNAL"):"NO_SETUP",rationale:reason,mode:preferredCandidateId?"MANUAL":"ROBOT_AUTO",strategyRanking:ranking},setup:null,paperSetups:results.filter(x=>x.setup).map(x=>x.setup),board:ranking,diagnostics:[reason]};
  }
  const setup=chosen.setup;
  return {
    selection:{candidate:chosen.id,score:chosen.score,liveFitScore:chosen.liveFitScore,status:chosen.discovery?"DISCOVERY_PAPER_REVIEW":"FORWARD_PAPER_REVIEW",eligible:true,mode:preferredCandidateId?"MANUAL":"ROBOT_AUTO",rationale:"Highest eligible score: "+chosen.score+"% among the eight evaluated strategies. Score is a strategy-fit rating, not a win probability. "+(chosen.discovery?"EHL is a discovery candidate with no historical holdout evidence.":"Selected using holdout research priors and current live-market fit."),evidence:{passed:false,reason:chosen.discovery?"New discovery candidate; collect forward-paper evidence before promotion.":"Research candidate only; continue forward paper validation. Not a proven winner."},evaluatedCandidates:CANDIDATES.length,strategyRanking:ranking,adaptation:`Selection is re-ranked among current closed-candle signals; minimum entry score is ${MIN_ENTRY_SCORE}%. A strategy is paused after at least 10 forward trades if expectancy is non-positive, PF is below 1, drawdown exceeds 6R, or loss streak exceeds 4.`},
    setup,paperSetups:results.filter(x=>x.setup).map(x=>x.setup),board:ranking,diagnostics:["Eight candidates independently evaluated for paper entries. No broker order is sent."]
  };
}
module.exports={CANDIDATES,MIN_ENTRY_SCORE,analyzeSevenCandidatePool,metricsFor,sweepMssSignal};
