// Dars AI Lab - live-capable strategy prototype with explicit safety locks for MT5
// SAFETY: Trading disabled by default. Real-account orders require two explicit input switches and independent testing.
// Default is disabled. It is a transparent rule-based prototype, NOT a proven AI model.
// Test in Strategy Tester and a VT Markets demo account before considering any live deployment.
#property strict
#property version   "0.10"
#property description "Dars AI Lab EMA/RSI/ATR strategy prototype with live lock"

#include <Trade/Trade.mqh>
CTrade trade;

input bool   EnableTrading             = false;  // Master execution switch; OFF by default
input bool   AllowLiveTrading           = false;  // Separate live-account lock; OFF by default
input bool   StopAll                    = false;  // ON closes this EA's positions and blocks new entries
input double RiskPercent               = 0.25;   // Risk per trade as % of equity
input double DailyLossLimitPercent     = 1.00;   // Stop new entries after this daily equity loss
input int    FastEMAPeriod              = 20;
input int    SlowEMAPeriod              = 50;
input int    RSIPeriod                   = 14;
input double BuyRSIMin                  = 52.0;
input double SellRSIMax                 = 48.0;
input int    ATRPeriod                  = 14;
input double ATRStopMultiplier          = 1.5;
input double RewardRiskRatio            = 1.5;
input int    MaxSpreadPoints            = 35;     // Tune to the specific broker symbol
input int    MaxSlippagePoints          = 20;
input ulong  MagicNumber                = 26101701;
input bool   OnePositionPerSymbol       = true;

int fastHandle = INVALID_HANDLE;
int slowHandle = INVALID_HANDLE;
int rsiHandle  = INVALID_HANDLE;
int atrHandle  = INVALID_HANDLE;
datetime lastBarTime = 0;
double dayStartEquity = 0.0;
int trackedDay = -1;
string dayKey = "";

int DateKey(datetime t)
{
   MqlDateTime d; TimeToStruct(t,d);
   return d.year*10000+d.mon*100+d.day;
}

bool IsDemoAccount()
{
   return ((ENUM_ACCOUNT_TRADE_MODE)AccountInfoInteger(ACCOUNT_TRADE_MODE) == ACCOUNT_TRADE_MODE_DEMO);
}

void LoadDailyBaseline()
{
   int today = DateKey(TimeCurrent());
   if(today == trackedDay && dayStartEquity > 0.0) return;
   trackedDay = today;
   dayKey = StringFormat("DarsEquity_%I64d_%d", AccountInfoInteger(ACCOUNT_LOGIN), today);
   if(GlobalVariableCheck(dayKey))
      dayStartEquity = GlobalVariableGet(dayKey);
   else
   {
      dayStartEquity = AccountInfoDouble(ACCOUNT_EQUITY);
      GlobalVariableSet(dayKey, dayStartEquity);
   }
}

bool DailyLossLimitHit()
{
   LoadDailyBaseline();
   if(dayStartEquity <= 0.0) return true;
   double equity = AccountInfoDouble(ACCOUNT_EQUITY);
   double lossPct = 100.0 * (dayStartEquity - equity) / dayStartEquity;
   return (lossPct >= DailyLossLimitPercent);
}

bool IsNewBar()
{
   datetime t[1];
   if(CopyTime(_Symbol,_Period,0,1,t) != 1) return false;
   if(t[0] == lastBarTime) return false;
   lastBarTime = t[0];
   return true;
}

void CloseOurPositions()
{
   for(int i=PositionsTotal()-1; i>=0; --i)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if((ulong)PositionGetInteger(POSITION_MAGIC) != MagicNumber) continue;
      if(!trade.PositionClose(ticket))
         Print("Dars EA STOP ALL: failed to close ticket=",ticket," retcode=",trade.ResultRetcode()," ",trade.ResultRetcodeDescription());
      else
         Print("Dars EA STOP ALL: close request sent for ticket=",ticket);
   }
}

bool HasOurPosition()
{
   for(int i=PositionsTotal()-1; i>=0; --i)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) == _Symbol &&
         (ulong)PositionGetInteger(POSITION_MAGIC) == MagicNumber)
         return true;
   }
   return false;
}

double NormalizeVolume(double volume)
{
   double vmin = SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MIN);
   double vmax = SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MAX);
   double step = SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_STEP);
   if(step <= 0.0 || vmin <= 0.0) return 0.0;
   volume = MathMin(vmax,volume);
   volume = MathFloor(volume/step)*step;
   int precision = 2;
   if(step < 0.01) precision = 3;
   if(step < 0.001) precision = 4;
   volume = NormalizeDouble(volume,precision);
   if(volume < vmin) return 0.0; // Never round risk upward to broker minimum
   return volume;
}

double CalculateVolume(ENUM_ORDER_TYPE orderType,double entry,double stopLoss)
{
   double equity = AccountInfoDouble(ACCOUNT_EQUITY);
   double riskMoney = equity * RiskPercent / 100.0;
   if(equity <= 0.0 || riskMoney <= 0.0) return 0.0;
   double oneLotProfit = 0.0;
   if(!OrderCalcProfit(orderType,_Symbol,1.0,entry,stopLoss,oneLotProfit))
   {
      Print("Dars EA: OrderCalcProfit failed; refusing entry. Error=",GetLastError());
      return 0.0;
   }
   double oneLotLoss = MathAbs(oneLotProfit);
   if(oneLotLoss <= 0.0) return 0.0;
   return NormalizeVolume(riskMoney/oneLotLoss);
}

int OnInit()
{
   if(RiskPercent <= 0.0 || RiskPercent > 0.5 ||
      DailyLossLimitPercent <= 0.0 || DailyLossLimitPercent > 2.0 ||
      FastEMAPeriod < 2 || SlowEMAPeriod <= FastEMAPeriod ||
      ATRStopMultiplier <= 0.0 || RewardRiskRatio <= 0.0 ||
      MaxSpreadPoints <= 0)
   {
      Print("Dars EA: Invalid safety settings. Risk must be >0 and <=0.5%; daily loss limit <=2%.");
      return INIT_PARAMETERS_INCORRECT;
   }

   fastHandle = iMA(_Symbol,_Period,FastEMAPeriod,0,MODE_EMA,PRICE_CLOSE);
   slowHandle = iMA(_Symbol,_Period,SlowEMAPeriod,0,MODE_EMA,PRICE_CLOSE);
   rsiHandle  = iRSI(_Symbol,_Period,RSIPeriod,PRICE_CLOSE);
   atrHandle  = iATR(_Symbol,_Period,ATRPeriod);
   if(fastHandle==INVALID_HANDLE || slowHandle==INVALID_HANDLE ||
      rsiHandle==INVALID_HANDLE || atrHandle==INVALID_HANDLE)
   {
      Print("Dars EA: Indicator initialization failed.");
      return INIT_FAILED;
   }

   trade.SetExpertMagicNumber(MagicNumber);
   trade.SetDeviationInPoints(MaxSlippagePoints);
   trade.SetTypeFillingBySymbol(_Symbol);
   LoadDailyBaseline();

   if(!EnableTrading)
      Print("Dars EA: MASTER SWITCH OFF. No orders will be sent.");
   if((ENUM_ACCOUNT_TRADE_MODE)AccountInfoInteger(ACCOUNT_TRADE_MODE)==ACCOUNT_TRADE_MODE_REAL && !AllowLiveTrading)
      Print("Dars EA: LIVE ACCOUNT LOCKED. AllowLiveTrading is false; no orders will be sent.");
   Print("Dars EA: Rule-based EMA/RSI/ATR prototype. Not a proven profitable AI model.");

   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   if(fastHandle!=INVALID_HANDLE) IndicatorRelease(fastHandle);
   if(slowHandle!=INVALID_HANDLE) IndicatorRelease(slowHandle);
   if(rsiHandle!=INVALID_HANDLE) IndicatorRelease(rsiHandle);
   if(atrHandle!=INVALID_HANDLE) IndicatorRelease(atrHandle);
}

void OnTick()
{
   // Two explicit switches are required before any order can be sent.
   if(StopAll)
   {
      CloseOurPositions();
      Comment("DARS EA: STOP ALL ENABLED - entries blocked; EA positions are being closed.");
      return;
   }
   if(!EnableTrading) return;
   if((ENUM_ACCOUNT_TRADE_MODE)AccountInfoInteger(ACCOUNT_TRADE_MODE)==ACCOUNT_TRADE_MODE_REAL && !AllowLiveTrading) return;
   if((ENUM_ACCOUNT_TRADE_MODE)AccountInfoInteger(ACCOUNT_TRADE_MODE)==ACCOUNT_TRADE_MODE_CONTEST) return;
   if(!TerminalInfoInteger(TERMINAL_CONNECTED) || !MQLInfoInteger(MQL_TRADE_ALLOWED) ||
      !TerminalInfoInteger(TERMINAL_TRADE_ALLOWED)) return;
   if(DailyLossLimitHit())
   {
      Comment("DARS DEMO EA: DAILY LOSS LIMIT HIT - NEW ENTRIES BLOCKED");
      return;
   }
   if(!IsNewBar()) return;

   MqlTick tick;
   if(!SymbolInfoTick(_Symbol,tick) || tick.ask<=0 || tick.bid<=0) return;
   double point = SymbolInfoDouble(_Symbol,SYMBOL_POINT);
   if(point<=0 || (tick.ask-tick.bid)/point > MaxSpreadPoints)
   {
      Print("Dars EA: Spread check failed; no entry.");
      return;
   }
   if(OnePositionPerSymbol && HasOurPosition()) return;

   double fast[2],slow[2],rsi[1],atr[1];
   ArraySetAsSeries(fast,false); ArraySetAsSeries(slow,false);
   if(CopyBuffer(fastHandle,0,1,2,fast)!=2 ||
      CopyBuffer(slowHandle,0,1,2,slow)!=2 ||
      CopyBuffer(rsiHandle,0,1,1,rsi)!=1 ||
      CopyBuffer(atrHandle,0,1,1,atr)!=1) return;
   if(atr[0]<=0 || rsi[0]<0 || rsi[0]>100) return;

   // Arrays copied from shift=1 contain shift=2 at [0] and the latest closed bar at [1].
   bool bullishCross = fast[0] <= slow[0] && fast[1] > slow[1] && rsi[0] >= BuyRSIMin;
   bool bearishCross = fast[0] >= slow[0] && fast[1] < slow[1] && rsi[0] <= SellRSIMax;
   if(!bullishCross && !bearishCross)
   {
      Comment("DARS DEMO EA: WAIT - no confirmed EMA cross + RSI setup");
      return;
   }

   int digits=(int)SymbolInfoInteger(_Symbol,SYMBOL_DIGITS);
   double stopDistance=atr[0]*ATRStopMultiplier;
   double minStop=(double)SymbolInfoInteger(_Symbol,SYMBOL_TRADE_STOPS_LEVEL)*point;
   stopDistance=MathMax(stopDistance,minStop+2*point);
   bool sent=false;

   if(bullishCross)
   {
      double entry=tick.ask;
      double sl=NormalizeDouble(entry-stopDistance,digits);
      double tp=NormalizeDouble(entry+stopDistance*RewardRiskRatio,digits);
      double volume=CalculateVolume(ORDER_TYPE_BUY,entry,sl);
      if(volume<=0.0) { Print("Dars EA: Calculated volume below broker minimum; no BUY."); return; }
      sent=trade.Buy(volume,_Symbol,0.0,sl,tp,"Dars demo EMA/RSI BUY");
      Print("Dars EA BUY result=",sent," retcode=",trade.ResultRetcode()," ",trade.ResultRetcodeDescription());
   }
   else if(bearishCross)
   {
      double entry=tick.bid;
      double sl=NormalizeDouble(entry+stopDistance,digits);
      double tp=NormalizeDouble(entry-stopDistance*RewardRiskRatio,digits);
      double volume=CalculateVolume(ORDER_TYPE_SELL,entry,sl);
      if(volume<=0.0) { Print("Dars EA: Calculated volume below broker minimum; no SELL."); return; }
      sent=trade.Sell(volume,_Symbol,0.0,sl,tp,"Dars demo EMA/RSI SELL");
      Print("Dars EA SELL result=",sent," retcode=",trade.ResultRetcode()," ",trade.ResultRetcodeDescription());
   }
   if(sent) Comment("DARS DEMO EA: ORDER SENT - verify fill, SL and TP in MT5 Trade tab.");
}
