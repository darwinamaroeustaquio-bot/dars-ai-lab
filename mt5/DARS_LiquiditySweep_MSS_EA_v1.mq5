//+------------------------------------------------------------------+
//| DARS AI LAB - Liquidity Sweep + Market Structure Shift EA v1     |
//| Gold-focused MT5 EA. Demo/Strategy Tester only by default.        |
//+------------------------------------------------------------------+
#property strict
#property version   "1.01"
#property description "XAUUSD-STD sweep + MSS + retest EA. Live mode uses strict small-account guardrails."

#include <Trade/Trade.mqh>
CTrade trade;

input string          InpTradeSymbol          = "XAUUSD-STD";
input ENUM_TIMEFRAMES InpEntryTF              = PERIOD_M5;
input ENUM_TIMEFRAMES InpBiasTF               = PERIOD_H1;
input int             InpFastEMA               = 50;
input int             InpSlowEMA               = 200;
input int             InpSweepLookback          = 12;
input int             InpMSSLookback            = 5;
input int             InpSetupExpiryBars        = 8;
input double          InpRiskPercent            = 0.25;
input double          InpRewardRisk             = 1.5;
input double          InpMaxSpreadPoints        = 500;
input double          InpSLBufferPoints         = 100;
input double          InpRetestTolerancePoints  = 150;
input int             InpMaxTradesPerDay        = 1;
input double          InpDailyLossLimitPercent  = 1.0;
input ulong           InpMagic                  = 26102101;
input bool            InpEnableOrders           = true;
input bool            InpAllowLiveTrading       = true;
input bool            InpOnePositionAtATime     = true;

int fastHandle = INVALID_HANDLE;
int slowHandle = INVALID_HANDLE;
datetime lastBarTime = 0;
datetime dayAnchor = 0;
double dayStartEquity = 0.0;
int tradesToday = 0;

enum SetupState { STATE_IDLE=0, STATE_WAIT_MSS=1, STATE_WAIT_RETEST=2 };
SetupState setupState = STATE_IDLE;
int setupDirection = 0; // +1 buy, -1 sell
double sweepExtreme = 0.0;
double mssLevel = 0.0;
datetime sweepTime = 0;
int setupBars = 0;

string Sym() { return (InpTradeSymbol == "" ? _Symbol : InpTradeSymbol); }

int OnInit()
{
   string symbol = Sym();
   if(!SymbolSelect(symbol, true))
   {
      Print("DARS EA: Cannot select symbol ", symbol);
      return INIT_FAILED;
   }

   ENUM_ACCOUNT_TRADE_MODE mode = (ENUM_ACCOUNT_TRADE_MODE)AccountInfoInteger(ACCOUNT_TRADE_MODE);
   if(mode == ACCOUNT_TRADE_MODE_REAL && !InpAllowLiveTrading)
   {
      Print("DARS EA BLOCKED: real account detected and InpAllowLiveTrading=false.");
      return INIT_FAILED;
   }
   // Small-account live guardrails: fail closed if the inputs are loosened.
   if(mode == ACCOUNT_TRADE_MODE_REAL && InpAllowLiveTrading)
   {
      if(InpRiskPercent > 0.25 || InpMaxTradesPerDay > 1 || InpDailyLossLimitPercent > 1.0)
      {
         Print("DARS EA BLOCKED: live safety limits exceeded. For this build, use risk <=0.25%, max 1 trade/day, daily loss limit <=1.0%.");
         return INIT_FAILED;
      }
      Print("DARS EA LIVE MODE: enabled. Small-account guardrails active; trades may be skipped if broker minimum lot exceeds the 0.25% risk budget. Live trading can lose money.");
   }

   fastHandle = iMA(symbol, InpBiasTF, InpFastEMA, 0, MODE_EMA, PRICE_CLOSE);
   slowHandle = iMA(symbol, InpBiasTF, InpSlowEMA, 0, MODE_EMA, PRICE_CLOSE);
   if(fastHandle == INVALID_HANDLE || slowHandle == INVALID_HANDLE)
   {
      Print("DARS EA: Failed to create EMA handles.");
      return INIT_FAILED;
   }

   trade.SetExpertMagicNumber(InpMagic);
   trade.SetDeviationInPoints(30);
   trade.SetTypeFillingBySymbol(symbol);
   ResetDayIfNeeded();
   Print("DARS EA v1.01 ready. Symbol=", symbol, ", entry TF=", EnumToString(InpEntryTF),
         ", risk=", DoubleToString(InpRiskPercent, 2), "%, max trades/day=", InpMaxTradesPerDay,
         ", daily loss limit=", DoubleToString(InpDailyLossLimitPercent, 2), "%, orders enabled=", (InpEnableOrders ? "true" : "false"),
         ", live trading allowed=", (InpAllowLiveTrading ? "true" : "false"), ".");
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   if(fastHandle != INVALID_HANDLE) IndicatorRelease(fastHandle);
   if(slowHandle != INVALID_HANDLE) IndicatorRelease(slowHandle);
}

void OnTick()
{
   ResetDayIfNeeded();
   if(!IsNewBar()) return;

   if(!InpEnableOrders)
   {
      Print("DARS EA: signal-only mode enabled; no orders will be sent.");
      return;
   }

   if(DailyLossLimitReached())
   {
      Print("DARS EA: daily equity loss limit reached. No new trades today.");
      return;
   }

   string symbol = Sym();
   if(!SpreadOK(symbol)) return;

   if(InpOnePositionAtATime && HasOpenPosition(symbol))
      return;

   MqlRates rates[];
   ArraySetAsSeries(rates, true);
   int need = MathMax(InpSweepLookback + 3, InpMSSLookback + 5);
   if(CopyRates(symbol, InpEntryTF, 0, need, rates) < need)
   {
      Print("DARS EA: not enough entry timeframe history yet.");
      return;
   }

   setupBars++;
   if(setupState != STATE_IDLE && setupBars > InpSetupExpiryBars)
      ClearSetup();

   if(setupState == STATE_IDLE)
   {
      DetectSweep(rates, symbol);
      return;
   }

   if(setupState == STATE_WAIT_MSS)
   {
      // Candle 1 is the latest fully closed candle.
      if(setupDirection == 1 && rates[1].close > mssLevel && rates[1].close > rates[1].open)
      {
         setupState = STATE_WAIT_RETEST;
         setupBars = 0;
         Print("DARS EA: bullish MSS confirmed. Waiting for retest of ", DoubleToString(mssLevel, _Digits));
      }
      else if(setupDirection == -1 && rates[1].close < mssLevel && rates[1].close < rates[1].open)
      {
         setupState = STATE_WAIT_RETEST;
         setupBars = 0;
         Print("DARS EA: bearish MSS confirmed. Waiting for retest of ", DoubleToString(mssLevel, _Digits));
      }
      return;
   }

   if(setupState == STATE_WAIT_RETEST)
   {
      double tol = InpRetestTolerancePoints * SymbolInfoDouble(symbol, SYMBOL_POINT);
      bool bullishRetest = setupDirection == 1 &&
         rates[1].low <= mssLevel + tol && rates[1].close > mssLevel &&
         rates[1].close > rates[1].open;
      bool bearishRetest = setupDirection == -1 &&
         rates[1].high >= mssLevel - tol && rates[1].close < mssLevel &&
         rates[1].close < rates[1].open;

      if(bullishRetest || bearishRetest)
      {
         if(!BiasAllows(symbol, setupDirection))
         {
            Print("DARS EA: valid structure setup rejected by H1 EMA bias filter.");
            ClearSetup();
            return;
         }
         PlaceTrade(symbol, setupDirection, sweepExtreme);
         ClearSetup();
      }
   }
}

bool IsNewBar()
{
   datetime t = iTime(Sym(), InpEntryTF, 0);
   if(t == 0 || t == lastBarTime) return false;
   lastBarTime = t;
   return true;
}

void ResetDayIfNeeded()
{
   datetime now = TimeCurrent();
   MqlDateTime dt; TimeToStruct(now, dt);
   dt.hour = 0; dt.min = 0; dt.sec = 0;
   datetime today = StructToTime(dt);
   if(dayAnchor != today)
   {
      dayAnchor = today;
      dayStartEquity = AccountInfoDouble(ACCOUNT_EQUITY);
      tradesToday = 0;
      Print("DARS EA: daily counters reset. Start equity=", DoubleToString(dayStartEquity, 2));
   }
}

bool DailyLossLimitReached()
{
   if(dayStartEquity <= 0) return false;
   double lossPct = (dayStartEquity - AccountInfoDouble(ACCOUNT_EQUITY)) / dayStartEquity * 100.0;
   return lossPct >= InpDailyLossLimitPercent || tradesToday >= InpMaxTradesPerDay;
}

bool SpreadOK(const string symbol)
{
   MqlTick tick;
   if(!SymbolInfoTick(symbol, tick)) return false;
   double point = SymbolInfoDouble(symbol, SYMBOL_POINT);
   if(point <= 0) return false;
   double spreadPoints = (tick.ask - tick.bid) / point;
   if(spreadPoints > InpMaxSpreadPoints)
   {
      Print("DARS EA: spread filter blocked trade. Spread points=", DoubleToString(spreadPoints, 1));
      return false;
   }
   return true;
}

bool HasOpenPosition(const string symbol)
{
   for(int i = PositionsTotal() - 1; i >= 0; --i)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) == symbol &&
         (ulong)PositionGetInteger(POSITION_MAGIC) == InpMagic)
         return true;
   }
   return false;
}

bool BiasAllows(const string symbol, const int direction)
{
   double f[], s[];
   ArraySetAsSeries(f, true); ArraySetAsSeries(s, true);
   if(CopyBuffer(fastHandle, 0, 1, 1, f) != 1 || CopyBuffer(slowHandle, 0, 1, 1, s) != 1)
      return false;
   double close1 = iClose(symbol, InpBiasTF, 1);
   if(close1 <= 0) return false;
   if(direction == 1) return f[0] > s[0] && close1 > f[0];
   return f[0] < s[0] && close1 < f[0];
}

void DetectSweep(MqlRates &r[], const string symbol)
{
   double priorLow = r[2].low;
   double priorHigh = r[2].high;
   for(int i = 2; i <= InpSweepLookback + 1; ++i)
   {
      priorLow = MathMin(priorLow, r[i].low);
      priorHigh = MathMax(priorHigh, r[i].high);
   }

   // Sweep below prior lows then close back above: bullish candidate.
   if(r[1].low < priorLow && r[1].close > priorLow && r[1].close > r[1].open)
   {
      setupDirection = 1;
      sweepExtreme = r[1].low;
      mssLevel = r[2].high;
      for(int j = 2; j <= InpMSSLookback + 1; ++j)
         mssLevel = MathMax(mssLevel, r[j].high);
      sweepTime = r[1].time;
      setupBars = 0;
      setupState = STATE_WAIT_MSS;
      Print("DARS EA: bullish liquidity sweep detected at ", TimeToString(sweepTime),
            ". MSS level=", DoubleToString(mssLevel, _Digits));
      return;
   }

   // Sweep above prior highs then close back below: bearish candidate.
   if(r[1].high > priorHigh && r[1].close < priorHigh && r[1].close < r[1].open)
   {
      setupDirection = -1;
      sweepExtreme = r[1].high;
      mssLevel = r[2].low;
      for(int j = 2; j <= InpMSSLookback + 1; ++j)
         mssLevel = MathMin(mssLevel, r[j].low);
      sweepTime = r[1].time;
      setupBars = 0;
      setupState = STATE_WAIT_MSS;
      Print("DARS EA: bearish liquidity sweep detected at ", TimeToString(sweepTime),
            ". MSS level=", DoubleToString(mssLevel, _Digits));
   }
}

void PlaceTrade(const string symbol, const int direction, const double sweepPrice)
{
   if(tradesToday >= InpMaxTradesPerDay)
   {
      Print("DARS EA: daily trade count limit reached.");
      return;
   }

   MqlTick tick;
   if(!SymbolInfoTick(symbol, tick)) return;
   double point = SymbolInfoDouble(symbol, SYMBOL_POINT);
   int digits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
   double entry = (direction == 1 ? tick.ask : tick.bid);
   double sl = (direction == 1 ? sweepPrice - InpSLBufferPoints * point
                               : sweepPrice + InpSLBufferPoints * point);
   double riskDistance = MathAbs(entry - sl);
   if(riskDistance <= 0) return;
   double tp = (direction == 1 ? entry + riskDistance * InpRewardRisk
                               : entry - riskDistance * InpRewardRisk);
   sl = NormalizeDouble(sl, digits);
   tp = NormalizeDouble(tp, digits);

   // Respect broker's minimum stop distance, using symbol properties.
   long stopsLevel = SymbolInfoInteger(symbol, SYMBOL_TRADE_STOPS_LEVEL);
   double minDistance = (double)stopsLevel * point;
   if(direction == 1 && (entry - sl < minDistance || tp - entry < minDistance))
   {
      Print("DARS EA: buy rejected locally; SL/TP inside broker stop distance.");
      return;
   }
   if(direction == -1 && (sl - entry < minDistance || entry - tp < minDistance))
   {
      Print("DARS EA: sell rejected locally; SL/TP inside broker stop distance.");
      return;
   }

   double volume = CalculateRiskVolume(symbol, direction, entry, sl);
   if(volume <= 0)
   {
      Print("DARS EA: could not calculate a valid risk-sized volume.");
      return;
   }

   bool ok = false;
   if(direction == 1)
      ok = trade.Buy(volume, symbol, 0.0, sl, tp, "DARS Sweep-MSS BUY");
   else
      ok = trade.Sell(volume, symbol, 0.0, sl, tp, "DARS Sweep-MSS SELL");

   if(ok && (trade.ResultRetcode() == TRADE_RETCODE_DONE ||
             trade.ResultRetcode() == TRADE_RETCODE_PLACED ||
             trade.ResultRetcode() == TRADE_RETCODE_DONE_PARTIAL))
   {
      tradesToday++;
      Print("DARS EA ORDER OK: ", (direction == 1 ? "BUY" : "SELL"),
            " volume=", DoubleToString(volume, 2),
            " entry~", DoubleToString(entry, digits),
            " SL=", DoubleToString(sl, digits),
            " TP=", DoubleToString(tp, digits),
            " risk=", DoubleToString(InpRiskPercent, 2), "%");
   }
   else
   {
      Print("DARS EA ORDER FAILED: retcode=", trade.ResultRetcode(),
            " description=", trade.ResultRetcodeDescription());
   }
}

double CalculateRiskVolume(const string symbol, const int direction, const double entry, const double sl)
{
   double equity = AccountInfoDouble(ACCOUNT_EQUITY);
   double riskMoney = equity * InpRiskPercent / 100.0;
   if(riskMoney <= 0) return 0;

   ENUM_ORDER_TYPE type = (direction == 1 ? ORDER_TYPE_BUY : ORDER_TYPE_SELL);
   double pnl = 0;
   if(!OrderCalcProfit(type, symbol, 1.0, entry, sl, pnl)) return 0;
   double lossPerLot = MathAbs(pnl);
   if(lossPerLot <= 0) return 0;

   double rawVolume = riskMoney / lossPerLot;
   double minVol = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MIN);
   double maxVol = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MAX);
   double step = SymbolInfoDouble(symbol, SYMBOL_VOLUME_STEP);
   if(step <= 0 || minVol <= 0) return 0;

   // Round DOWN to broker volume step; never force up to minimum if it exceeds risk.
   double volume = MathFloor(rawVolume / step) * step;
   if(volume < minVol)
   {
      Print("DARS EA: calculated volume below broker minimum; skipping to preserve risk cap.");
      return 0;
   }
   volume = MathMin(volume, maxVol);
   int volDigits = 2;
   if(step < 0.01) volDigits = 3;
   if(step < 0.001) volDigits = 4;
   return NormalizeDouble(volume, volDigits);
}

void ClearSetup()
{
   setupState = STATE_IDLE;
   setupDirection = 0;
   sweepExtreme = 0.0;
   mssLevel = 0.0;
   sweepTime = 0;
   setupBars = 0;
}
//+------------------------------------------------------------------+
