// DARS seven-candidate paper analysis. Read-only; never sends broker orders.
const { analyzeDarsMarket } = require("../lib/dars-omniscient");
const { analyzeSevenCandidatePool } = require("../lib/dars-seven-candidate-paper");

module.exports = async (req,res) => {
  res.setHeader("Content-Type","application/json; charset=utf-8");
  res.setHeader("Cache-Control","no-store, max-age=0");
  if(req.method!=="POST"){res.setHeader("Allow","POST");return res.status(405).json({ok:false,error:"POST only"});}
  const body=req.body||{};
  if(!body.quote||!body.frames||typeof body.frames!=="object")return res.status(400).json({ok:false,error:"Expected symbol, quote and M5/M15/H1 frames."});
  try{
    // Reuse the existing strict VT Markets quote, candle freshness, spread and volatility checks.
    const base=analyzeDarsMarket({symbol:body.symbol,quote:body.quote,frames:body.frames,now:Date.now()});
    if(base.engineBlockReason || !base.frames?.M5?.ok || !base.frames?.M15?.ok || !base.frames?.H1?.ok){
      base.engine="DARS_SEVEN_CANDIDATE_PAPER_V1";
      base.strategySelection={candidate:"NO_TRADE",status:"BLOCKED_BY_MARKET_DATA",eligible:false,rationale:base.engineBlockReason||"Verified market data is not ready.",evaluatedCandidates:7,strategyRanking:[]};
      base.decision="WAIT";base.setup=null;
      return res.status(200).json({ok:true,analysis:base});
    }
    const requestedMode=body.strategyMode==="MANUAL"?"MANUAL":"ROBOT_AUTO";
    const requestedId=typeof body.selectedStrategyId==="string"?body.selectedStrategyId:null;
    const result=analyzeSevenCandidatePool({frames:base.frames,quote:body.quote,paperTrades:Array.isArray(body.paperTrades)?body.paperTrades.slice(-5000):[],preferredCandidateId:requestedMode==="MANUAL"?requestedId:null});
    const analysis={...base,engine:"DARS_SEVEN_CANDIDATE_PAPER_V1",decision:result.setup?.side||"WAIT",setup:result.setup?{
      side:result.setup.side,entry:result.setup.entry,stopLoss:result.setup.stopLoss,
      takeProfit1:result.setup.takeProfit1,takeProfit2:result.setup.takeProfit2,
      riskDistance:result.setup.riskDistance,rewardRiskTP1:result.setup.rewardRiskTP1,
      rewardRiskTP2:result.setup.rewardRiskTP2,strategy:result.setup.strategy,
      strategyId:result.setup.strategyId,family:result.setup.family,profile:result.setup.profile,
      targetR:result.setup.targetR,stopMultiple:result.setup.stopMultiple,maxBars:result.setup.maxBars,
      signalBarTime:result.setup.signalBarTime,oscillator:result.setup.oscillator,
      previousOscillator:result.setup.previousOscillator,lowerThreshold:result.setup.lowerThreshold,
      upperThreshold:result.setup.upperThreshold,features:{atr:result.setup.atr14,oscillator:result.setup.oscillator},
      source:"Live VT Markets quote + verified closed MT5 candles; fixed seven-candidate pool",
      note:result.setup.note
    }:null,strategySelection:result.selection,engineBoard:result.board,diagnostics:result.diagnostics};
    return res.status(200).json({ok:true,analysis});
  }catch(error){
    return res.status(500).json({ok:false,error:"Seven-candidate paper analysis failed safely. No virtual entry was created."});
  }
};
