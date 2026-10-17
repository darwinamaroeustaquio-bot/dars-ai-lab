// External historical Gold importer using Twelve Data; independent of MT5.
// Requires TWELVE_DATA_API_KEY, SUPABASE_URL, and SUPABASE_SERVICE_ROLE_KEY in Vercel.
// Research proxy prices only; not VT Markets broker-specific candles.
const FRAMES = {
  M5: { interval: "5min", chunkDays: 14 },
  M15: { interval: "15min", chunkDays: 30 },
  H1: { interval: "1h", chunkDays: 90 }
};
function send(res, status, body) {
  res.status(status);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  return res.json(body);
}
function dateOnly(d) { return d.toISOString().slice(0, 10); }
module.exports = async (req, res) => {
  if (req.method !== "POST") return send(res, 405, { ok:false, error:"POST only" });
  const root = String(process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "").replace(/\/rest\/v1$/i, "");
  const dbKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  const apiKey = String(process.env.TWELVE_DATA_API_KEY || "").trim();
  if (!root || !dbKey) return send(res, 503, { ok:false, error:"Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel." });
  if (!apiKey) return send(res, 503, { ok:false, error:"Set TWELVE_DATA_API_KEY in Vercel to enable this independent provider. Do not paste the key into chat." });
  const body = req.body || {};
  const timeframe = String(body.timeframe || "M5").toUpperCase();
  if (!FRAMES[timeframe]) return send(res, 400, { ok:false, error:"Use M5, M15, or H1." });
  const now = new Date();
  const to = body.to ? new Date(body.to) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const requestedFrom = body.from ? new Date(body.from) : new Date(to.getTime() - 365 * 86400000);
  if (!Number.isFinite(to.getTime()) || !Number.isFinite(requestedFrom.getTime()) || requestedFrom >= to) return send(res, 400, { ok:false, error:"Invalid from/to dates." });
  // Bound each serverless execution. Repeated calls with the returned nextFrom can walk back through years safely.
  const maxDays = FRAMES[timeframe].chunkDays;
  const chunkFrom = new Date(Math.max(requestedFrom.getTime(), to.getTime() - maxDays * 86400000));
  const symbol = String(body.symbol || "XAU/USD");
  try {
    const url = new URL("https://api.twelvedata.com/time_series");
    url.searchParams.set("symbol", symbol);
    url.searchParams.set("interval", FRAMES[timeframe].interval);
    url.searchParams.set("start_date", chunkFrom.toISOString().replace("T", " ").slice(0, 19));
    url.searchParams.set("end_date", to.toISOString().replace("T", " ").slice(0, 19));
    url.searchParams.set("outputsize", "5000");
    url.searchParams.set("apikey", apiKey);
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    const payload = await response.json();
    if (!response.ok || payload.status === "error" || !Array.isArray(payload.values)) {
      return send(res, 502, { ok:false, source:"Twelve Data", timeframe, requestedSymbol:symbol, providerStatus:response.status, providerMessage:String(payload.message || payload.code || "No values returned. Confirm that your plan supports this symbol and interval.").slice(0, 240), from:chunkFrom.toISOString(), to:to.toISOString() });
    }
    const seen = new Map();
    for (const v of payload.values) {
      const time = Date.parse(v.datetime);
      const open=Number(v.open), high=Number(v.high), low=Number(v.low), close=Number(v.close), volume=Number(v.volume || 0);
      if (!Number.isFinite(time) || ![open,high,low,close].every(Number.isFinite) || low<=0 || high<Math.max(open,close,low) || low>Math.min(open,close,high)) continue;
      const barTime = new Date(time).toISOString();
      seen.set(barTime, { symbol:"XAUUSD-STD", timeframe, bar_time:barTime, open, high, low, close, tick_volume:Math.max(0,Math.trunc(volume)), received_at:new Date().toISOString() });
    }
    const rows=[...seen.values()].sort((a,b)=>a.bar_time.localeCompare(b.bar_time));
    if (!rows.length) return send(res, 502, {ok:false,error:"Provider returned no valid candles.",source:"Twelve Data",timeframe,from:chunkFrom.toISOString(),to:to.toISOString(),providerMeta:payload.meta || null});
    let saved=0;
    for(let i=0;i<rows.length;i+=300){
      const batch=rows.slice(i,i+300);
      const out=await fetch(root+"/rest/v1/mt5_candles?on_conflict=symbol,timeframe,bar_time",{
        method:"POST",
        headers:{apikey:dbKey,Authorization:"Bearer "+dbKey,"Content-Type":"application/json",Prefer:"resolution=merge-duplicates,return=minimal"},
        body:JSON.stringify(batch)
      });
      if(!out.ok) return send(res,502,{ok:false,error:"Downloaded provider candles but Supabase save failed.",upstream_status:out.status,detail:(await out.text()).slice(0,250),saved_before_error:saved,downloaded:rows.length});
      saved+=batch.length;
    }
    const nextFrom = new Date(chunkFrom.getTime() - 1000);
    return send(res,200,{ok:true,source:"Twelve Data",requestedSymbol:symbol,storedSymbol:"XAUUSD-STD",timeframe,from:chunkFrom.toISOString(),to:to.toISOString(),downloaded:rows.length,saved,providerRows:payload.values.length,rangeComplete:chunkFrom.getTime()<=requestedFrom.getTime(),nextFrom:nextFrom.toISOString(),message:"Saved this bounded historical segment. To continue further back, repeat the request using nextFrom as the new to date and keep the same overall start date."});
  } catch (e) {
    return send(res,502,{ok:false,error:"External historical import failed.",detail:String(e && e.message || e).slice(0,250),timeframe});
  }
};