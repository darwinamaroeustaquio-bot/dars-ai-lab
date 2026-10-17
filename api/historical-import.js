// Import a bounded window of public Dukascopy historical XAUUSD candles into Supabase.
// Research data only; not VT Markets quotes and never sends orders.
const { getHistoricalRates } = require("dukascopy-node");
const TF = { M5:"m5", M15:"m15", H1:"h1" };
function send(res,status,body){res.status(status);res.setHeader("Content-Type","application/json; charset=utf-8");res.setHeader("Cache-Control","no-store, max-age=0");return res.json(body);}
module.exports=async(req,res)=>{
 if(req.method!=="POST")return send(res,405,{ok:false,error:"POST only"});
 const root=String(process.env.SUPABASE_URL||"").trim().replace(/\/+$/,"").replace(/\/rest\/v1$/i,""),key=String(process.env.SUPABASE_SERVICE_ROLE_KEY||"").trim();
 if(!root||!key)return send(res,503,{ok:false,error:"Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel first."});
 const body=req.body||{},timeframe=String(body.timeframe||"M5").toUpperCase();
 if(!TF[timeframe])return send(res,400,{ok:false,error:"Use M5, M15 or H1."});
 const now=new Date(),end=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()));
 // Use a timeframe-specific window so the import can reach the 250-candle screening minimum.
 const daysByTimeframe={M5:30,M15:60,H1:180};
 const days=daysByTimeframe[timeframe]||60;
 const start=new Date(end.getTime()-days*86400000);
 try{
  const rates=await getHistoricalRates({instrument:"xauusd",dates:{from:start,to:end},timeframe:TF[timeframe],format:"json",priceType:"bid",batchSize:5,pauseBetweenBatchesMs:1000});
  if(!Array.isArray(rates)||!rates.length)return send(res,502,{ok:false,error:"Dukascopy returned no historical candles for this range. Try again later."});
  const rows=rates.filter(x=>Number.isFinite(Number(x.timestamp))&&[x.open,x.high,x.low,x.close].every(v=>Number.isFinite(Number(v)))).map(x=>({symbol:"XAUUSD-STD",timeframe,bar_time:new Date(Number(x.timestamp)).toISOString(),open:Number(x.open),high:Number(x.high),low:Number(x.low),close:Number(x.close),tick_volume:Math.max(0,Math.trunc(Number(x.volume)||0)),received_at:new Date().toISOString()}));
  if(rows.length<250)return send(res,502,{ok:false,error:"Only "+rows.length+" valid candles were downloaded for "+timeframe+". At least 250 are required; try a longer timeframe window or retry later.",downloaded:rows.length,timeframe,from:start.toISOString(),to:end.toISOString()});
  let saved=0;
  for(let i=0;i<rows.length;i+=300){
   const batch=rows.slice(i,i+300);
   const u=await fetch(root+"/rest/v1/mt5_candles?on_conflict=symbol,timeframe,bar_time",{method:"POST",headers:{apikey:key,Authorization:"Bearer "+key,"Content-Type":"application/json",Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(batch)});
   if(!u.ok)return send(res,502,{ok:false,error:"Downloaded historical data but Supabase save failed.",upstream_status:u.status,saved_before_error:saved});
   saved+=batch.length;
  }
  return send(res,200,{ok:true,source:"Dukascopy historical XAUUSD BID candles",symbol:"XAUUSD-STD",timeframe,days,from:start.toISOString(),to:end.toISOString(),downloaded:rows.length,saved,minimumRequired:250,meetsMinimum:saved>=250,message:"Historical candles saved. This is proxy XAUUSD history, not VT Markets broker-specific pricing; validate later against VT Markets."});
 }catch(e){return send(res,502,{ok:false,error:"Historical import failed. Check Vercel function logs and try again later.",detail:String(e&&e.message||e).slice(0,240)});}
};