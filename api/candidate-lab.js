// Gold-only candidate generator and conservative OHLC backtest. Research only; never places orders.
const ALLOWED = new Set(["XAUUSD-STD","XAUUSD"]);
function send(res,status,body){res.status(status);res.setHeader("Content-Type","application/json; charset=utf-8");res.setHeader("Cache-Control","no-store, max-age=0");return res.json(body);}
function ema(a,p){const out=Array(a.length).fill(null);if(a.length<p)return out;let e=a.slice(0,p).reduce((x,y)=>x+y,0)/p;out[p-1]=e;const k=2/(p+1);for(let i=p;i<a.length;i++){e=a[i]*k+out[i-1]*(1-k);out[i]=e;}return out;}
function rsi(a,p=14){const o=Array(a.length).fill(null);for(let i=p;i<a.length;i++){let up=0,dn=0;for(let j=i-p+1;j<=i;j++){const d=a[j]-a[j-1];if(d>0)up+=d;else dn-=d;}o[i]=dn===0?(up===0?50:100):100-100/(1+up/dn);}return o;}
function atr(c,p=14){const o=Array(c.length).fill(null);for(let i=p;i<c.length;i++){let s=0;for(let j=i-p+1;j<=i;j++)s+=Math.max(c[j].high-c[j].low,Math.abs(c[j].high-c[j-1].close),Math.abs(c[j].low-c[j-1].close));o[i]=s/p;}return o;}
function buildSignal(c,cfg){
 const close=c.map(x=>x.close),ef=ema(close,cfg.fast||8),es=ema(close,cfg.slow||21),rr=rsi(close,cfg.rsiPeriod||14),aa=atr(c,14),s=Array(c.length).fill(0);
 const macdFast=ema(close,cfg.fast||12),macdSlow=ema(close,cfg.slow||26),macdLine=close.map((_,i)=>macdFast[i]===null||macdSlow[i]===null?null:macdFast[i]-macdSlow[i]);
 const macdSignal=Array(c.length).fill(null);let macdSeed=null,macdCount=0,macdK=2/((cfg.signalPeriod||9)+1);
 for(let i=0;i<c.length;i++){if(macdLine[i]===null)continue;if(macdSeed===null){macdCount++;if(macdCount===(cfg.signalPeriod||9)){const vals=macdLine.slice(i-(cfg.signalPeriod||9)+1,i+1);macdSeed=vals.reduce((a,b)=>a+b,0)/vals.length;macdSignal[i]=macdSeed;}}else{macdSeed=macdLine[i]*macdK+macdSeed*(1-macdK);macdSignal[i]=macdSeed;}}
 const channelEma=ema(close,cfg.channelPeriod||20);
 const emaMid=ema(close,cfg.midPeriod||20),emaLong=ema(close,cfg.longPeriod||50);
 const rocAt=(i,p)=>i-p<0?null:(close[i-p]===0?0:(close[i]-close[i-p])/close[i-p]*100);
 const williamsAt=(i,p)=>{if(i-p+1<0)return null;let hi=-Infinity,lo=Infinity;for(let j=i-p+1;j<=i;j++){hi=Math.max(hi,c[j].high);lo=Math.min(lo,c[j].low);}return hi===lo?-50:-100*(hi-close[i])/(hi-lo);};
 const adxAt=(i,p)=>{if(i-p<1)return null;let plus=0,minus=0,tr=0;for(let j=i-p+1;j<=i;j++){const up=c[j].high-c[j-1].high,dn=c[j-1].low-c[j].low;plus+=up>dn&&up>0?up:0;minus+=dn>up&&dn>0?dn:0;tr+=Math.max(c[j].high-c[j].low,Math.abs(c[j].high-c[j-1].close),Math.abs(c[j].low-c[j-1].close));}if(tr===0)return 0;return 100*Math.abs(plus-minus)/(plus+minus||1);};
 const rollingRange=(i,p)=>{let hi=-Infinity,lo=Infinity;for(let j=Math.max(0,i-p);j<i;j++){hi=Math.max(hi,c[j].high);lo=Math.min(lo,c[j].low);}return {hi,lo};};
 const ichimoku=(i,p)=>{const mid=(n)=>{let hi=-Infinity,lo=Infinity;for(let j=i-n+1;j<=i;j++){if(j<0)return null;hi=Math.max(hi,c[j].high);lo=Math.min(lo,c[j].low);}return (hi+lo)/2;};return {conversion:mid(p),base:mid(p*2),span:mid(p*4)};};
 const stochasticAt=(idx,p)=>{if(idx-p+1<0)return null;let hi=-Infinity,lo=Infinity;for(let j=idx-p+1;j<=idx;j++){hi=Math.max(hi,c[j].high);lo=Math.min(lo,c[j].low);}return hi===lo?50:100*(c[idx].close-lo)/(hi-lo);};
 const cciAt=(idx,p)=>{if(idx-p+1<0)return null;const tp=[];for(let j=idx-p+1;j<=idx;j++)tp.push((c[j].high+c[j].low+c[j].close)/3);const mean=tp.reduce((x,y)=>x+y,0)/p,md=tp.reduce((x,y)=>x+Math.abs(y-mean),0)/p;return md===0?0:((c[idx].high+c[idx].low+c[idx].close)/3-mean)/(.015*md);};
 const warm=Math.max(cfg.slow||21,cfg.rsiPeriod||14,cfg.bandPeriod||20,cfg.channelPeriod||20,cfg.stochPeriod||14,cfg.cciPeriod||20,cfg.lookback||20,cfg.period||14,cfg.midPeriod||20,cfg.longPeriod||50,35);
 for(let i=warm;i<c.length-1;i++){
  if(cfg.kind==="ema-rsi-pullback"){
   // Trend-filtered pullback: signal only after RSI reclaims a mid-zone in the EMA trend.
   // Backtest enters at the next candle open and deducts the user-selected costR.
   const longLevel=cfg.longRsi||45,shortLevel=cfg.shortRsi||55;
   if(ef[i]>es[i]&&close[i]>es[i]&&rr[i-1]!==null&&rr[i]!==null&&rr[i-1]<=longLevel&&rr[i]>longLevel&&close[i]>c[i].open)s[i]=1;
   else if(ef[i]<es[i]&&close[i]<es[i]&&rr[i-1]!==null&&rr[i]!==null&&rr[i-1]>=shortLevel&&rr[i]<shortLevel&&close[i]<c[i].open)s[i]=-1;
  } else if(cfg.kind==="ema-trend"){
   if(ef[i]>es[i]&&close[i]>ef[i]&&ef[i-1]<=es[i-1])s[i]=1;
   else if(ef[i]<es[i]&&close[i]<ef[i]&&ef[i-1]>=es[i-1])s[i]=-1;
  } else if(cfg.kind==="donchian"){
   let hi=-Infinity,lo=Infinity;for(let j=i-cfg.lookback;j<i;j++){hi=Math.max(hi,c[j].high);lo=Math.min(lo,c[j].low);}
   if(close[i]>hi)s[i]=1;else if(close[i]<lo)s[i]=-1;
  } else if(cfg.kind==="rsi-reversion"){
   if(rr[i]<cfg.lower&&close[i]>close[i-1])s[i]=1;
   else if(rr[i]>cfg.upper&&close[i]<close[i-1])s[i]=-1;
  } else if(cfg.kind==="trend-pullback"){
   if(ef[i]>es[i]&&close[i-1]<ef[i-1]&&close[i]>ef[i])s[i]=1;
   else if(ef[i]<es[i]&&close[i-1]>ef[i-1]&&close[i]<ef[i])s[i]=-1;
  } else if(cfg.kind==="bollinger-reversion"){
   const p=cfg.bandPeriod||20,window=close.slice(i-p+1,i+1),mean=window.reduce((a,b)=>a+b,0)/p;
   const sd=Math.sqrt(window.reduce((a,b)=>a+(b-mean)**2,0)/p),upper=mean+cfg.bandDev*sd,lower=mean-cfg.bandDev*sd;
   if(close[i-1]<lower&&close[i]>close[i-1])s[i]=1;
   else if(close[i-1]>upper&&close[i]<close[i-1])s[i]=-1;
  } else if(cfg.kind==="macd-momentum"){
   if(macdLine[i]!==null&&macdSignal[i]!==null&&macdLine[i-1]!==null&&macdSignal[i-1]!==null){
    if(macdLine[i]>macdSignal[i]&&macdLine[i-1]<=macdSignal[i-1])s[i]=1;
    else if(macdLine[i]<macdSignal[i]&&macdLine[i-1]>=macdSignal[i-1])s[i]=-1;
   }
  } else if(cfg.kind==="keltner-breakout"){
   const mid=channelEma[i],prevMid=channelEma[i-1],band=(aa[i]||0)*(cfg.channelMult||1.5),prevBand=(aa[i-1]||0)*(cfg.channelMult||1.5);
   if(mid!==null&&prevMid!==null&&close[i]>mid+band&&close[i-1]<=prevMid+prevBand)s[i]=1;
   else if(mid!==null&&prevMid!==null&&close[i]<mid-band&&close[i-1]>=prevMid-prevBand)s[i]=-1;
  } else if(cfg.kind==="stochastic-reversion"){
   const k=stochasticAt(i,cfg.stochPeriod||14),prevK=stochasticAt(i-1,cfg.stochPeriod||14);
   if(k!==null&&prevK!==null&&prevK<cfg.lower&&k>prevK)s[i]=1;
   else if(k!==null&&prevK!==null&&prevK>cfg.upper&&k<prevK)s[i]=-1;
  } else if(cfg.kind==="stochastic-cross-reversion"){
   // New entry variant: require %K to cross back through the extreme threshold.
   // Optional EMA-trend or candle-body confirmation is tested as a separate configuration.
   const k=stochasticAt(i,cfg.stochPeriod||14),prevK=stochasticAt(i-1,cfg.stochPeriod||14);
   const longCross=k!==null&&prevK!==null&&prevK<cfg.lower&&k>=cfg.lower;
   const shortCross=k!==null&&prevK!==null&&prevK>cfg.upper&&k<=cfg.upper;
   const mode=cfg.filterMode||"cross";
   const longAllowed=mode==="ema-trend"?ef[i]>es[i]:mode==="candle-confirm"?close[i]>c[i].open:true;
   const shortAllowed=mode==="ema-trend"?ef[i]<es[i]:mode==="candle-confirm"?close[i]<c[i].open:true;
   if(longCross&&longAllowed)s[i]=1;
   else if(shortCross&&shortAllowed)s[i]=-1;
  } else if(cfg.kind==="cci-reversion"){
   const v=cciAt(i,cfg.cciPeriod||20),prevV=cciAt(i-1,cfg.cciPeriod||20);
   if(v!==null&&prevV!==null&&prevV< -cfg.cciLevel&&v> -cfg.cciLevel)s[i]=1;
   else if(v!==null&&prevV!==null&&prevV>cfg.cciLevel&&v<cfg.cciLevel)s[i]=-1;
  } else if(cfg.kind==="adx-trend"){
   const a=adxAt(i,cfg.period||14),prev=adxAt(i-1,cfg.period||14),up=c[i].high-c[i-1].high,dn=c[i-1].low-c[i].low;
   if(a!==null&&prev!==null&&a>cfg.threshold&&a>=prev&&up>dn&&up>0)s[i]=1;
   else if(a!==null&&prev!==null&&a>cfg.threshold&&a>=prev&&dn>up&&dn>0)s[i]=-1;
  } else if(cfg.kind==="ichimoku"){
   const z=ichimoku(i,cfg.period||9),p=ichimoku(i-1,cfg.period||9);
   if(z.conversion!==null&&z.base!==null&&p.conversion!==null&&p.base!==null&&z.conversion>z.base&&p.conversion<=p.base&&close[i]>z.span)s[i]=1;
   else if(z.conversion!==null&&z.base!==null&&p.conversion!==null&&p.base!==null&&z.conversion<z.base&&p.conversion>=p.base&&close[i]<z.span)s[i]=-1;
  } else if(cfg.kind==="sr-retest"){
   const r=rollingRange(i-1,cfg.lookback||20),tol=(aa[i]||0)*(cfg.tolerance||0.25);
   if(c[i-1].close>r.hi&&c[i].low<=r.hi+tol&&close[i]>r.hi)s[i]=1;
   else if(c[i-1].close<r.lo&&c[i].high>=r.lo-tol&&close[i]<r.lo)s[i]=-1;
  } else if(cfg.kind==="atr-breakout"){
   const mult=cfg.atrMult||1;
   if(close[i]>close[i-1]+(aa[i-1]||0)*mult)s[i]=1;
   else if(close[i]<close[i-1]-(aa[i-1]||0)*mult)s[i]=-1;
  } else if(cfg.kind==="candle-reversal"){
   const b=c[i],p=c[i-1],body=Math.abs(b.close-b.open),range=Math.max(1e-9,b.high-b.low);
   const bullEngulf=b.close>b.open&&p.close<p.open&&b.open<=p.close&&b.close>=p.open;
   const bearEngulf=b.close<b.open&&p.close>p.open&&b.open>=p.close&&b.close<=p.open;
   if((bullEngulf||((Math.min(b.open,b.close)-b.low)/range>0.65&&body/range<0.4))&&rr[i]<55)s[i]=1;
   else if((bearEngulf||((b.high-Math.max(b.open,b.close))/range>0.65&&body/range<0.4))&&rr[i]>45)s[i]=-1;
  } else if(cfg.kind==="inside-bar"){
   const mother=c[i-2],inside=c[i-1],b=c[i];
   if(inside.high<mother.high&&inside.low>mother.low){if(close[i]>mother.high)s[i]=1;else if(close[i]<mother.low)s[i]=-1;}
  } else if(cfg.kind==="roc-momentum"){
   const v=rocAt(i,cfg.period||10),prev=rocAt(i-1,cfg.period||10);
   if(v!==null&&prev!==null&&v>cfg.threshold&&prev<=cfg.threshold)s[i]=1;
   else if(v!==null&&prev!==null&&v< -cfg.threshold&&prev>=-cfg.threshold)s[i]=-1;
  } else if(cfg.kind==="williams-reversion"){
   const v=williamsAt(i,cfg.period||14),prev=williamsAt(i-1,cfg.period||14);
   if(v!==null&&prev!==null&&prev<cfg.lower&&v>prev)s[i]=1;
   else if(v!==null&&prev!==null&&prev>cfg.upper&&v<prev)s[i]=-1;
  } else if(cfg.kind==="triple-ema"){
   const mid=emaMid[i],long=emaLong[i],prevMid=emaMid[i-1],prevLong=emaLong[i-1];
   if(ef[i]>mid&&mid>long&&close[i]>ef[i]&&!(ef[i-1]>prevMid&&prevMid>prevLong))s[i]=1;
   else if(ef[i]<mid&&mid<long&&close[i]<ef[i]&&!(ef[i-1]<prevMid&&prevMid<prevLong))s[i]=-1;
  } else if(cfg.kind==="fib-pullback"){
   const r=rollingRange(i,cfg.lookback||30),span=r.hi-r.lo;
   if(span>0&&ef[i]>es[i]&&close[i]>es[i]&&close[i]<=r.hi-span*0.382&&close[i]>=r.hi-span*0.618&&close[i]>close[i-1])s[i]=1;
   else if(span>0&&ef[i]<es[i]&&close[i]<es[i]&&close[i]>=r.lo+span*0.382&&close[i]<=r.lo+span*0.618&&close[i]<close[i-1])s[i]=-1;
  } else if(cfg.kind==="supertrend"){
   const band=(aa[i]||0)*(cfg.atrMult||2),prevBand=(aa[i-1]||0)*(cfg.atrMult||2);
   if(close[i]>channelEma[i]+band&&close[i-1]<=channelEma[i-1]+prevBand)s[i]=1;
   else if(close[i]<channelEma[i]-band&&close[i-1]>=channelEma[i-1]-prevBand)s[i]=-1;
  } else if(cfg.kind==="liquidity-sweep"){
   // Prior-bar range only: wick takes liquidity beyond a prior swing then closes back inside.
   const r=rollingRange(i,cfg.lookback||10),b=c[i],bull=b.low<r.lo&&b.close>r.lo&&b.close>b.open,bear=b.high>r.hi&&b.close<r.hi&&b.close<b.open;
   if(bull)s[i]=1;else if(bear)s[i]=-1;
  } else if(cfg.kind==="compression-breakout"){
   // Breakout after a compact prior range; uses the immediately preceding lookback bars and excludes the signal candle.
   const r=rollingRange(i,cfg.lookback||8),width=r.hi-r.lo,compressed=aa[i-1]>0&&width<=(aa[i-1]||0)*(cfg.maxRangeAtr||2.5);
   if(compressed&&close[i]>r.hi&&close[i]>c[i].open)s[i]=1;
   else if(compressed&&close[i]<r.lo&&close[i]<c[i].open)s[i]=-1;
  } else if(cfg.kind==="ema-atr-pullback"){
   // Trend-aligned EMA reclaim after a touch; original GOLD-001 configuration remains untouched.
   if(ef[i]>es[i]&&c[i].low<=ef[i]&&close[i]>ef[i]&&close[i]>c[i].open)s[i]=1;
   else if(ef[i]<es[i]&&c[i].high>=ef[i]&&close[i]<ef[i]&&close[i]<c[i].open)s[i]=-1;
  } else if(cfg.kind==="failed-breakout"){
   const r=rollingRange(i,cfg.lookback||10),b=c[i],range=Math.max(1e-9,b.high-b.low);
   const lowerWick=(Math.min(b.open,b.close)-b.low)/range,upperWick=(b.high-Math.max(b.open,b.close))/range;
   if(b.low<r.lo&&b.close>r.lo&&b.close>b.open&&lowerWick>=(cfg.wickRatio||0.35))s[i]=1;
   else if(b.high>r.hi&&b.close<r.hi&&b.close<b.open&&upperWick>=(cfg.wickRatio||0.35))s[i]=-1;
  } else if(cfg.kind==="volatility-expansion"){
   const r=rollingRange(i,cfg.lookback||8),prevAtr=aa[i-1]||0;
   const tr=Math.max(c[i].high-c[i].low,Math.abs(c[i].high-c[i-1].close),Math.abs(c[i].low-c[i-1].close));
   if(prevAtr>0&&tr>=prevAtr*(cfg.expansion||1.25)&&close[i]>r.hi&&close[i]>c[i].open)s[i]=1;
   else if(prevAtr>0&&tr>=prevAtr*(cfg.expansion||1.25)&&close[i]<r.lo&&close[i]<c[i].open)s[i]=-1;
  } else if(cfg.kind==="sweep-mss"){
   const micro=rollingRange(i,3),b=c[i];let sweptLow=false,sweptHigh=false;
   for(let k=Math.max(1,i-(cfg.confirmBars||3));k<i;k++){
    const prior=rollingRange(k,cfg.lookback||10);
    if(c[k].low<prior.lo&&c[k].close>prior.lo)sweptLow=true;
    if(c[k].high>prior.hi&&c[k].close<prior.hi)sweptHigh=true;
   }
   if(sweptLow&&close[i]>micro.hi&&close[i]>b.open)s[i]=1;
   else if(sweptHigh&&close[i]<micro.lo&&close[i]<b.open)s[i]=-1;
  } else if(cfg.kind==="range-retest"){
   const prev=rollingRange(i-1,cfg.lookback||12),tol=(aa[i]||0)*(cfg.tolerance||0.2);
   if(c[i-1].close>prev.hi&&c[i].low<=prev.hi+tol&&close[i]>prev.hi&&close[i]>c[i].open)s[i]=1;
   else if(c[i-1].close<prev.lo&&c[i].high>=prev.lo-tol&&close[i]<prev.lo&&close[i]<c[i].open)s[i]=-1;
  }
 }
 return {s,aa};
}
function evaluate(c,cfg,start,end,costR=0){
 const {s,aa}=buildSignal(c,cfg),trades=[];let i=Math.max(start,cfg.slow||cfg.lookback||cfg.rsiPeriod||21,20);
 while(i<end-2){
  if(!s[i]||!aa[i]||aa[i]<=0){i++;continue;}
  const dir=s[i],entry=c[i+1].open,unit=aa[i]*cfg.sl,stop=entry-dir*unit,target=entry+dir*aa[i]*cfg.tp;let exit=entry,reason="TIME",j=i+1;
  for(;j<Math.min(end,i+1+cfg.horizon);j++){const bar=c[j],hitSL=dir===1?bar.low<=stop:bar.high>=stop,hitTP=dir===1?bar.high>=target:bar.low<=target;
   if(hitSL&&hitTP){exit=stop;reason="SL (same-bar ambiguity, conservative)";break;}
   if(hitSL){exit=stop;reason="SL";break;}if(hitTP){exit=target;reason="TP";break;}exit=bar.close;
  }
  const grossR=dir*(exit-entry)/unit,tradeCostR=costR&&typeof costR==="object"?((Math.max(0,Number(costR.spreadPrice)||0)+Math.max(0,Number(costR.slippagePrice)||0)+Math.max(0,Number(costR.commissionPrice)||0))/unit+Math.max(0,Number(costR.commissionR)||0)):Number(costR)||0,r=grossR-tradeCostR;trades.push({r,grossR,costR:tradeCostR,dir,entry,exit,reason,time:c[i+1].bar_time});i=Math.max(i+1,j);
 }
 const wins=trades.filter(t=>t.r>0).length,losses=trades.filter(t=>t.r<0).length;let grossWin=0,grossLoss=0,equity=0,peak=0,maxDD=0;
 for(const t of trades){equity+=t.r;peak=Math.max(peak,equity);maxDD=Math.max(maxDD,peak-equity);if(t.r>0)grossWin+=t.r;else if(t.r<0)grossLoss+=-t.r;}
 return {trades:trades.length,wins,losses,winRate:trades.length?wins/trades.length:0,netR:Number(equity.toFixed(2)),expectancyR:trades.length?Number((equity/trades.length).toFixed(3)):0,profitFactor:grossLoss?Number((grossWin/grossLoss).toFixed(2)):grossWin?99:0,maxDrawdownR:Number(maxDD.toFixed(2)),results:trades.slice(-20).map(t=>({time:t.time,r:Number(t.r.toFixed(2)),reason:t.reason}))};
}
function makeCandidates(){
 const out=[],riskProfiles=[{sl:1,tp:1.5,label:"SL1.0 / TP1.5"},{sl:1.5,tp:2.2,label:"SL1.5 / TP2.2"},{sl:2,tp:3,label:"SL2.0 / TP3.0"},{sl:1.5,tp:1.5,label:"SL1.5 / TP1.5"}];
 const add=(base,risk)=>out.push({...base,...risk,horizon:12,riskLabel:risk.label});
 for(const [fast,slow] of [[5,13],[8,21],[12,30],[20,50],[34,89]])for(const risk of riskProfiles)add({kind:"ema-trend",fast,slow},risk);
 // High reward/risk research track: target is at least 3R gross before costs.
 // ATR multipliers are set so TP/SL = 3.0; all results still use the user-selected costR.
 const highRR=[{sl:1,tp:3,label:"HIGH-RR SL1 ATR / TP3 ATR (3R)"},{sl:1.5,tp:4.5,label:"HIGH-RR SL1.5 ATR / TP4.5 ATR (3R)"},{sl:2,tp:6,label:"HIGH-RR SL2 ATR / TP6 ATR (3R)"}];
 for(const [fast,slow] of [[8,21],[12,30],[20,50]])for(const risk of highRR)add({kind:"ema-trend",fast,slow},risk);
 for(const [fast,slow] of [[20,50],[12,50]])for(const [rsiPeriod,longRsi,shortRsi] of [[14,45,55],[14,40,60],[21,45,55]])for(const risk of highRR)add({kind:"ema-rsi-pullback",fast,slow,rsiPeriod,longRsi,shortRsi},risk);
 for(const [fast,slow] of [[8,21],[12,30],[20,50]])for(const risk of highRR)add({kind:"trend-pullback",fast,slow},risk);
 for(const lookback of [10,20,30])for(const risk of highRR)add({kind:"donchian",fast:lookback,slow:lookback,lookback},risk);
 for(const atrMult of [0.75,1,1.5])for(const risk of highRR)add({kind:"atr-breakout",fast:14,slow:14,period:14,atrMult},risk);
 // New challenger: EMA trend + RSI pullback/reclaim; all variants use the same cost-aware tests.
 for(const [fast,slow] of [[20,50],[12,50]])for(const [rsiPeriod,longRsi,shortRsi] of [[14,45,55],[14,40,60],[21,45,55]])for(const risk of riskProfiles)add({kind:"ema-rsi-pullback",fast,slow,rsiPeriod,longRsi,shortRsi},risk);
 for(const lookback of [10,20,30,50])for(const risk of riskProfiles)add({kind:"donchian",fast:lookback,slow:lookback,lookback},risk);
 for(const period of [7,10,14,21])for(const [lower,upper] of [[25,75],[30,70],[35,65]])for(const risk of riskProfiles)add({kind:"rsi-reversion",fast:period,slow:period,rsiPeriod:period,lower,upper},risk);
 for(const [fast,slow] of [[5,13],[8,21],[12,30],[20,50],[34,89]])for(const risk of riskProfiles)add({kind:"trend-pullback",fast,slow},risk);
 // Additional families expand the search beyond the original 104 variants.
 for(const bandPeriod of [14,20,30])for(const bandDev of [1.8,2.0,2.2])for(const risk of riskProfiles)add({kind:"bollinger-reversion",fast:bandPeriod,slow:bandPeriod,bandPeriod,bandDev},risk);
 for(const [fast,slow] of [[8,21],[12,26],[16,35]])for(const risk of riskProfiles)add({kind:"macd-momentum",fast,slow,signalPeriod:9},risk);
 for(const channelPeriod of [14,20,30])for(const channelMult of [1.5])for(const risk of riskProfiles)add({kind:"keltner-breakout",fast:channelPeriod,slow:channelPeriod,channelPeriod,channelMult},risk);
 for(const stochPeriod of [9,14,21])for(const [lower,upper] of [[20,80],[25,75],[30,70]])for(const risk of riskProfiles)add({kind:"stochastic-reversion",fast:stochPeriod,slow:stochPeriod,stochPeriod,lower,upper},risk);
 for(const cciPeriod of [14,20,30])for(const cciLevel of [100,150,200])for(const risk of riskProfiles)add({kind:"cci-reversion",fast:cciPeriod,slow:cciPeriod,cciPeriod,cciLevel},risk);
 for(const period of [10,14,20])for(const threshold of [18,25])for(const risk of riskProfiles)add({kind:"adx-trend",fast:period,slow:period,period,threshold},risk);
 for(const period of [7,9,12])for(const risk of riskProfiles)add({kind:"ichimoku",fast:period,slow:period,period},risk);
 for(const lookback of [10,20,30])for(const risk of riskProfiles)add({kind:"sr-retest",fast:lookback,slow:lookback,lookback,tolerance:0.25},risk);
 for(const atrMult of [0.75,1,1.5])for(const risk of riskProfiles)add({kind:"atr-breakout",fast:14,slow:14,period:14,atrMult},risk);
 for(const risk of riskProfiles)add({kind:"candle-reversal",fast:14,slow:21},risk);
 for(const risk of riskProfiles)add({kind:"inside-bar",fast:14,slow:21},risk);
 for(const period of [5,10,14,20])for(const threshold of [0,0.1])for(const risk of riskProfiles)add({kind:"roc-momentum",fast:period,slow:period,period,threshold},risk);
 for(const period of [10,14,21])for(const [lower,upper] of [[-80,-20],[-85,-15]])for(const risk of riskProfiles)add({kind:"williams-reversion",fast:period,slow:period,period,lower,upper},risk);
 for(const [fast,midPeriod,longPeriod] of [[5,13,34],[8,21,50],[12,30,89]])for(const risk of riskProfiles)add({kind:"triple-ema",fast,slow:midPeriod,midPeriod,longPeriod},risk);
 for(const lookback of [20,30,50])for(const risk of riskProfiles)add({kind:"fib-pullback",fast:20,slow:50,lookback},risk);
 for(const atrMult of [1.5,2,2.5])for(const risk of riskProfiles)add({kind:"supertrend",fast:20,slow:20,channelPeriod:20,atrMult},risk);
 // Independent scalping challengers appended after existing candidates so GOLD-001 keeps its ID and config.
 const scalpRisk=[riskProfiles[0],riskProfiles[1],highRR[0]];
 for(const lookback of [5,8,12,20])for(const risk of scalpRisk)add({kind:"liquidity-sweep",fast:lookback,slow:lookback,lookback},risk);
 for(const lookback of [5,8,12])for(const maxRangeAtr of [2,2.5,3])for(const risk of scalpRisk)add({kind:"compression-breakout",fast:lookback,slow:lookback,lookback,maxRangeAtr},risk);
 for(const [fast,slow] of [[5,13],[8,21],[12,30],[20,50]])for(const risk of scalpRisk)add({kind:"ema-atr-pullback",fast,slow},risk);
 // New independent research families appended so existing candidate IDs/configurations stay unchanged.
 for(const lookback of [5,8,12,20])for(const wickRatio of [0.35,0.5])for(const risk of scalpRisk)add({kind:"failed-breakout",fast:lookback,slow:lookback,lookback,wickRatio},risk);
 for(const lookback of [5,8,12])for(const expansion of [1.15,1.35,1.6])for(const risk of scalpRisk)add({kind:"volatility-expansion",fast:lookback,slow:lookback,lookback,expansion},risk);
 for(const lookback of [5,8,12,20])for(const confirmBars of [2,3,4])for(const risk of scalpRisk)add({kind:"sweep-mss",fast:lookback,slow:lookback,lookback,confirmBars},risk);
 for(const lookback of [8,12,20])for(const tolerance of [0.15,0.25,0.4])for(const risk of scalpRisk)add({kind:"range-retest",fast:lookback,slow:lookback,lookback,tolerance},risk);
 // Expand stochastic reversion research while keeping all existing candidate IDs/configurations stable.
 // GOLD-265 uses a turning-point entry; these challengers require a cross back through the threshold.
 for(const stochPeriod of [9,14,21])
  for(const [lower,upper] of [[20,80],[25,75],[30,70],[35,65]])
   for(const filterMode of ["cross","ema-trend","candle-confirm"])
    for(const risk of riskProfiles)
     add({kind:"stochastic-cross-reversion",fast:20,slow:50,stochPeriod,lower,upper,filterMode},risk);
 return out;
}
module.exports=async(req,res)=>{
 if(req.method!=="GET")return send(res,405,{ok:false,error:"GET only"});
 const symbol=String(req.query.symbol||"XAUUSD-STD"),timeframe=String(req.query.timeframe||"M5");
 if(!ALLOWED.has(symbol)||!["M1","M5","M15","H1"].includes(timeframe))return send(res,400,{ok:false,error:"Gold XAUUSD-STD and M1/M5/M15/H1 only."});
 const root=String(process.env.SUPABASE_URL||"").trim().replace(/\/+$/,"").replace(/\/rest\/v1$/i,""),key=String(process.env.SUPABASE_SERVICE_ROLE_KEY||"").trim();
 if(!root||!key)return send(res,503,{ok:false,error:"Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel. The research engine needs stored candles."});
 try{
  const rows=[],pageSize=1000,maxCandles=Math.max(250,Math.min(50000,Number(req.query.limit)||50000));
  for(let offset=0;offset<maxCandles;offset+=pageSize){
   const take=Math.min(pageSize,maxCandles-offset),q=new URLSearchParams({select:"bar_time,open,high,low,close,source",symbol:"eq."+symbol,timeframe:"eq."+timeframe,source:"eq.mt5_bridge",order:"bar_time.desc",limit:String(take),offset:String(offset)});
   const upstream=await fetch(root+"/rest/v1/mt5_candles?"+q,{headers:{apikey:key,Authorization:"Bearer "+key,Prefer:"count=exact"}});
   if(!upstream.ok){const detail=await upstream.text();if(/source|column/i.test(detail))return send(res,503,{ok:false,error:"MT5 source tracking is not installed. Run supabase/mt5_candle_source.sql in the Supabase SQL Editor, then restart the MT5 history bridge.",upstream_status:upstream.status});return send(res,502,{ok:false,error:"Could not read paginated mt5_candles. Check the Supabase candle table.",upstream_status:upstream.status,offset});}
   const page=await upstream.json();if(!Array.isArray(page))return send(res,502,{ok:false,error:"Unexpected Supabase response while paging candles.",offset});
   rows.push(...page);if(page.length<take)break;
  }
  const c=rows.reverse().map(x=>({...x,open:+x.open,high:+x.high,low:+x.low,close:+x.close})).filter(x=>Number.isFinite(x.open)&&Number.isFinite(x.high)&&Number.isFinite(x.low)&&Number.isFinite(x.close)&&x.high>=x.low);
  if(c.length<250)return send(res,200,{ok:true,ready:false,symbol,timeframe,candleCount:c.length,minimumCandles:250,message:"Need at least 250 verified MT5 bridge candles before candidate screening. Keep the MT5 History Bridge running so it can collect broker candles."});
  const split=Math.floor(c.length*.7),configs=makeCandidates();
  // User-provided MT5 snapshot (2026-10-25): Bid 3996.94 / Ask 3997.22 = USD 0.28/oz. Market was closed; this is one observed snapshot, NOT a live or historical average. User can override with a fresh MT5 Bid/Ask difference.
  const spreadRaw=Number(req.query.spreadPrice),spreadPrice=Math.max(0,Math.min(10,Number.isFinite(spreadRaw)?spreadRaw:0.28));
  const slipRaw=Number(req.query.slippagePrice),slippagePrice=Math.max(0,Math.min(10,Number.isFinite(slipRaw)?slipRaw:0.05));
  const commissionRaw=Number(req.query.commissionR),commissionR=Math.max(0,Math.min(1,Number.isFinite(commissionRaw)?commissionRaw:0));
  const commissionPriceRaw=Number(req.query.commissionPrice),commissionPrice=Math.max(0,Math.min(10,Number.isFinite(commissionPriceRaw)?commissionPriceRaw:0));
  const costModel={spreadPrice,slippagePrice,commissionPrice,commissionR};
  const candidates=configs.map((cfg,n)=>{
   const train=evaluate(c,cfg,0,split,costModel),raw=evaluate(c,cfg,split,c.length),net=evaluate(c,cfg,split,c.length,costModel);
   const stress05=evaluate(c,cfg,split,c.length,{...costModel,slippagePrice:slippagePrice+0.05});
   const stress10=evaluate(c,cfg,split,c.length,{...costModel,slippagePrice:slippagePrice+0.10});
   // Chronological diagnostics within the final 30%; these are not independent tests.
   const holdoutSize=c.length-split,foldSize=Math.max(1,Math.floor(holdoutSize/3));
   const folds=[0,1,2].map(k=>{const start=split+k*foldSize,end=k===2?c.length:Math.min(c.length,split+(k+1)*foldSize);const m=evaluate(c,cfg,start,end,costModel);return {fold:k+1,candles:Math.max(0,end-start),trades:m.trades,netR:m.netR,expectancyR:m.expectancyR,profitFactor:m.profitFactor,maxDrawdownR:m.maxDrawdownR,positive:m.trades>0&&m.expectancyR>0};});
   const activeFolds=folds.filter(f=>f.trades>0),positiveFolds=activeFolds.filter(f=>f.positive).length;
   const foldNetR=Number(folds.reduce((sum,f)=>sum+f.netR,0).toFixed(2));
   const foldConsistency=activeFolds.length?positiveFolds/activeFolds.length:0;
   const robustTrain=train.trades>=30&&train.expectancyR>0&&train.profitFactor>1.05;
   const robustHoldout=net.trades>=30&&net.expectancyR>0&&net.profitFactor>1.1;
   const slippageStressPass=stress05.trades>=30&&stress05.expectancyR>0&&stress05.profitFactor>1.05;
   const drawdownAcceptable=net.netR>0&&net.maxDrawdownR<=Math.max(10,net.netR*2.5);
   // Do not pretend the fold check is meaningful until each slice has enough trades.
   const walkForwardInformative=activeFolds.length===3&&folds.every(f=>f.trades>=10);
   const walkForwardStable=!walkForwardInformative||(foldConsistency>=2/3&&foldNetR>0);
   const passed=robustTrain&&robustHoldout&&slippageStressPass&&drawdownAcceptable&&walkForwardStable;
   const scoreBase=net.trades>=15?net.expectancyR*Math.min(net.trades/50,1)-net.maxDrawdownR*.03:-999;
   const score=scoreBase+(walkForwardInformative?(foldConsistency-.5)*.12:0);
   const family=cfg.kind.replace(/-/g," ").replace(/\b\w/g,x=>x.toUpperCase());
   const params=cfg.kind==="adx-trend"?"ADX "+cfg.period+" · threshold "+cfg.threshold:cfg.kind==="ichimoku"?"Ichimoku "+cfg.period:cfg.kind==="sr-retest"?"S/R retest "+cfg.lookback:cfg.kind==="atr-breakout"?"ATR impulse "+cfg.atrMult:cfg.kind==="candle-reversal"?"Engulfing/pin-bar":cfg.kind==="inside-bar"?"Inside-bar breakout":cfg.kind==="roc-momentum"?"ROC "+cfg.period+" · "+cfg.threshold:cfg.kind==="williams-reversion"?"Williams %R "+cfg.period+" · "+cfg.lower+"/"+cfg.upper:cfg.kind==="triple-ema"?"EMA "+cfg.fast+"/"+cfg.midPeriod+"/"+cfg.longPeriod:cfg.kind==="fib-pullback"?"Fib pullback "+cfg.lookback:cfg.kind==="supertrend"?"ATR band "+cfg.atrMult:cfg.kind==="liquidity-sweep"?"Liquidity sweep "+cfg.lookback:cfg.kind==="compression-breakout"?"Range compression "+cfg.lookback+" · "+cfg.maxRangeAtr+" ATR":cfg.kind==="ema-atr-pullback"?"EMA reclaim "+cfg.fast+"/"+cfg.slow:cfg.kind==="failed-breakout"?"Failed breakout "+cfg.lookback+" · wick "+cfg.wickRatio:cfg.kind==="volatility-expansion"?"Volatility expansion "+cfg.lookback+" · "+cfg.expansion+" ATR":cfg.kind==="sweep-mss"?"Sweep + MSS "+cfg.lookback+" · confirm "+cfg.confirmBars:cfg.kind==="range-retest"?"Range retest "+cfg.lookback+" · tol "+cfg.tolerance+" ATR":cfg.kind==="donchian"?"Lookback "+cfg.lookback:cfg.kind==="rsi-reversion"?"RSI "+cfg.rsiPeriod+" · "+cfg.lower+"/"+cfg.upper:cfg.kind==="bollinger-reversion"?"BB "+cfg.bandPeriod+" · "+cfg.bandDev+"σ":cfg.kind==="macd-momentum"?"MACD "+cfg.fast+"/"+cfg.slow+"/"+cfg.signalPeriod:cfg.kind==="keltner-breakout"?"Keltner "+cfg.channelPeriod+" · "+cfg.channelMult+" ATR":cfg.kind==="stochastic-reversion"?"Stoch "+cfg.stochPeriod+" · "+cfg.lower+"/"+cfg.upper:cfg.kind==="stochastic-cross-reversion"?"Stoch cross "+cfg.stochPeriod+" · "+cfg.lower+"/"+cfg.upper+" · "+cfg.filterMode:cfg.kind==="cci-reversion"?"CCI "+cfg.cciPeriod+" · ±"+cfg.cciLevel:cfg.fast+"/"+cfg.slow;
   return {id:"GOLD-"+String(n+1).padStart(3,"0"),name:family+" · "+params+" · "+cfg.riskLabel,config:cfg,train:{trades:train.trades,winRate:train.winRate,netR:train.netR,expectancyR:train.expectancyR,profitFactor:train.profitFactor,maxDrawdownR:train.maxDrawdownR},holdout:{trades:raw.trades,winRate:raw.winRate,netR:raw.netR,expectancyR:raw.expectancyR,profitFactor:raw.profitFactor,maxDrawdownR:raw.maxDrawdownR},afterCosts:{trades:net.trades,winRate:net.winRate,netR:net.netR,expectancyR:net.expectancyR,profitFactor:net.profitFactor,maxDrawdownR:net.maxDrawdownR},costStress:{slippagePlus005:{netR:stress05.netR,expectancyR:stress05.expectancyR,profitFactor:stress05.profitFactor,maxDrawdownR:stress05.maxDrawdownR},slippagePlus010:{netR:stress10.netR,expectancyR:stress10.expectancyR,profitFactor:stress10.profitFactor,maxDrawdownR:stress10.maxDrawdownR}},walkForward:{folds,activeFolds:activeFolds.length,positiveFolds,consistency:Number(foldConsistency.toFixed(3)),netR:foldNetR,informative:walkForwardInformative,stable:walkForwardStable},checks:{development:robustTrain,holdout:robustHoldout,slippageStress:slippageStressPass,drawdown:drawdownAcceptable,walkForward:walkForwardStable},status:passed?"REVIEW CANDIDATE":"NOT PASSED",score:Number(score.toFixed(3)),recentTrades:net.results};
 });
  candidates.sort((a,b)=>Number(b.status==="REVIEW CANDIDATE")-Number(a.status==="REVIEW CANDIDATE")||b.score-a.score);
  const passedCount=candidates.filter(x=>x.status==="REVIEW CANDIDATE").length;
  return send(res,200,{ok:true,ready:true,symbol,timeframe,candleCount:c.length,trainCandles:split,holdoutCandles:c.length-split,generated:candidates.length,passedCount,costModel:{spreadPriceUSDPerOz:spreadPrice,slippagePriceUSDPerOzRoundTurn:slippagePrice,commissionR,commissionPriceUSDPerOzRoundTurn:commissionPrice,spreadSource:Number.isFinite(spreadRaw)?"User/UI-supplied spread input; verify it against a fresh MT5 Bid/Ask snapshot":"User-provided MT5 snapshot on 2026-10-25: Bid 3996.94, Ask 3997.22, spread USD 0.28/oz; market closed, not an average",accountAssumption:commissionPrice>0?"Manual commission estimate entered in USD/oz round turn":"Standard STP-style zero commission assumption; verify actual account type",warning:"Historical candle rows do not contain historical bid/ask spread, so this is a benchmark/override model, not a measured per-candle historical spread."},costStressScenarios:[{label:"Base (estimated 0.05 USD/oz round-turn slippage)",spreadPriceUSDPerOz:spreadPrice,slippagePriceUSDPerOzRoundTurn:slippagePrice},{label:"Stress: total slippage +0.05 USD/oz above zero (0.10 total if base is 0.05)",spreadPriceUSDPerOz:spreadPrice,slippagePriceUSDPerOzRoundTurn:slippagePrice+0.05},{label:"Stress: total slippage +0.10 USD/oz above zero (0.15 total if base is 0.05)",spreadPriceUSDPerOz:spreadPrice,slippagePriceUSDPerOzRoundTurn:slippagePrice+0.10}],method:"Expanded multi-family search across EMA trend, triple EMA, Donchian breakout, RSI reversion, trend pullback, Bollinger-band reversion, MACD momentum, Keltner ATR-channel breakout, Stochastic reversion, CCI reversion, ADX/DMI trend, Ichimoku, support/resistance retest, ATR impulse breakout, candlestick reversal, inside-bar breakout, ROC momentum, Williams %R reversion, Fibonacci pullback, ATR-band breakout, liquidity-sweep reversal, range-compression breakout, trend-aligned EMA reclaim, failed-breakout rejection, volatility-expansion breakout, sweep plus market-structure-shift confirmation, and range-breakout retest. Requires positive development expectancy and PF > 1.05, positive after-cost holdout expectancy and PF > 1.10, at least 30 trades in both development and holdout, bounded drawdown, and (when each of three holdout subperiods has at least 10 trades) positive combined subperiod R with at least two of three subperiods positive. These subperiods reuse the final holdout and are diagnostics, not independent untouched tests. First 70% development; final 30% holdout. Same-candle SL/TP collisions are scored as stop-loss. Costs are modeled per trade as (spread price + round-turn adverse slippage price + commission price per oz) divided by the ATR stop distance, plus optional commissionR. Default spread is USD 0.28/oz from the user-provided MT5 screenshot (Bid 3996.94 / Ask 3997.22 on 2026-10-25); market was closed, so this is one observed snapshot, not a live or historical average. Historical candle rows lack historical Bid/Ask. Commission and swap are not verified by this screenshot. Commission can be modeled as USD/oz round turn; a provisional RAW ECN conversion is USD 0.06/oz if the account charges USD 6 per 1.00 lot round turn and the contract is 100 oz/lot. Standard STP commission is listed as zero by VT Markets, with costs embedded in spread. Base slippage defaults to an estimated USD 0.05/oz adverse round-turn allowance (entry plus exit combined), not a measured VT Markets average; additional stress tests add USD 0.05 and USD 0.10/oz to this baseline, for total slippage assumptions of USD 0.10 and USD 0.15/oz round turn. Spread benchmark is USD 0.28/oz. These assumptions are provisional until measured from actual MT5 fills. Override spreadPrice with a measured MT5 Bid/Ask difference.",candidates,warning:"Expanded multi-family search increases multiple-testing/overfit risk. Walk-forward subperiods reuse the final holdout and are not independent tests. The holdout is not untouched if repeatedly used to select candidates. Any review candidate needs a fresh unseen period and real MT5 Bid/Ask spread history plus slippage checks; benchmark spread scenarios are not proof of profitability. Historical OHLC results are not proof of profitability. Research uses up to 50,000 verified MT5 bridge candles. No orders are sent.",walkForwardNote:"Each candidate includes three chronological subperiod diagnostics from the final 30%. When each subperiod has at least 10 trades, at least two must be profitable and combined net R must be positive. This is a modest stability check, not proof of robustness."});
 }catch(e){return send(res,502,{ok:false,error:"Candidate research failed. Check Vercel logs and Supabase setup."});}
};
