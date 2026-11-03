// Authenticated MT5 Demo command bridge.
// GET: return the newest unexpired pending Robot setup.
// POST: mark a command EXECUTED or REJECTED after MT5 manual approval.
const crypto = require("crypto");
const ALLOWED = new Set(["XAUUSD-STD", "XAUUSD"]);

function send(res,status,body){
  res.status(status);
  res.setHeader("Content-Type","application/json; charset=utf-8");
  res.setHeader("Cache-Control","no-store, max-age=0");
  res.setHeader("Access-Control-Allow-Methods","GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","Content-Type, X-Bridge-Token");
  return res.status(status).json(body);
}
function authorized(req){
  const expected=String(process.env.MT5_BRIDGE_TOKEN||"");
  const supplied=String(req.headers["x-bridge-token"]||"");
  if(!expected||!supplied) return false;
  const a=Buffer.from(expected),b=Buffer.from(supplied);
  return a.length===b.length && crypto.timingSafeEqual(a,b);
}
function dbConfig(){
  const root=String(process.env.SUPABASE_URL||"").trim().replace(/\/+$/,"").replace(/\/rest\/v1$/i,"");
  const key=String(process.env.SUPABASE_SERVICE_ROLE_KEY||"").trim();
  return root&&key?{root,key}:null;
}
module.exports=async(req,res)=>{
  if(req.method==="OPTIONS") return send(res,204,{});
  if(!["GET","POST"].includes(req.method)) return send(res,405,{ok:false,error:"GET or POST only"});
  if(!authorized(req)) return send(res,401,{ok:false,error:"Unauthorized MT5 bridge token"});
  const cfg=dbConfig();
  if(!cfg) return send(res,503,{ok:false,error:"Server database configuration missing"});
  const headers={apikey:cfg.key,Authorization:"Bearer "+cfg.key,"Content-Type":"application/json"};
  try{
    if(req.method==="GET"){
      const symbol=String(req.query.symbol||"XAUUSD-STD").toUpperCase();
      if(!ALLOWED.has(symbol)) return send(res,400,{ok:false,error:"Unsupported symbol"});
      const q=new URLSearchParams({
        select:"command_id,symbol,side,entry,stop_loss,tp1,tp2,strategy,strategy_score,signal_bar_time,status,created_at,expires_at",
        symbol:"eq."+symbol,status:"eq.PENDING",expires_at:"gt."+new Date().toISOString(),
        order:"created_at.desc",limit:"1"
      });
      const r=await fetch(cfg.root+"/rest/v1/mt5_demo_execution_commands?"+q.toString(),{headers});
      if(!r.ok) return send(res,502,{ok:false,error:"Could not read pending Robot setup",upstream_status:r.status});
      const rows=await r.json();
      return send(res,200,{ok:true,connected:true,command:rows[0]||null,server_time:new Date().toISOString()});
    }
    const body=req.body||{};
    const commandId=String(body.command_id||"").trim();
    const status=String(body.status||"").toUpperCase();
    if(!commandId||!["EXECUTED","REJECTED"].includes(status))
      return send(res,400,{ok:false,error:"Expected command_id and status EXECUTED or REJECTED"});
    const note=String(body.execution_note||"").slice(0,240);
    const ticket=String(body.broker_order_ticket||"").slice(0,80);
    const lookup=await fetch(cfg.root+"/rest/v1/mt5_demo_execution_commands?"+new URLSearchParams({
      select:"command_id,status,expires_at",command_id:"eq."+commandId,limit:"1"
    }).toString(),{headers});
    if(!lookup.ok) return send(res,502,{ok:false,error:"Could not verify command state"});
    const rows=await lookup.json();
    if(!rows.length||rows[0].status!=="PENDING"||new Date(rows[0].expires_at).getTime()<=Date.now())
      return send(res,409,{ok:false,error:"Command missing, expired or already consumed"});
    const update=await fetch(cfg.root+"/rest/v1/mt5_demo_execution_commands?command_id=eq."+encodeURIComponent(commandId)+"&status=eq.PENDING",{
      method:"PATCH",headers:{...headers,Prefer:"return=representation"},
      body:JSON.stringify({status,broker_order_ticket:ticket||null,execution_note:note,updated_at:new Date().toISOString()})
    });
    if(!update.ok) return send(res,502,{ok:false,error:"Could not update command state",upstream_status:update.status});
    const changed=await update.json();
    if(!changed.length) return send(res,409,{ok:false,error:"Command was consumed by another terminal"});
    return send(res,200,{ok:true,command_id:commandId,status:changed[0].status});
  }catch(_){return send(res,502,{ok:false,error:"MT5 command bridge storage unavailable"});}
};
