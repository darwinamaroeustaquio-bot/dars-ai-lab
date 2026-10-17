// Gold-only candidate generator and conservative OHLC backtest. Research only; never places orders.
const ALLOWED = new Set(["XAUUSD-STD","XAUUSD"]);
function send(res,status,body){res.status(status);res.setHeader("Content-Type","application/json; charset=utf-8");res.setHeader("Cache-Control","no-store, max-age=0");return res.json(body);}
function ema(a,p){const out=Array(a.length).fill(null);if(a.length<p)return out;let e=a.slice(0,p).reduce((x,y)=>x+y,0)/p;out[p-1]=e;const k=2/(p+1);for(let i=p;i<a.length;i++){e=a[i]*k+out[i-1]*(1-k);out[i]=e;}return out;}
function rsi(a,p=14){const o=Array(a.length).fill(null);for(let i=p;i<a.length;i++){let up=0,dn=0;for(let j=i-p+1;j<=i;j++){const d=a[j]-a[j-1];if(d>0)up+=d;else dn-=d;}o[i]=dn===0?(up===0?50:100):100-100/(1+up/dn);}return o;}
function atr(c,p=14){const o=Array(c.length).fill(null);for(let i=p;i<c.length;i++){let s=0;for(let j=i-p+1;j<=i;j++)s+=Math.max(c[j].high-c[j].low,Math.abs(c[j].high-c[j-1].close),Math.abs(c[j].low-c[j-1].close));o[i]=s/p;}return o;}
function buildSignal(c,cfg){
 const close=c.map(x=>x.close),ef=ema(close,cfg.fast||8),es=ema(close,cfg.slow||21),rr=rsi(close,cfg.rsiPeriod||14),aa=atr(c,14),s=Array(c.length).fill(0);
 const warm=Math.max(cfg.slow||21,cfg.rsiPeriod||14,20);
 for(let i=warm;i<c.length-1;i++){
  if(cfg.kind==="ema-trend"){
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
  const grossR=dir*(exit-entry)/unit,r=grossR-costR;trades.push({r,grossR,dir,entry,exit,reason,time:c[i+1].bar_time});i=Math.max(i+1,j);
 }
 const wins=trades.filter(t=>t.r>0).length,losses=trades.filter(t=>t.r<0).length;let grossWin=0,grossLoss=0,equity=0,peak=0,maxDD=0;
 for(const t of trades){equity+=t.r;peak=Math.max(peak,equity);maxDD=Math.max(maxDD,peak-equity);if(t.r>0)grossWin+=t.r;else if(t.r<0)grossLoss+=-t.r;}
 return {trades:trades.length,wins,losses,winRate:trades.length?wins/trades.length:0,netR:Number(equity.toFixed(2)),expectancyR:trades.length?Number((equity/trades.length).toFixed(3)):0,profitFactor:grossLoss?Number((grossWin/grossLoss).toFixed(2)):grossWin?99:0,maxDrawdownR:Number(maxDD.toFixed(2)),results:trades.slice(-20).map(t=>({time:t.time,r:Number(t.r.toFixed(2)),reason:t.reason}))};
}
function makeCandidates(){
 const out=[],riskProfiles=[{sl:1,tp:1.5,label:"SL1.0 / TP1.5"},{sl:1.5,tp:2.2,label:"SL1.5 / TP2.2"},{sl:2,tp:3,label:"SL2.0 / TP3.0"},{sl:1.5,tp:1.5,label:"SL1.5 / TP1.5"}];
 const add=(base,risk)=>out.push({...base,...risk,horizon:12,riskLabel:risk.label});
 for(const [fast,slow] of [[5,13],[8,21],[12,30],[20,50],[34,89]])for(const risk of riskProfiles)add({kind:"ema-trend",fast,slow},risk);
 for(const lookback of [10,20,30,50])for(const risk of riskProfiles)add({kind:"donchian",fast:lookback,slow:lookback,lookback},risk);
 for(const period of [7,10,14,21])for(const [lower,upper] of [[25,75],[30,70],[35,65]])for(const risk of riskProfiles)add({kind:"rsi-reversion",fast:period,slow:period,rsiPeriod:period,lower,upper},risk);
 for(const [fast,slow] of [[5,13],[8,21],[12,30],[20,50],[34,89]])for(const risk of riskProfiles)add({kind:"trend-pullback",fast,slow},risk);
 return out;
}
module.exports=async(req,res)=>{
 if(req.method!=="GET")return send(res,405,{ok:false,error:"GET only"});
 const symbol=String(req.query.symbol||"XAUUSD-STD"),timeframe=String(req.query.timeframe||"M5");
 if(!ALLOWED.has(symbol)||!["M5","M15","H1"].includes(timeframe))return send(res,400,{ok:false,error:"Gold XAUUSD-STD and M5/M15/H1 only."});
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
  const split=Math.floor(c.length*.7),configs=makeCandidates(),costRaw=Number(req.query.costR),costR=Math.max(0,Math.min(1,Number.isFinite(costRaw)?costRaw:0.1));
  const candidates=configs.map((cfg,n)=>{
   const train=evaluate(c,cfg,0,split),raw=evaluate(c,cfg,split,c.length),net=evaluate(c,cfg,split,c.length,costR);
   const robustTrain=train.trades>=30&&train.expectancyR>0&&train.profitFactor>1.05;
   const robustHoldout=net.trades>=30&&net.expectancyR>0&&net.profitFactor>1.1;
   const drawdownAcceptable=net.netR>0&&net.maxDrawdownR<=Math.max(10,net.netR*2.5);
   const passed=robustTrain&&robustHoldout&&drawdownAcceptable;
   const score=net.trades>=15?net.expectancyR*Math.min(net.trades/50,1)-net.maxDrawdownR*.03:-999;
   const family=cfg.kind.replace(/-/g," ").replace(/\b\w/g,x=>x.toUpperCase());
   const params=cfg.kind==="donchian"?"Lookback "+cfg.lookback:cfg.kind==="rsi-reversion"?"RSI "+cfg.rsiPeriod+" · "+cfg.lower+"/"+cfg.upper:cfg.fast+"/"+cfg.slow;
   return {id:"GOLD-"+String(n+1).padStart(3,"0"),name:family+" · "+params+" · "+cfg.riskLabel,config:cfg,train:{trades:train.trades,winRate:train.winRate,netR:train.netR,expectancyR:train.expectancyR,profitFactor:train.profitFactor,maxDrawdownR:train.maxDrawdownR},holdout:{trades:raw.trades,winRate:raw.winRate,netR:raw.netR,expectancyR:raw.expectancyR,profitFactor:raw.profitFactor,maxDrawdownR:raw.maxDrawdownR},afterCosts:{trades:net.trades,winRate:net.winRate,netR:net.netR,expectancyR:net.expectancyR,profitFactor:net.profitFactor,maxDrawdownR:net.maxDrawdownR},checks:{development:robustTrain,holdout:robustHoldout,drawdown:drawdownAcceptable},status:passed?"REVIEW CANDIDATE":"NOT PASSED",score:Number(score.toFixed(3)),recentTrades:net.results};
  });
  candidates.sort((a,b)=>Number(b.status==="REVIEW CANDIDATE")-Number(a.status==="REVIEW CANDIDATE")||b.score-a.score);
  const passedCount=candidates.filter(x=>x.status==="REVIEW CANDIDATE").length;
  return send(res,200,{ok:true,ready:true,symbol,timeframe,candleCount:c.length,trainCandles:split,holdoutCandles:c.length-split,generated:candidates.length,passedCount,costAssumptionR:costR,method:"Expanded 104-variant search: 20 EMA trend, 16 Donchian lookback, 48 RSI period/threshold, and 20 trend-pullback variants. A candidate must show positive development expectancy and PF > 1.05, plus positive after-cost holdout expectancy, PF > 1.10, at least 30 trades in both development and holdout, and bounded drawdown. First 70% development; final 30% holdout. Same-candle SL/TP collisions are scored as stop-loss. Costs are a user-entered R sensitivity assumption, not broker-calibrated.",candidates,warning:"Expanded search can increase multiple-testing/overfit risk. The holdout is not an untouched final test if repeatedly used to select candidates. Any review candidate needs a fresh unseen period and realistic VT Markets spread, commission, swap and slippage checks. Historical OHLC results are not proof of profitability. Research uses up to 50,000 verified MT5 bridge candles. No orders are sent."});
 }catch(e){return send(res,502,{ok:false,error:"Candidate research failed. Check Vercel logs and Supabase setup."});}
};
