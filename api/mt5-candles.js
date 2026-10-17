// Read-only MT5 candle history bridge for Dars AI Lab.
// Requires the mt5_candles table created from sql/mt5_candles.sql.
const ALLOWED = new Set(["XAUUSD-STD", "XAUUSD"]);
const FRAMES = new Set(["M5", "M15", "H1"]);
function send(res, status, body) {
  res.status(status);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Bridge-Token");
  return res.json(body);
}
module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return send(res, 204, {});
  const root = String(process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "").replace(/\/rest\/v1$/i, "");
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!root || !key) return send(res, 503, { ok:false, error:"Server setup incomplete: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel." });
  const headers = { apikey:key, Authorization:"Bearer "+key, "Content-Type":"application/json" };
  if (req.method === "POST") {
    const expected = String(process.env.MT5_BRIDGE_TOKEN || "");
    const provided = String(req.headers["x-bridge-token"] || "");
    if (!expected || provided.length !== expected.length || provided !== expected) return send(res, 401, {ok:false,error:"Unauthorized bridge token."});
    const body = req.body || {};
    const symbol = String(body.symbol || "");
    if (!ALLOWED.has(symbol) || !body.frames || typeof body.frames !== "object") return send(res,400,{ok:false,error:"Invalid symbol or candle frames."});
    const rows = [];
    for (const [timeframe, candles] of Object.entries(body.frames)) {
      if (!FRAMES.has(timeframe) || !Array.isArray(candles)) return send(res,400,{ok:false,error:"Only M5, M15 and H1 frames are accepted."});
      if (candles.length > 100) return send(res,400,{ok:false,error:"Maximum 100 candles per timeframe."});
      for (const c of candles) {
        const t = Number(c.time), o=Number(c.open), h=Number(c.high), l=Number(c.low), close=Number(c.close), volume=Number(c.tick_volume || 0);
        if (!Number.isFinite(t)||t<=0||![o,h,l,close,volume].every(Number.isFinite)||h<Math.max(o,close,l)||l>Math.min(o,close,h)||l<=0) return send(res,400,{ok:false,error:"Invalid OHLC candle data."});
        rows.push({symbol,timeframe,bar_time:new Date(t*1000).toISOString(),open:o,high:h,low:l,close,tick_volume:Math.max(0,Math.trunc(volume)),received_at:new Date().toISOString()});
      }
    }
    if (!rows.length) return send(res,400,{ok:false,error:"No candle data received."});
    try {
      const upstream = await fetch(root+"/rest/v1/mt5_candles?on_conflict=symbol,timeframe,bar_time", {
        method:"POST", headers:{...headers,Prefer:"resolution=merge-duplicates,return=minimal"}, body:JSON.stringify(rows)
      });
      if (!upstream.ok) return send(res,502,{ok:false,error:"Candle storage failed. Run sql/mt5_candles.sql in Supabase SQL Editor.",upstream_status:upstream.status});
      return send(res,200,{ok:true,symbol,rows_saved:rows.length,received_at:new Date().toISOString()});
    } catch (_) { return send(res,502,{ok:false,error:"Could not reach candle storage."}); }
  }
  if (req.method === "GET") {
    const symbol=String(req.query.symbol||"XAUUSD-STD"), timeframe=String(req.query.timeframe||"M5");
    const limit=Math.min(200,Math.max(10,Number.parseInt(req.query.limit||"100",10)||100));
    if(!ALLOWED.has(symbol)||!FRAMES.has(timeframe)) return send(res,400,{ok:false,error:"Unsupported symbol or timeframe."});
    try {
      const q=new URLSearchParams({select:"symbol,timeframe,bar_time,open,high,low,close,tick_volume,received_at",symbol:"eq."+symbol,timeframe:"eq."+timeframe,order:"bar_time.desc",limit:String(limit)});
      const upstream=await fetch(root+"/rest/v1/mt5_candles?"+q.toString(),{headers:{apikey:key,Authorization:"Bearer "+key}});
      if(!upstream.ok) return send(res,502,{ok:false,error:"Could not read candle history. Check mt5_candles table.",upstream_status:upstream.status});
      const rows=await upstream.json();
      return send(res,200,{ok:true,symbol,timeframe,count:rows.length,candles:rows.reverse()});
    } catch(_){return send(res,502,{ok:false,error:"Could not reach candle storage."});}
  }
  res.setHeader("Allow","GET, POST, OPTIONS");
  return send(res,405,{ok:false,error:"Method not allowed."});
};
