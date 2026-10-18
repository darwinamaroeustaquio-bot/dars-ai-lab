// Real article headlines from GDELT's global news database; no synthetic headlines or paid key.
// Bias/impact labels are keyword heuristics, not an AI forecast or verified event classification.
function send(res,status,body){res.status(status);res.setHeader("Content-Type","application/json; charset=utf-8");res.setHeader("Cache-Control","s-maxage=180, stale-while-revalidate=300");return res.json(body)}
function label(title){
 const t=String(title||"").toLowerCase();
 const bull=/(gold (surge|rall|rise|gain|jump|climb)|bullion (rise|gain|surge)|fed (cut|dovish)|rate cut|lower interest rates|dollar (falls|weakens|slips)|yields (fall|drop|slip)|inflation cools|cpi (slows|cool))/i.test(t);
 const bear=/(gold (falls|drop|slump|sink|slide)|fed (hike|hawkish)|rate hike|higher interest rates|dollar (rises|strengthens|jumps)|yields (rise|jump|climb)|inflation heats|hotter-than-expected cpi)/i.test(t);
 const macro=/(federal reserve|\\bfed\\b|\\bcpi\\b|\\bpce\\b|\\bnfp\\b|nonfarm payroll|jobs report|inflation|interest rate|fomc|powell|unemployment|treasury yields|dollar|central bank)/i.test(t);
 return {bias:bull&&!bear?"Potentially bullish gold":bear&&!bull?"Potentially bearish gold":"Unclassified / mixed",impact:macro?"Macro-related headline (keyword tag)":"General market news",confidence:"Not assessed — headline alone is insufficient"};
}
function parseSeenAt(v){
 const m=String(v||"").match(/^(\\d{4})(\\d{2})(\\d{2})T(\\d{2})(\\d{2})(\\d{2})Z$/);
 return m?new Date(Date.UTC(+m[1],+m[2]-1,+m[3],+m[4],+m[5],+m[6])).toISOString():null;
}
module.exports=async(req,res)=>{
 if(req.method!=="GET"){res.setHeader("Allow","GET");return send(res,405,{ok:false,error:"Method not allowed"})}
 // Try queries independently: one rejected/timeout query must not discard results from another.
 const queries=[
  '(gold OR XAUUSD OR bullion) AND (Federal Reserve OR inflation OR dollar OR Treasury OR interest rates)',
  '(gold price OR precious metals OR Federal Reserve OR US CPI OR PCE OR nonfarm payrolls)',
  'gold bullion'
 ];
 const batches=[];
 const errors=[];
 for(const query of queries){
  try{
   const params=new URLSearchParams({query,mode:"ArtList",format:"json",sort:"DateDesc",maxrecords:"25",timespan:"7d"});
   const r=await fetch("https://api.gdeltproject.org/api/v2/doc/doc?"+params.toString(),{headers:{"User-Agent":"Mozilla/5.0 DarsAILab/1.0"},signal:AbortSignal.timeout(7000)});
   if(!r.ok){errors.push("provider HTTP "+r.status);continue}
   const raw=await r.text();
   let data;
   try{data=JSON.parse(raw)}catch{errors.push("provider returned non-JSON");continue}
   if(data.status&&String(data.status).toLowerCase()!=="ok"){errors.push("provider status unavailable");continue}
   if(Array.isArray(data.articles))batches.push(...data.articles);
   if(batches.length>=5)break;
  }catch(e){errors.push(e&&e.name==="TimeoutError"?"provider timeout":"provider request failed")}
 }
 const unique=[...new Map(batches.filter(a=>a&&a.title&&a.url).map(a=>[a.url,{title:String(a.title),link:String(a.url),seenAt:parseSeenAt(a.seendate),source:String(a.domain||a.sourcecountry||"News publisher"),language:String(a.language||"Unknown"),...label(a.title)}])).values()]
  .sort((a,b)=>Date.parse(b.seenAt||0)-Date.parse(a.seenAt||0)).slice(0,25);
 if(!unique.length)return send(res,502,{ok:false,error:"Real-news feed temporarily unavailable.",details:"GDELT did not return usable headlines for the fallback searches. Refresh later; new paper entries remain blocked while required feeds are unavailable.",providerErrors:[...new Set(errors)]});
 return send(res,200,{ok:true,updatedAt:new Date().toISOString(),source:"GDELT global news database",method:"Real publisher articles; labels are keyword heuristics only",items:unique,warning:"These are links to real articles indexed by GDELT, not an official economic calendar. 'Seen' is when GDELT recorded the article, not necessarily its publication time. Verify article dates and event times at the publisher or official source. Bias tags are not predictions."});
};
