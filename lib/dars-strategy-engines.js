/**
 * DARS strategy engines. Deterministic, closed-candle-only candidate generation.
 * These are research/paper engines; they never submit broker orders.
 */
function ema(values, period) {
  if (values.length < period) return null;
  let value = values.slice(0, period).reduce((a,b)=>a+b,0)/period;
  const k=2/(period+1);
  for(let i=period;i<values.length;i++) value=values[i]*k+value*(1-k);
  return value;
}
function rsi(values, period=14) {
  if(values.length<=period)return null;
  let up=0,down=0;
  for(let i=values.length-period;i<values.length;i++){const d=values[i]-values[i-1];if(d>0)up+=d;else down-=d;}
  return down===0?100:100-100/(1+up/down);
}
function atr(candles, period=14) {
  if(candles.length<=period)return null;
  const tr=[];
  for(let i=1;i<candles.length;i++){const c=candles[i],p=candles[i-1];tr.push(Math.max(c.high-c.low,Math.abs(c.high-p.close),Math.abs(c.low-p.close)));}
  return tr.slice(-period).reduce((a,b)=>a+b,0)/period;
}
function makeSetup(strategy, side, entry, stop, atrValue, features, note, spread=0) {
  const risk=Math.abs(entry-stop);
  if(!(risk>0)||!Number.isFinite(risk)||risk<atrValue*.2||risk>atrValue*2.5)return null;
  const sign=side==="BUY"?1:-1;
  return {strategy,side,entry,stopLoss:stop,takeProfit1:entry+sign*risk*1.5,takeProfit2:entry+sign*risk*2.5,riskDistance:risk,rewardRiskTP1:1.5,rewardRiskTP2:2.5,features:{...features,spread},note};
}
function buildCandidates({frames,quote}) {
  const m5=frames.M5,m15=frames.M15,h1=frames.H1;
  if(!m5?.ok||!m15?.ok||!h1?.ok)return [];
  const candles=m5.candles||[];
  if(candles.length<60)return [];
  const last=candles[candles.length-1],prev=candles[candles.length-2];
  const closes=candles.map(c=>c.close),e20=ema(closes,20),e50=ema(closes,50),a=atr(candles),strength=rsi(closes);
  if(![e20,e50,a,strength].every(Number.isFinite)||a<=0)return [];
  const aligned=m15.trend===h1.trend&&m15.trend!=="MIXED";
  const candidates=[];
  const prior=candles.slice(-21,-1),priorHigh=Math.max(...prior.map(c=>c.high)),priorLow=Math.min(...prior.map(c=>c.low));
  const sweepLow=last.low<priorLow&&last.close>priorLow,sweepHigh=last.high>priorHigh&&last.close<priorHigh;
  if(aligned&&m15.trend==="BULLISH"&&sweepLow&&last.close>e20&&strength>=45&&strength<=68){
    const setup=makeSetup("LIQUIDITY_RECLAIM","BUY",quote.ask,Math.min(last.low,priorLow)-a*.15,a,{rsi:strength,emaGap:(last.close-e20)/a,atr:a,sweep:1,trendAlignment:1},"Closed-candle sell-side sweep and reclaim aligned with M15/H1 bullish trend.",quote.ask-quote.bid);
    if(setup)candidates.push(setup);
  }
  if(aligned&&m15.trend==="BEARISH"&&sweepHigh&&last.close<e20&&strength>=32&&strength<=55){
    const setup=makeSetup("LIQUIDITY_RECLAIM","SELL",quote.bid,Math.max(last.high,priorHigh)+a*.15,a,{rsi:strength,emaGap:(last.close-e20)/a,atr:a,sweep:1,trendAlignment:1},"Closed-candle buy-side sweep and reclaim aligned with M15/H1 bearish trend.",quote.ask-quote.bid);
    if(setup)candidates.push(setup);
  }
  // Trend-following: aligned EMA structure + pullback through EMA20 and close back with trend.
  if(aligned&&m15.trend==="BULLISH"&&e20>e50&&prev.close<=e20&&last.close>e20&&strength>=50&&strength<=70){
    const swingLow=Math.min(...candles.slice(-6).map(c=>c.low));
    const setup=makeSetup("TREND_FOLLOWING","BUY",quote.ask,swingLow-a*.12,a,{rsi:strength,emaGap:(last.close-e20)/a,atr:a,sweep:0,trendAlignment:1},"M5 EMA20 pullback reclaim in aligned bullish M15/H1 trend.",quote.ask-quote.bid);
    if(setup)candidates.push(setup);
  }
  if(aligned&&m15.trend==="BEARISH"&&e20<e50&&prev.close>=e20&&last.close<e20&&strength>=30&&strength<=50){
    const swingHigh=Math.max(...candles.slice(-6).map(c=>c.high));
    const setup=makeSetup("TREND_FOLLOWING","SELL",quote.bid,swingHigh+a*.12,a,{rsi:strength,emaGap:(last.close-e20)/a,atr:a,sweep:0,trendAlignment:1},"M5 EMA20 pullback rejection in aligned bearish M15/H1 trend.",quote.ask-quote.bid);
    if(setup)candidates.push(setup);
  }
  // Mean reversion: only non-trending regime, re-entry inside 2-sigma band after an excursion.
  if(m5.regime==="RANGE_OR_TRANSITION"){
    const window=closes.slice(-20),mean=window.reduce((x,y)=>x+y,0)/window.length;
    const sd=Math.sqrt(window.reduce((x,y)=>x+(y-mean)**2,0)/window.length);
    const upper=mean+2*sd,lower=mean-2*sd;
    const prevCloses=closes.slice(0,-1),prevWindow=prevCloses.slice(-20),prevMean=prevWindow.reduce((x,y)=>x+y,0)/prevWindow.length;
    const prevSd=Math.sqrt(prevWindow.reduce((x,y)=>x+(y-prevMean)**2,0)/prevWindow.length);
    const prevUpper=prevMean+2*prevSd,prevLower=prevMean-2*prevSd;
    if(prev.close<prevLower&&last.close>=lower&&strength<=38){
      const swingLow=Math.min(...candles.slice(-5).map(c=>c.low));
      const setup=makeSetup("MEAN_REVERSION","BUY",quote.ask,swingLow-a*.15,a,{rsi:strength,emaGap:(last.close-mean)/a,atr:a,sweep:0,trendAlignment:0},"Price re-entered the lower two-sigma band after downside extension; range regime only.",quote.ask-quote.bid);
      if(setup)candidates.push(setup);
    }
    if(prev.close>prevUpper&&last.close<=upper&&strength>=62){
      const swingHigh=Math.max(...candles.slice(-5).map(c=>c.high));
      const setup=makeSetup("MEAN_REVERSION","SELL",quote.bid,swingHigh+a*.15,a,{rsi:strength,emaGap:(last.close-mean)/a,atr:a,sweep:0,trendAlignment:0},"Price re-entered the upper two-sigma band after upside extension; range regime only.",quote.ask-quote.bid);
      if(setup)candidates.push(setup);
    }
  }
  return candidates;
}
module.exports={buildCandidates};
