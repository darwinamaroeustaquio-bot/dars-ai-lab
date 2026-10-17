// Gold-only candidate generator and OHLC backtest. Research only; never places orders.
const ALLOWED = new Set(["XAUUSD-STD","XAUUSD"]);
function send(res,status,body){res.status(status);res.setHeader("Content-Type","application/json; charset=utf-8");res.setHeader("Cache-Control","no-store, max-age=0");return res.json(body);}
function ema(a,p){const out=Array(a.length).fill(null);if(a.length<p)return out;let e=a.slice(0,p).reduce((x,y)=>x+y,0)/p;out[p-1]=e;const k=2/(p+1);for(let i=p;i<a.length;i++){e=a[i]*k+out[i-1]*(1-k);out[i]=e;}return out;}
function rsi(a,p=14){const o=Array(a.length).fill(null);for(let i=p;i<a.length;i++){let up=0,dn=0;for(let j=i-p+1;j<=i;j++){const d=a[j]-a[j-1];if(d>0)up+=d;else dn-=d;}const rs=dn===0?100:up/dn;o[i]=100-100/(1+up/dn);}return o;}
function atr(c,p=14){const o=Array(c.length).fill(null);for(let i=p;i<c.length;i++){let s=0;for(let j=i-p+1;j<=i;j++)s+=Math.max(c[j].high-c[j].low,Math.abs(c[j].high-c[j-1].close),Math.abs(c[j].low-c[j-1].close));o[i]=s/p;}return o;}
function buildSignal(c,kind,fast,slow){const close=c.map(x=>x.close),ef=ema(close,fast),es=ema(close,slow),rr=rsi(close,14),aa=atr(c,14),s=Array(c.length).fill(0);
 for(let i=Math.max(slow,20);i<c.length-1;i++){
  if(kind==="ema-trend"){if(ef[i]>es[i]&&close[i]>ef[i]&&ef[i-1]<=es[i-1])s[i]=1;else if(ef[i]<es[i]&&close[i]<ef[i]&&ef[i-1]>=es[i-1])s[i]=-1;}
  if(kind==="donchian"){let hi=-Infinity,lo=Infinity;for(let j=i-slow;j<i;j++){hi=Math.max(hi,c[j].high);lo=Math.min(lo,c[j].low);}if(close[i]>hi)s[i]=1;else if(close[i]<lo)s[i]=-1;}
  if(kind==="rsi-reversion"){if(rr[i]<30&&close[i]>close[i-1])s[i]=1;else if(rr[i]>70&&close[i]<close[i-1])s[i]=-1;}
  if(kind==="trend-pullback"){if(ef[i]>es[i]&&close[i-1]<ef[i-1]&&close[i]>ef[i])s[i]=1;else if(ef[i]<es[i]&&close[i-1]>ef[i-1]&&close[i]<ef[i])s[i]=-1;}
 }
 return {s,aa};
}
function evaluate(c,cfg,start,end){const {s,aa}=buildSignal(c,cfg.kind,cfg.fast,cfg.slow);const trades=[];let i=Math.max(start,cfg.slow+20);
 while(i<end-2){if(!s[i]||!aa[i]||aa[i]<=0){i++;continue;}const dir=s[i],entry=c[i+1].open,unit=aa[i]*cfg.sl,stop=entry-dir*unit,target=entry+dir*aa[i]*cfg.tp;let exit=entry,reason="TIME",j=i+1;
  for(;j<Math.min(end,i+1+cfg.horizon);j++){const bar=c[j];const hitSL=dir===1?bar.low<=stop:bar.high>=stop;const hitTP=dir===1?bar.high>=target:bar.low<=target;if(hitSL&&hitTP){exit=stop;reason="SL (same-bar ambiguity, conservative)";break;}if(hitSL){exit=stop;reason="SL";break;}if(hitTP){exit=target;reason="TP";break;}exit=bar.close;}
  const r=dir*(exit-entry)/unit;trades.push({r,dir,entry,exit,reason,time:c[i+1].bar_time});i=Math.max(i+1,j);
 }
 const wins=trades.filter(t=>t.r>0).length,losses=trades.filter(t=>t.r<0).length;let grossWin=0,grossLoss=0,equity=0,peak=0,maxDD=0;for(const t of trades){equity+=t.r;peak=Math.max(peak,equity);maxDD=Math.max(maxDD,peak-equity);if(t.r>0)grossWin+=t.r;else grossLoss+=-t.r;}
 return {trades:trades.length,wins,losses,winRate:trades.length?wins/trades.length:0,netR:Number(equity.toFixed(2)),expectancyR:trades.length?Number((equity/trades.length).toFixed(3)):0,profitFactor:grossLoss?Number((grossWin/grossLoss).toFixed(2)):grossWin?99:0,maxDrawdownR:Number(maxDD.toFixed(2)),results:trades.slice(-20).map(t=>({time:t.time,r:Number(t.r.toFixed(2)),reason:t.reason}))};
}
module.exports=async(req,res)=>{
 if(req.method!=="GET")return send(res,405,{ok:false,error:"GET only"});
 const symbol=String(req.query.symbol||"XAUUSD-STD"),timeframe=String(req.query.timeframe||"M5");
 if(!ALLOWED.has(symbol)||!["M5","M15","H1"].includes(timeframe))return send(res,400,{ok:false,error:"Gold XAUUSD-STD and M5/M15/H1 only."});
 const root=String(process.env.SUPABASE_URL||"").trim().replace(/\/+$/,"").replace(/\/rest\/v1$/i,""),key=String(process.env.SUPABASE_SERVICE_ROLE_KEY||"").trim();
 if(!root||!key)return send(res,503,{ok:false,error:"Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel. The research engine needs stored candles."});
 try{
  // Supabase/PostgREST commonly caps each response at 1,000 rows. Page through
  // the table so research uses all available candles, not just the first page.
  const rows=[];
  const pageSize=1000;
  const maxCandles=Math.max(250,Math.min(50000,Number(req.query.limit)||50000));
  for(let offset=0;offset<maxCandles;offset+=pageSize){
   const take=Math.min(pageSize,maxCandles-offset);
   const q=new URLSearchParams({select:"bar_time,open,high,low,close",symbol:"eq."+symbol,timeframe:"eq."+timeframe,order:"bar_time.desc",limit:String(take),offset:String(offset)});
   const upstream=await fetch(root+"/rest/v1/mt5_candles?"+q,{headers:{apikey:key,Authorization:"Bearer "+key,Prefer:"count=exact"}});
   if(!upstream.ok)return send(res,502,{ok:false,error:"Could not read paginated mt5_candles. Check the Supabase candle table.",upstream_status:upstream.status,offset});
   const page=await upstream.json();
   if(!Array.isArray(page))return send(res,502,{ok:false,error:"Unexpected Supabase response while paging candles.",offset});
   rows.push(...page);
   if(page.length<take)break;
  }
  const c=rows.reverse().map(x=>({...x,open:+x.open,high:+x.high,low:+x.low,close:+x.close}));
  if(c.length<250)return send(res,200,{ok:true,ready:false,symbol,timeframe,candleCount:c.length,minimumCandles:250,message:"Need at least 250 stored candles before candidate screening. Import historical Gold candles through Twelve Data."});
  const split=Math.floor(c.length*.7),configs=[];
  for(const kind of ["ema-trend","donchian","rsi-reversion","trend-pullback"])for(const pair of [[8,21],[12,30],[20,50]])configs.push({kind,fast:pair[0],slow:pair[1],sl:1.5,tp:2.2,horizon:12});
  const candidates=configs.map((cfg,n)=>{const train=evaluate(c,cfg,0,split),test=evaluate(c,cfg,split,c.length);const score=test.trades>=15?test.expectancyR*Math.min(test.trades/30,1)-test.maxDrawdownR*.03:-999;return {id:"GOLD-"+String(n+1).padStart(2,"0"),name:cfg.kind.replace(/-/g," ").replace(/\b\w/g,x=>x.toUpperCase())+" · "+cfg.fast+"/"+cfg.slow,config:cfg,train:{trades:train.trades,winRate:train.winRate,netR:train.netR,profitFactor:train.profitFactor,maxDrawdownR:train.maxDrawdownR},holdout:{trades:test.trades,winRate:test.winRate,netR:test.netR,expectancyR:test.expectancyR,profitFactor:test.profitFactor,maxDrawdownR:test.maxDrawdownR},status:test.trades>=30&&test.expectancyR>0&&test.profitFactor>1.1?"REVIEW CANDIDATE":"NOT PASSED",score:Number(score.toFixed(3)),recentTrades:test.results};});
  candidates.sort((a,b)=>b.score-a.score);
  return send(res,200,{ok:true,ready:true,symbol,timeframe,candleCount:c.length,trainCandles:split,holdoutCandles:c.length-split,generated:candidates.length,method:"Fixed, transparent rule-family/parameter sweep. First 70% development; final 30% holdout. Same-candle SL/TP collisions are scored as stop-loss. Metrics are in R units and exclude real broker costs/slippage.",candidates,warning:"Historical OHLC simulation is not proof of profitability. Research loads up to 50,000 stored candles with pagination. Candle source quality, spread, slippage, and execution can materially change results. A candidate is for review only, not automatically an EA or a live trade."});
 }catch(e){return send(res,502,{ok:false,error:"Candidate research failed. Check Vercel logs and Supabase setup."});}
};