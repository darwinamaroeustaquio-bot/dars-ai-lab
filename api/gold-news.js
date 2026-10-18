// Public RSS-backed Gold/USD news context. No secrets or paid API required.
// Headlines are informational; keyword tags are heuristics, not an AI prediction.
const FEEDS = [
  "https://news.google.com/rss/search?q=gold+OR+XAUUSD+OR+Federal+Reserve+OR+US+inflation+OR+NFP&hl=en-US&gl=US&ceid=US:en",
  "https://news.google.com/rss/search?q=Federal+Reserve+interest+rates+OR+US+CPI+OR+PCE+inflation+OR+jobs+report&hl=en-US&gl=US&ceid=US:en"
];
function send(res,status,body){res.status(status);res.setHeader("Content-Type","application/json; charset=utf-8");res.setHeader("Cache-Control","s-maxage=300, stale-while-revalidate=600");return res.json(body)}
function decode(s){return String(s||"").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,"$1").replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n))).replace(/<[^>]*>/g,"").trim()}
function tag(title){
 const t=title.toLowerCase();
 const bullishGold=/(gold (surge|rall|rise|gain|jump|climb)|bullion (rise|gain|surge)|fed (cut|dovish)|rate cut|lower interest rates|dollar (falls|weakens|slips)|yields (fall|drop|slip)|inflation cools|cpi (slows|cool))/i.test(t);
 const bearishGold=/(gold (falls|drop|slump|sink|slide)|fed (hike|hawkish)|rate hike|higher interest rates|dollar (rises|strengthens|jumps)|yields (rise|jump|climb)|inflation heats|hotter-than-expected cpi)/i.test(t);
 const event=/(federal reserve|\bfed\b|\bcpi\b|\bpce\b|\bnfp\b|nonfarm payroll|jobs report|inflation|interest rate|fomc|powell|unemployment|treasury yields)/i.test(t);
 return {bias:bullishGold&&!bearishGold?"Potentially bullish gold":bearishGold&&!bullishGold?"Potentially bearish gold": "Mixed / unclear",impact:event?"Potential macro event":"General market news",confidence:bullishGold!==bearishGold?"Low · headline keywords only":"Low"};
}
module.exports=async(req,res)=>{
 if(req.method!=="GET"){res.setHeader("Allow","GET");return send(res,405,{ok:false,error:"Method not allowed"})}
 try{
  const results=await Promise.all(FEEDS.map(async url=>{const r=await fetch(url,{headers:{"User-Agent":"DarsAILab/1.0 news reader"},signal:AbortSignal.timeout(6500)});if(!r.ok)throw Error("RSS unavailable");return r.text()}));
  const items=[];
  for(const xml of results){
   const blocks=xml.match(/<item>[\s\S]*?<\/item>/g)||[];
   for(const block of blocks){
    const get=tag=>{const m=block.match(new RegExp("<"+tag+"[^>]*>([\\s\\S]*?)<\/"+tag+">","i"));return m?decode(m[1]):""};
    const title=get("title"),link=get("link"),pubDate=get("pubDate"),source=get("source");
    if(!title||!link)continue;
    const analysis=tag(title);items.push({title,link,publishedAt:pubDate?new Date(pubDate).toISOString():null,source:source||"Google News RSS",...analysis});
   }
  }
  const unique=[...new Map(items.map(x=>[x.title,x])).values()].sort((a,b)=>Date.parse(b.publishedAt||0)-Date.parse(a.publishedAt||0)).slice(0,15);
  return send(res,200,{ok:true,updatedAt:new Date().toISOString(),source:"Google News RSS",method:"headline keyword heuristics; not an AI forecast",items:unique,warning:"Headlines can be delayed or misleading. Verify event times with an official economic calendar. News tags do not guarantee price direction."});
 }catch(e){return send(res,502,{ok:false,error:"News feed temporarily unavailable.",details:"Retry later; paper trading does not depend on the news endpoint."})}
};