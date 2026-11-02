'use strict';
const { ema, atr } = require('./dars-strategy-engines');
const STRATEGY_ID='DARS_EHL_BREAKOUT_V1_10';
function detectEhlBreakout({frames,quote}={}) {
 const raw=frames?.M5?.candles||frames?.M5;
 if(!Array.isArray(raw)||raw.length<220||!quote)return null;
 const bars=raw.slice().sort((a,b)=>new Date(a.bar_time||a.time)-new Date(b.bar_time||b.time));
 const last=bars.at(-1),prev=bars.at(-2),closes=bars.map(x=>Number(x.close));
 const e20=ema(closes,20),e50=ema(closes,50),e100=ema(closes,100),e200=ema(closes,200),a=atr(bars,14);
 if(![e20,e50,e100,e200,a].every(Number.isFinite)||a<=0)return null;
 const bull=e200<e20&&e200<e50&&e200<e100,bear=e200>e20&&e200>e50&&e200>e100;
 const w=bars.slice(-22,-2),hs=w.map(x=>Number(x.high)),ls=w.map(x=>Number(x.low)),tol=a*.08;
 const eqh=hs.filter(x=>Math.abs(x-Math.max(...hs))<=tol).length>=2,eql=ls.filter(x=>Math.abs(x-Math.min(...ls))<=tol).length>=2;
 const high=Math.max(...hs),low=Math.min(...ls),r=bars.slice(-4,-1).map(x=>Number(x.high)-Number(x.low));
 const compressed=r[0]>r[1]&&r[1]>r[2]&&r[2]<=a*.9,body=Math.abs(Number(last.close)-Number(last.open)),span=Number(last.high)-Number(last.low);
 const strong=span>0&&body>=Math.max(a*.35,span*.55),spread=Number(quote.ask)-Number(quote.bid);
 if(!Number.isFinite(spread)||spread<0||spread>a*.12)return null;
 let side=null,level=0;
 if(bull&&eqh&&compressed&&strong&&last.close>high&&prev.close<=high&&last.close>last.open){side='BUY';level=high;}
 if(bear&&eql&&compressed&&strong&&last.close<low&&prev.close>=low&&last.close<last.open){side='SELL';level=low;}
 if(!side)return null;
 const entry=side==='BUY'?Number(quote.ask):Number(quote.bid),sl=side==='BUY'?Math.min(Number(last.low),level)-a*.15:Math.max(Number(last.high),level)+a*.15,risk=Math.abs(entry-sl);
 if(!(risk>=a*.2&&risk<=a*3))return null;
 const sign=side==='BUY'?1:-1;
 return {strategy:STRATEGY_ID,strategyId:STRATEGY_ID,side,entry,stopLoss:sl,takeProfit1:entry+sign*risk,takeProfit2:entry+sign*risk*2,riskDistance:risk,rewardRiskTP1:1,rewardRiskTP2:2,targetR:1.5,stopMultiple:1,maxBars:24,fixedLot:.01,partialCloseAtTp1:true,breakevenAfterTp1:false,reversalRule:side==='BUY'?'bearish close below previous candle low':'bullish close above previous candle high',signalBarTime:last.bar_time||last.time,features:{atr:a,ema20:e20,ema50:e50,ema100:e100,ema200:e200,equalHigh:high,equalLow:low,compression:true,spread},note:'Confirmed closed-M5 EHL breakout. Fixed 0.01 virtual lot; paper-only candidate pending validation.'};
}
module.exports={STRATEGY_ID,detectEhlBreakout};