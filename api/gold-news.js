// Real publisher headlines via Google News RSS; no API key required.
// Labels are simple keyword hints, not AI analysis or trade instructions.
function send(res,status,body){res.status(status);res.setHeader("Content-Type","application/json; charset=utf-8");res.setHeader("Cache-Control","s-maxage=180, stale-while-revalidate=300");return res.json(body)}
function decode(s){return String(s||"").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,"$1").replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&lt;/g,"<").replace(/&gt;/g,">").trim()}
function tag(title){
 const t=String(title||"").toLowerCase();
 const bull=/(gold (surge|rall|rise|gain|jump|climb)|bullion (rise|gain|surge)|fed (cut|dovish)|rate cut|lower interest rates|dollar (falls|weakens|slips)|yields (fall|drop|slip)|inflation cools|cpi (slows|cool))/i.test(t);
 const bear=/(gold (falls|drop|slump|sink|slide)|fed (hike|hawkish)|rate hike|higher interest rates|dollar (rises|strengthens|jumps)|yields (rise|jump|climb)|inflation heats|hotter-than-expected cpi)/i.test(t);
 const macro=/(federal reserve|\bfed\b|\bcpi\b|\bpce\b|\bnfp\b|nonfarm payroll|jobs report|inflation|interest rate|fomc|powell|unemployment|treasury yields|dollar|central bank)/i.test(t);
 return {bias:bull&&!bear?"Potentially bullish gold":bear&&!bull?"Potentially bearish gold":"Unclassified / mixed",impact:macro?"Macro-related headline (keyword tag)":"General market news",confidence:"Not assessed — headline alone is insufficient"};
}
function tagText(xml,name){const m=xml.match(new RegExp("<"+name+"(?:\\s[^>]*)?>([\\s\\S]*?)<\\/"+name+">","i"));return m?decode(m[1]):""}
module.exports=async(req,res)=>{
 if(req.method!=="GET"){res.setHeader("Allow","GET");return send(res,405,{ok:false,error:"Method not allowed"})}
 const searches=[
  {q:'gold price Federal Reserve dollar inflation',hl:"en-US",gl:"US",ceid:"US:en"},
  {q:'XAUUSD gold bullion market',hl:"en-US",gl:"US",ceid:"US:en"}
 ];
 const articles=[],errors=[];
 for(const s of searches){
  try{
   const url="https://news.google.com/rss/search?"+new URLSearchParams({q:s.q,hl:s.hl,gl:s.gl,ceid:s.ceid});
   const r=await fetch(url,{headers:{"User-Agent":"Mozilla/5.0 (compatible; DarsAILab/1.0)","Accept":"application/rss+xml, application/xml, text/xml"},signal:AbortSignal.timeout(6500)});
   if(!r.ok){errors.push("RSS provider HTTP "+r.status);continue}
   const xml=await r.text();
   if(!/<rss|<feed/i.test(xml)){errors.push("RSS provider returned unusable content");continue}
   const blocks=[...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].map(m=>m[1]);
   for(const b of blocks){
    const title=tagText(b,"title"), link=tagText(b,"link"), pub=tagText(b,"pubDate"), source=tagText(b,"source");
    if(!title||!/^https?:\/\//i.test(link))continue;
    articles.push({title,link,seenAt:pub&&Number.isFinite(Date.parse(pub))?new Date(pub).toISOString():null,source:source||"Publisher via Google News RSS",language:"English",...tag(title)});
   }
  }catch(e){errors.push(e&&e.name==="TimeoutError"?"RSS provider timeout":"RSS provider request failed")}
 }
 const unique=[...new Map(articles.map(a=>[a.link,a])).values()].sort((a,b)=>Date.parse(b.seenAt||0)-Date.parse(a.seenAt||0)).slice(0,25);
 if(!unique.length)return send(res,502,{ok:false,error:"Real-news feed temporarily unavailable.",details:"The public RSS provider did not return usable publisher headlines. Refresh later; new paper entries remain blocked while required feeds are unavailable.",providerErrors:[...new Set(errors)]});
 return send(res,200,{ok:true,updatedAt:new Date().toISOString(),source:"Google News RSS (publisher articles)",method:"Real article headlines and links; labels are keyword heuristics only",items:unique,warning:"Headlines link to publishers through Google News RSS. Headline tags are not predictions or trade instructions. Verify article dates and claims at the original publisher or official source."});
};
