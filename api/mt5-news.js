// Authenticated, read-only consumer + MT5 Economic Calendar uploader.
// The MT5 calendar is broker-provided; preserve provenance and never label it independently verified.
const ALLOWED = new Set(["XAUUSD-STD","XAUUSD"]);
function send(res,status,body){res.status(status);res.setHeader("Content-Type","application/json; charset=utf-8");res.setHeader("Cache-Control","no-store, max-age=0");res.setHeader("Access-Control-Allow-Origin","*");res.setHeader("Access-Control-Allow-Methods","GET, POST, OPTIONS");res.setHeader("Access-Control-Allow-Headers","Content-Type, X-Bridge-Token");return res.json(body);}
module.exports=async(req,res)=>{
 if(req.method==="OPTIONS") return send(res,204,{});
 const root=String(process.env.SUPABASE_URL||"").trim().replace(/\/+$/,"").replace(/\/rest\/v1$/i,"");
 const key=String(process.env.SUPABASE_SERVICE_ROLE_KEY||"").trim();
 if(!root||!key) return send(res,503,{ok:false,error:"Supabase server configuration is incomplete."});
 const headers={apikey:key,Authorization:"Bearer "+key,"Content-Type":"application/json"};
 if(req.method==="POST"){
  const expected=String(process.env.MT5_BRIDGE_TOKEN||""),provided=String(req.headers["x-bridge-token"]||"");
  if(!expected||provided.length!==expected.length||provided!==expected) return send(res,401,{ok:false,error:"Unauthorized bridge token."});
  const body=req.body||{},symbol=String(body.symbol||"").trim().toUpperCase(),events=body.events;
  if(!ALLOWED.has(symbol)||!Array.isArray(events)||events.length>2500) return send(res,400,{ok:false,error:"Invalid symbol or events array (maximum 2500)."});
  const rows=[];
  for(const e of events){
   const epoch=Number(e.event_time_utc_epoch),valueId=String(e.value_id||""),eventId=String(e.event_id||"");
   if(!valueId||!eventId||!Number.isFinite(epoch)||epoch<=0||!String(e.name||"").trim()) continue;
   const impact=String(e.importance||"").toLowerCase();
   if(!["high","medium","low"].includes(impact)) continue;
   const num=v=>v===null||v===undefined||v===""?null:(Number.isFinite(Number(v))?Number(v):null);
   rows.push({symbol,value_id:valueId,event_id:eventId,name:String(e.name).slice(0,300),currency:String(e.currency||"").slice(0,8),country_code:String(e.country_code||"").slice(0,8),importance:impact,event_time:new Date(epoch*1000).toISOString(),event_time_server:e.event_time_server||null,server_utc_offset_seconds:Number.isFinite(Number(e.server_utc_offset_seconds))?Math.trunc(Number(e.server_utc_offset_seconds)):null,actual:num(e.actual),forecast:num(e.forecast),previous:num(e.previous),revised_previous:num(e.revised_previous),source:"mt5_broker_calendar",received_at:new Date().toISOString()});
  }
  try{
   if(rows.length){
    const up=await fetch(root+"/rest/v1/mt5_news_events?on_conflict=symbol,value_id",{method:"POST",headers:{...headers,Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify(rows)});
    if(!up.ok) return send(res,502,{ok:false,error:"News event storage failed. Run supabase/mt5_news_calendar.sql.",upstream_status:up.status});
   }
   const sync={symbol,last_sync_at:new Date().toISOString(),event_count:rows.length,server_time:body.server_time||null,server_utc_offset_seconds:Number.isFinite(Number(body.server_utc_offset_seconds))?Math.trunc(Number(body.server_utc_offset_seconds)):null,source:"mt5_broker_calendar"};
   const sr=await fetch(root+"/rest/v1/mt5_news_sync?on_conflict=symbol",{method:"POST",headers:{...headers,Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify([sync])});
   if(!sr.ok) return send(res,502,{ok:false,error:"News sync heartbeat storage failed. Run supabase/mt5_news_calendar.sql.",upstream_status:sr.status});
   return send(res,200,{ok:true,symbol,events_received:rows.length,received_at:sync.last_sync_at,source:"MT5 broker calendar; not independently verified"});
  }catch(e){return send(res,502,{ok:false,error:"Could not reach Supabase news storage."});}
 }
 if(req.method==="GET"){
  const symbol=String(req.query.symbol||"XAUUSD-STD").trim().toUpperCase();
  if(!ALLOWED.has(symbol)) return send(res,400,{ok:false,error:"Unsupported symbol."});
  try{
   const qs=new URLSearchParams({select:"symbol,value_id,event_id,name,currency,country_code,importance,event_time,event_time_server,server_utc_offset_seconds,actual,forecast,previous,revised_previous,source,received_at",symbol:"eq."+symbol,order:"event_time.asc",limit:"2000"});
   if(req.query.from&&req.query.to) qs.set("and","(event_time.gte."+String(req.query.from)+",event_time.lte."+String(req.query.to)+")");
   else if(req.query.from) qs.set("event_time","gte."+String(req.query.from));
   else if(req.query.to) qs.set("event_time","lte."+String(req.query.to));
   const [er,sr]=await Promise.all([fetch(root+"/rest/v1/mt5_news_events?"+qs,{headers}),fetch(root+"/rest/v1/mt5_news_sync?"+new URLSearchParams({select:"symbol,last_sync_at,event_count,server_time,server_utc_offset_seconds,source",symbol:"eq."+symbol,limit:"1"}),{headers})]);
   if(!er.ok||!sr.ok) return send(res,502,{ok:false,error:"Could not read MT5 news tables. Run supabase/mt5_news_calendar.sql."});
   const events=await er.json(),syncRows=await sr.json(),sync=syncRows[0]||null,age=sync?Math.max(0,(Date.now()-Date.parse(sync.last_sync_at))/1000):null;
   return send(res,200,{ok:true,symbol,source:"MT5 broker calendar",status:age!==null&&age<=180?"CONNECTED":sync?"STALE":"UNAVAILABLE",verified:false,trust:"BROKER_FEED_ONLY",lastSyncAt:sync?.last_sync_at||null,ageSeconds:age===null?null:Math.round(age),lastSyncEventCount:sync?.event_count??0,events});
  }catch(e){return send(res,502,{ok:false,error:"Could not reach Supabase news storage."});}
 }
 res.setHeader("Allow","GET, POST, OPTIONS");return send(res,405,{ok:false,error:"Method not allowed."});
};
