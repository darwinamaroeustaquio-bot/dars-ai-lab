// DARS eight-candidate paper analysis. Read-only; never sends broker orders.
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
      base.strategySelection={candidate:"NO_TRADE",status:"BLOCKED_BY_MARKET_DATA",eligible:false,rationale:base.engineBlockReason||"Verified market data is not ready.",evaluatedCandidates:8,strategyRanking:[]};
      base.decision="WAIT";base.setup=null;
      return res.status(200).json({ok:true,analysis:base,paperSetups:[]});
    }
    const requestedMode=body.strategyMode==="MANUAL"?"MANUAL":"ROBOT_AUTO";
    const requestedId=typeof body.selectedStrategyId==="string"?body.selectedStrategyId:null;
    if(requestedMode==="MANUAL"&&requestedId==="DARS_EHL_BREAKOUT_V1_10"){
      const {detectEhlBreakout,STRATEGY_ID}=require("../lib/dars-ehl-breakout");
      const candidate=detectEhlBreakout({frames:base.frames,quote:body.quote});
      const setup=candidate?{...candidate,source:"Verified MT5 closed M5 candles; paper-only EHL candidate"}:null;
      const analysis={...base,engine:STRATEGY_ID,decision:setup?.side||"WAIT",setup,
        strategySelection:{candidate:STRATEGY_ID,status:setup?"SHADOW_PAPER_REVIEW":"NO_SETUP",eligible:false,
          rationale:setup?"EMA trend, equal liquidity level, candle compression and confirmed breakout aligned.":"Waiting for all EHL breakout conditions on a closed M5 candle.",
          evaluatedCandidates:1,strategyRanking:[{strategy:STRATEGY_ID,score:0,eligible:false,totalTrades:0,holdoutTrades:0,reason:"New discovery candidate; forward-paper validation is required before promotion."}]},
        paperSetups:setup?[setup]:[],diagnostics:setup?[]:["No confirmed EHL breakout on the latest closed M5 candle."]};
      return res.status(200).json({ok:true,analysis});
    }
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
      source:"Live VT Markets quote + verified closed MT5 candles; eight-candidate pool",
      note:result.setup.note
    }:null,strategySelection:result.selection,engineBoard:result.board,
    paperSetups:(result.paperSetups||[]).map(s=>({
      side:s.side,entry:s.entry,stopLoss:s.stopLoss,takeProfit1:s.takeProfit1,takeProfit2:s.takeProfit2,
      riskDistance:s.riskDistance,rewardRiskTP1:s.rewardRiskTP1,rewardRiskTP2:s.rewardRiskTP2,
      strategy:s.strategy,strategyId:s.strategyId,family:s.family,profile:s.profile,targetR:s.targetR,
      stopMultiple:s.stopMultiple,maxBars:s.maxBars,signalBarTime:s.signalBarTime,
      oscillator:s.oscillator,previousOscillator:s.previousOscillator,lowerThreshold:s.lowerThreshold,
      upperThreshold:s.upperThreshold,features:{atr:s.atr14,oscillator:s.oscillator},note:s.note
    })),diagnostics:result.diagnostics};
    return res.status(200).json({ok:true,analysis});
  }catch(error){
    return res.status(500).json({ok:false,error:"Eight-candidate paper analysis failed safely. No virtual entry was created."});
  }
};
