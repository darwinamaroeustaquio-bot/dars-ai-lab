//+------------------------------------------------------------------+
//| DARS_DEMO_SETUP_APPROVAL_PANEL.mq5                               |
//| Version 0.10 - Demo-only setup review panel                      |
//| SAFETY: Does not submit, modify or close broker orders.          |
//| It validates the proposed levels and records a manual approval   |
//| in the Experts log for a separate, reviewed execution module.    |
//+------------------------------------------------------------------+
#property strict
#property version "0.10"
#property description "DARS Demo setup review panel - no broker order functions."

input string InpRequiredSymbol      = "XAUUSD-STD";
input double InpRiskPercent         = 0.25;
input double InpMaxSpreadPrice      = 0.50;
input double InpStopLossPrice       = 0.0; // Absolute price; enter in EA Inputs
input double InpTakeProfit1Price    = 0.0; // Absolute price; enter in EA Inputs
input double InpTakeProfit2Price    = 0.0; // Absolute price; enter in EA Inputs
input bool   InpDemoOnly            = true;

string BTN_BUY="DARS_REVIEW_BUY";
string BTN_SELL="DARS_REVIEW_SELL";
string g_status="WAITING FOR SETUP LEVELS";

void MakeButton(const string name,const string label,const int x,const color bg)
{
   ObjectDelete(0,name);
   ObjectCreate(0,name,OBJ_BUTTON,0,0,0);
   ObjectSetInteger(0,name,OBJPROP_CORNER,CORNER_LEFT_UPPER);
   ObjectSetInteger(0,name,OBJPROP_XDISTANCE,x);
   ObjectSetInteger(0,name,OBJPROP_YDISTANCE,25);
   ObjectSetInteger(0,name,OBJPROP_XSIZE,145);
   ObjectSetInteger(0,name,OBJPROP_YSIZE,30);
   ObjectSetInteger(0,name,OBJPROP_BGCOLOR,bg);
   ObjectSetInteger(0,name,OBJPROP_COLOR,clrWhite);
   ObjectSetInteger(0,name,OBJPROP_FONTSIZE,9);
   ObjectSetString(0,name,OBJPROP_TEXT,label);
   ObjectSetInteger(0,name,OBJPROP_STATE,false);
}

int OnInit()
{
   if(InpDemoOnly && AccountInfoInteger(ACCOUNT_TRADE_MODE)!=ACCOUNT_TRADE_MODE_DEMO)
   {
      Print("DARS PANEL LOCKED: Attach to a VT Markets DEMO account only.");
      return INIT_FAILED;
   }
   if(_Symbol!=InpRequiredSymbol)
   {
      Print("DARS PANEL: Attach to ",InpRequiredSymbol,". Current chart=",_Symbol);
      return INIT_FAILED;
   }
   if(InpRiskPercent<=0.0 || InpRiskPercent>0.50 || InpMaxSpreadPrice<=0.0)
      return INIT_PARAMETERS_INCORRECT;

   MakeButton(BTN_BUY,"REVIEW / APPROVE BUY",20,clrDarkGreen);
   MakeButton(BTN_SELL,"REVIEW / APPROVE SELL",175,clrFireBrick);
   EventSetTimer(1);
   DrawPanel();
   Print("DARS Demo setup panel ready. Buttons only validate and log approval; NO orders are sent.");
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   EventKillTimer();
   ObjectDelete(0,BTN_BUY);
   ObjectDelete(0,BTN_SELL);
   Comment("");
}

bool ValidateSetup(const bool buy,string &reason,double &entry,double &spread)
{
   if(InpDemoOnly && AccountInfoInteger(ACCOUNT_TRADE_MODE)!=ACCOUNT_TRADE_MODE_DEMO)
   { reason="DEMO ACCOUNT REQUIRED"; return false; }
   if(_Symbol!=InpRequiredSymbol)
   { reason="WRONG SYMBOL"; return false; }
   if(InpStopLossPrice<=0 || InpTakeProfit1Price<=0 || InpTakeProfit2Price<=0)
   { reason="SET SL, TP1 AND TP2 IN EA INPUTS"; return false; }

   MqlTick tick;
   if(!SymbolInfoTick(_Symbol,tick) || tick.bid<=0 || tick.ask<=0)
   { reason="NO VALID MARKET QUOTE"; return false; }

   spread=tick.ask-tick.bid;
   if(spread>InpMaxSpreadPrice)
   { reason="SPREAD ABOVE LIMIT"; return false; }

   entry=buy?tick.ask:tick.bid;
   if(buy && !(InpStopLossPrice<entry && InpTakeProfit1Price>entry && InpTakeProfit2Price>InpTakeProfit1Price))
   { reason="BUY LEVELS MUST BE SL < ENTRY < TP1 < TP2"; return false; }
   if(!buy && !(InpStopLossPrice>entry && InpTakeProfit1Price<entry && InpTakeProfit2Price<InpTakeProfit1Price))
   { reason="SELL LEVELS MUST BE SL > ENTRY > TP1 > TP2"; return false; }

   double point=SymbolInfoDouble(_Symbol,SYMBOL_POINT);
   long stops=(long)SymbolInfoInteger(_Symbol,SYMBOL_TRADE_STOPS_LEVEL);
   double minDistance=(double)stops*point;
   if(MathAbs(entry-InpStopLossPrice)<minDistance || MathAbs(InpTakeProfit2Price-entry)<minDistance)
   { reason="SL OR TP2 TOO CLOSE TO MARKET FOR BROKER RULES"; return false; }

   reason="LEVELS VALIDATED";
   return true;
}

void Review(const bool buy)
{
   string reason;
   double entry=0.0,spread=0.0;
   bool valid=ValidateSetup(buy,reason,entry,spread);
   if(!valid)
   {
      g_status="REJECTED: "+reason;
      Print("DARS ",g_status);
      DrawPanel();
      return;
   }

   g_status=StringFormat("MANUAL APPROVAL RECORDED: %s - NO ORDER SENT",buy?"BUY":"SELL");
   Print("DARS ",g_status,
         " | Symbol=",_Symbol,
         " | Entry=",DoubleToString(entry,_Digits),
         " | SL=",DoubleToString(InpStopLossPrice,_Digits),
         " | TP1=",DoubleToString(InpTakeProfit1Price,_Digits),
         " | TP2=",DoubleToString(InpTakeProfit2Price,_Digits),
         " | Spread=",DoubleToString(spread,_Digits),
         " | Risk setting=",DoubleToString(InpRiskPercent,2),"%");
   Alert("DARS setup levels validated for ",buy?"BUY":"SELL",
         ". This panel does NOT place an order. Place/confirm any Demo order manually in MT5.");
   DrawPanel();
}

void DrawPanel()
{
   MqlTick tick;
   double bid=0,ask=0,spread=0;
   if(SymbolInfoTick(_Symbol,tick))
   {
      bid=tick.bid; ask=tick.ask; spread=ask-bid;
   }
   Comment("DARS DEMO SETUP REVIEW v0.10\n",
           "Account: ",(AccountInfoInteger(ACCOUNT_TRADE_MODE)==ACCOUNT_TRADE_MODE_DEMO?"DEMO":"NOT DEMO"),
           " | Symbol: ",_Symbol,"\n",
           "Bid: ",DoubleToString(bid,_Digits)," | Ask: ",DoubleToString(ask,_Digits),
           " | Spread: ",DoubleToString(spread,_Digits),"\n",
           "Risk reference: ",DoubleToString(InpRiskPercent,2),"% (display only; no sizing/order)\n",
           "SL: ",DoubleToString(InpStopLossPrice,_Digits),
           " | TP1: ",DoubleToString(InpTakeProfit1Price,_Digits),
           " | TP2: ",DoubleToString(InpTakeProfit2Price,_Digits),"\n",
           "STATUS: ",g_status,"\n",
           "IMPORTANT: Review buttons do not send, modify or close broker orders.");
}

void OnChartEvent(const int id,const long &lparam,const double &dparam,const string &sparam)
{
   if(id!=CHARTEVENT_OBJECT_CLICK) return;
   if(sparam==BTN_BUY) Review(true);
   if(sparam==BTN_SELL) Review(false);
   ObjectSetInteger(0,sparam,OBJPROP_STATE,false);
   ChartRedraw();
}

void OnTimer(){ DrawPanel(); }
void OnTick(){ DrawPanel(); }
//+------------------------------------------------------------------+
