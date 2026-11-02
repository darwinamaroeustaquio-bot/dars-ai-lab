// MT5 broker economic-calendar reader. No external news provider is used.
function send(res,status,body){
  res.status(status);
  res.setHeader("Content-Type","application/json; charset=utf-8");
  res.setHeader("Cache-Control","no-store, max-age=0");
  return res.json(body);
}
module.exports=async(req,res)=>{
  if(req.method!=="GET"){res.setHeader("Allow","GET");return send(res,405,{ok:false,error:"Method not allowed"})}
  const root=String(process.env.SUPABASE_URL||"").trim().replace(/\/+$/,"").replace(/\/rest\/v1$/i,"");
  const key=String(process.env.SUPABASE_SERVICE_ROLE_KEY||"").trim();
  if(!root||!key)return send(res,503,{ok:false,status:"UNAVAILABLE",source:"MT5 broker calendar",error:"MT5 calendar storage is not configured."});
  const now=Date.now(),from=new Date(now-24*60*60*1000).toISOString(),to=new Date(now+14*24*60*60*1000).toISOString();
  const q=new URLSearchParams({select:"event_id,event_time,event_name,currency,importance,impact_type,actual_value,forecast_value,previous_value,received_at",currency:"eq.USD",and:"(event_time.gte."+from+",event_time.lte."+to+")"});
  q.set("order","event_time.asc");q.set("limit","300");
  try{
    const r=await fetch(root+"/rest/v1/mt5_news_events?"+q.toString(),{headers:{apikey:key,Authorization:"Bearer "+key,Accept:"application/json"}});
    if(!r.ok)return send(res,502,{ok:false,status:"UNAVAILABLE",source:"MT5 broker calendar",error:"Could not read MT5 calendar events from storage.",upstream_status:r.status});
    const rows=await r.json();
    const items=rows.map(x=>({eventId:x.event_id,title:x.event_name,seenAt:x.event_time,currency:x.currency,impact:x.importance,actual:x.actual_value,forecast:x.forecast_value,previous:x.previous_value,source:"MT5 broker calendar",receivedAt:x.received_at}));
    if(!items.length)return send(res,503,{ok:false,status:"UNAVAILABLE",source:"MT5 broker calendar",items:[],error:"No MT5 broker calendar events received yet. Keep the DARS MT5 History Bridge running and confirm the broker terminal supports Economic Calendar."});
    return send(res,200,{ok:true,status:"CONNECTED",updatedAt:new Date().toISOString(),source:"MT5 broker calendar",items,warning:"Calendar events are supplied by the connected MT5 broker terminal. Times are broker calendar timestamps; this is context, not a prediction or trade instruction."});
  }catch(_){return send(res,502,{ok:false,status:"UNAVAILABLE",source:"MT5 broker calendar",error:"Could not reach calendar storage."})}
};
