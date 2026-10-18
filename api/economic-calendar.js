// Gold research calendar using the public Forex Factory weekly JSON feed.
// No paid API key required. Fail closed when the feed is unavailable or unusable.
function send(res, status, body) {
  res.status(status);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=300");
  return res.json(body);
}
const RELEVANT = /(CPI|consumer price|inflation|PCE|personal consumption|nonfarm|non-farm|payroll|employment situation|unemployment rate|FOMC|federal funds|interest rate|fed chair|powell|GDP|retail sales|PPI|producer price|ISM manufacturing|ISM services|jobless claims|JOLTS|core price|average hourly earnings|initial claims)/i;
module.exports = async (req, res) => {
  if (req.method !== "GET") { res.setHeader("Allow", "GET"); return send(res, 405, {ok:false,error:"Method not allowed"}); }
  const url = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";
  try {
    const upstream = await fetch(url, {
      headers: {"Accept":"application/json", "User-Agent":"DARS-AI-LAB-economic-calendar/1.0"},
      signal: AbortSignal.timeout(10000)
    });
    if (!upstream.ok) return send(res, 502, {ok:false,configured:true,source:"Forex Factory public weekly calendar",error:"Calendar feed unavailable (HTTP "+upstream.status+"). Entry guard must remain blocked until a fresh calendar loads."});
    const data = await upstream.json();
    if (!Array.isArray(data) || data.length === 0) return send(res, 502, {ok:false,configured:true,source:"Forex Factory public weekly calendar",error:"Calendar feed returned no usable events. Entry guard must remain blocked."});
    const now = Date.now();
    const events = data.filter(x => {
      const country = String(x.country || "").toUpperCase();
      const title = String(x.title || "");
      const time = Date.parse(String(x.date || ""));
      return country === "USD" && Number.isFinite(time) && RELEVANT.test(title);
    }).map(x => {
      const sourceTime = String(x.date || "");
      const time = Date.parse(sourceTime);
      const impactText = String(x.impact || "");
      const importance = /^high$/i.test(impactText) ? 3 : /^medium$/i.test(impactText) ? 2 : /^low$/i.test(impactText) ? 1 : 0;
      return {
        id: [x.country, x.title, sourceTime].join("-"),
        event: String(x.title || "U.S. economic release"),
        category: "U.S. economic indicator",
        country: "United States",
        currency: "USD",
        sourceTime,
        utc: new Date(time).toISOString(),
        actual: String(x.actual ?? ""),
        forecast: String(x.forecast ?? ""),
        previous: String(x.previous ?? ""),
        revised: "",
        importance,
        impact: impactText,
        updatedAt: "",
        source: "Forex Factory public weekly calendar",
        sourceUrl: "https://www.forexfactory.com/calendar",
        providerUrl: "https://www.forexfactory.com/calendar"
      };
    }).sort((a,b) => a.utc.localeCompare(b.utc)).slice(0,100);
    if (!events.length) return send(res, 502, {ok:false,configured:true,source:"Forex Factory public weekly calendar",error:"No relevant U.S. events could be verified from the weekly feed. Entry guard must remain blocked."});
    return send(res, 200, {
      ok:true,
      configured:true,
      source:"Forex Factory public weekly calendar",
      sourceUrl:"https://www.forexfactory.com/calendar",
      timezone:"Event timestamps supplied with timezone offsets and normalized to UTC; display in Asia/Manila",
      updatedAt:new Date().toISOString(),
      from:new Date(Math.min(...events.map(e=>Date.parse(e.utc)))).toISOString().slice(0,10),
      to:new Date(Math.max(...events.map(e=>Date.parse(e.utc)))).toISOString().slice(0,10),
      coverage:"Current week only",
      events,
      warning:"Free third-party weekly feed; it may omit events or change availability. Verify major releases against official sources. If this endpoint is stale or unavailable, do not allow paper entries."
    });
  } catch (error) {
    return send(res, 502, {ok:false,configured:true,source:"Forex Factory public weekly calendar",error:"Calendar feed temporarily unavailable or malformed. Entry guard must remain blocked."});
  }
};
