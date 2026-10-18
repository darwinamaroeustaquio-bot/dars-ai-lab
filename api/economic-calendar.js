// US macro economic calendar for Gold research. Requires a Trading Economics API key in Vercel.
function send(res, status, body) {
  res.status(status);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=300");
  return res.json(body);
}
function wallTimeToUtc(value, timeZone) {
  const m = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  const wall = Date.UTC(parts[0], parts[1]-1, parts[2], parts[3], parts[4], parts[5] || 0);
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone, year:"numeric", month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", second:"2-digit", hourCycle:"h23" });
  let guess = wall;
  for (let i=0;i<3;i++) {
    const p = Object.fromEntries(fmt.formatToParts(new Date(guess)).filter(x=>x.type!=="literal").map(x=>[x.type,Number(x.value)]));
    const asUtc = Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second);
    guess += wall - asUtc;
  }
  return new Date(guess).toISOString();
}
module.exports = async (req, res) => {
  if (req.method !== "GET") { res.setHeader("Allow","GET"); return send(res,405,{ok:false,error:"Method not allowed"}); }
  const key = String(process.env.TRADING_ECONOMICS_API_KEY || "").trim();
  if (!key) return send(res,503,{ok:false,configured:false,source:"Trading Economics",error:"Economic calendar not connected yet. Add TRADING_ECONOMICS_API_KEY in Vercel Environment Variables to enable verified provider data."});
  const now = new Date();
  const from = new Date(now.getTime()-2*86400000).toISOString().slice(0,10);
  const to = new Date(now.getTime()+14*86400000).toISOString().slice(0,10);
  const url = "https://api.tradingeconomics.com/calendar/country/united%20states/"+from+"/"+to+"?c="+encodeURIComponent(key)+"&f=json&values=true";
  try {
    const upstream = await fetch(url,{headers:{"Accept":"application/json"},signal:AbortSignal.timeout(10000)});
    if (!upstream.ok) return send(res,502,{ok:false,configured:true,source:"Trading Economics",error:"Calendar provider rejected the request (HTTP "+upstream.status+"). Check API access and key in Vercel."});
    const data = await upstream.json();
    if (!Array.isArray(data)) return send(res,502,{ok:false,configured:true,source:"Trading Economics",error:"Provider returned an unexpected response."});
    const relevant = data.filter(x => {
      const t = String(x.Event||x.Category||"");
      return /(CPI|consumer price|inflation|PCE|personal consumption|nonfarm|non-farm|payroll|employment situation|unemployment rate|FOMC|federal funds|interest rate decision|fed chair|powell|GDP|retail sales|PPI|producer price|ISM manufacturing|ISM services|jobless claims|JOLTS)/i.test(t);
    }).map(x => {
      const sourceTime = String(x.Date||"");
      return {
        id:String(x.CalendarId||x.Ticker||x.Event||sourceTime),
        event:String(x.Event||x.Category||"Economic release"),
        category:String(x.Category||""),
        country:String(x.Country||"United States"),
        sourceTime,
        utc:wallTimeToUtc(sourceTime,"America/New_York"),
        actual:String(x.Actual??""),
        forecast:String(x.Forecast??""),
        previous:String(x.Previous??""),
        revised:String(x.Revised??""),
        importance:Number(x.Importance)||0,
        dateSpan:String(x.DateSpan??""),
        updatedAt:String(x.LastUpdate||""),
        source:String(x.Source||""),
        sourceUrl:String(x.SourceURL||""),
        providerUrl:x.URL?("https://tradingeconomics.com"+String(x.URL)):"https://tradingeconomics.com/calendar"
      };
    }).sort((a,b)=>String(a.utc||a.sourceTime).localeCompare(String(b.utc||b.sourceTime))).slice(0,100);
    return send(res,200,{ok:true,configured:true,source:"Trading Economics",sourceUrl:"https://docs.tradingeconomics.com/economic_calendar/schema/",timezone:"America/New_York converted to Asia/Manila",updatedAt:new Date().toISOString(),from,to,events:relevant,warning:"Release schedules can change. Event times are interpreted in U.S. Eastern time and converted to Manila time. Check the original source before trading; calendar data is context, not a signal."});
  } catch (_) {
    return send(res,502,{ok:false,configured:true,source:"Trading Economics",error:"Calendar feed temporarily unavailable. Try refreshing later."});
  }
};
