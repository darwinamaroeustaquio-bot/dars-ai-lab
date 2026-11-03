//+------------------------------------------------------------------+
//| DARS_DEMO_BRIDGE_EXECUTOR_v1_14.mq5                                    |
//| Authenticated DARS Robot -> MT5 Demo command bridge (STD/VIP)              |
//| Robot setups are polled with MT5_BRIDGE_TOKEN.                   |
//| NO order is sent until the user clicks APPROVE on the chart.     |
//+------------------------------------------------------------------+
#property strict
#property version "1.14"
#property description "DARS all-in-one authenticated quote, candle and Demo execution bridge for XAUUSD-STD or XAUUSD-VIP. Fixed 0.01 lot."

#include <Trade/Trade.mqh>
CTrade trade;

input string InpApiBaseURL          = "https://dars-indol.vercel.app";
input string InpBridgeToken         = ""; // Paste the SAME MT5_BRIDGE_TOKEN configured in Vercel
input string InpSymbol              = ""; // Leave blank to use the current chart symbol
input int    InpPollSeconds         = 1;
input int    InpCandleRefreshSeconds = 30;
input int    InpBarsPerTimeframe    = 500;
input double InpRiskPercent         = 0.25; // Risk ceiling; order size is fixed at 0.01 lot
input double InpMaxDailyLossPct     = 1.00;
input int    InpMaxTradesPerDay     = 3;
input double InpMaxSpreadPrice      = 0.50;
input double InpMaxEntryDriftPrice  = 1.00;
input ulong  InpMagic               = 6110303;
input int    InpDeviationPoints     = 30;

string BTN_APPROVE="DARS_CMD_APPROVE";
string BTN_REJECT="DARS_CMD_REJECT";
string g_status="INITIALIZING";
string g_symbol="";
string g_commandId="";
string g_side="";
string g_strategy="";
double g_entry=0,g_sl=0,g_tp1=0,g_tp2=0,g_score=0;
datetime g_lastPoll=0;
int g_candleElapsed=0;
int g_quotePosts=0;
bool g_tp1Alerted=false;
ulong g_tp1Ticket=0;

string JsonString(const string src,const string key)
{
   string needle="\""+key+"\"";
   int p=StringFind(src,needle);
   if(p<0) return "";
   p=StringFind(src,":",p+StringLen(needle));
   if(p<0) return "";
   p=StringFind(src,"\"",p+1);
   if(p<0) return "";
   int e=StringFind(src,"\"",p+1);
   if(e<0) return "";
   return StringSubstr(src,p+1,e-p-1);
}

double JsonNumber(const string src,const string key)
{
   string needle="\""+key+"\"";
   int p=StringFind(src,needle);
   if(p<0) return 0.0;
   p=StringFind(src,":",p+StringLen(needle));
   if(p<0) return 0.0;
   p++;
   while(p<StringLen(src) && (StringGetCharacter(src,p)==' ' || StringGetCharacter(src,p)=='\t')) p++;
   int e=p;
   while(e<StringLen(src))
   {
      ushort c=StringGetCharacter(src,e);
      if(c==',' || c=='}' || c==']' || c==' ' || c=='\r' || c=='\n') break;
      e++;
   }
   if(e<=p) return 0.0;
   return StringToDouble(StringSubstr(src,p,e-p));
}

string JsonEscape(const string value)
{
   string out=value;
   StringReplace(out,"\\","\\\\");
   StringReplace(out,"\"","\\\"");
   StringReplace(out,"\r","");
   StringReplace(out,"\n"," ");
   return out;
}

bool DemoAccount()
{
   return AccountInfoInteger(ACCOUNT_TRADE_MODE)==ACCOUNT_TRADE_MODE_DEMO;
}

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

bool ApiRequest(const string method,const string path,const string payload,string &response,int &httpCode)
{
   char data[],result[];
   string responseHeaders;
   ArrayResize(data,0);
   if(method=="POST")
   {
      StringToCharArray(payload,data,0,WHOLE_ARRAY,CP_UTF8);
      if(ArraySize(data)>0) ArrayResize(data,ArraySize(data)-1);
   }
   string headers="Accept: application/json\r\nX-Bridge-Token: "+InpBridgeToken+"\r\n";
   if(method=="POST") headers+="Content-Type: application/json\r\n";

   ResetLastError();
   httpCode=WebRequest(method,InpApiBaseURL+path,headers,8000,data,result,responseHeaders);
   response=CharArrayToString(result,0,-1,CP_UTF8);
   if(httpCode<0)
   {
      g_status="API CONNECTION ERROR "+IntegerToString(GetLastError())+" - check MT5 WebRequest allow-list";
      return false;
   }
   if(httpCode<200 || httpCode>=300)
   {
      g_status="API HTTP "+IntegerToString(httpCode)+": "+response;
      return false;
   }
   return true;
}


void SendQuoteData()
{
   MqlTick tick;
   if(!SymbolInfoTick(g_symbol,tick) || tick.bid<=0 || tick.ask<=0)
   {
      g_status="WAITING FOR LIVE MT5 QUOTE";
      return;
   }
   int digits=(int)SymbolInfoInteger(g_symbol,SYMBOL_DIGITS);
   double point=SymbolInfoDouble(g_symbol,SYMBOL_POINT);
   double spread=point>0?(tick.ask-tick.bid)/point:0;
   string payload=StringFormat("{\"symbol\":\"%s\",\"bid\":%s,\"ask\":%s,\"last\":%s,\"digits\":%d,\"spread\":%s}",
      g_symbol,DoubleToString(tick.bid,digits),DoubleToString(tick.ask,digits),DoubleToString(tick.last,digits),digits,DoubleToString(spread,1));
   string response;int code=0;
   if(ApiRequest("POST","/api/mt5-quote",payload,response,code))
   {
      g_quotePosts++;
      if(g_quotePosts==1 || g_quotePosts%10==0)
         Print("DARS quote OK: ",g_symbol," Bid=",DoubleToString(tick.bid,digits)," Ask=",DoubleToString(tick.ask,digits)," HTTP=",code);
   }
}

string BuildFrameJson(const ENUM_TIMEFRAMES tf,const string frameName,const int requestedBars)
{
   MqlRates rates[];
   ArraySetAsSeries(rates,false);
   int wanted=MathMax(2,MathMin(5000,requestedBars));
   ResetLastError();
   int copied=CopyRates(g_symbol,tf,0,wanted,rates);
   if(copied<MathMin(10,wanted))
   {
      Print("DARS waiting for ",frameName," history. CopyRates=",copied," error=",GetLastError());
      return "";
   }
   long offset=(long)(TimeCurrent()-TimeGMT());
   int digits=(int)SymbolInfoInteger(g_symbol,SYMBOL_DIGITS);
   string arr="[";
   for(int i=0;i<copied;i++)
   {
      if(i>0) arr+=",";
      datetime utcTime=(datetime)((long)rates[i].time-offset);
      arr+=StringFormat("{\"time\":%I64d,\"open\":%s,\"high\":%s,\"low\":%s,\"close\":%s,\"tick_volume\":%I64d}",
         (long)utcTime,DoubleToString(rates[i].open,digits),DoubleToString(rates[i].high,digits),
         DoubleToString(rates[i].low,digits),DoubleToString(rates[i].close,digits),(long)rates[i].tick_volume);
   }
   return arr+"]";
}

void PostCandleFrame(const ENUM_TIMEFRAMES tf,const string frameName,const int bars)
{
   string candles=BuildFrameJson(tf,frameName,bars);
   if(candles=="") return;
   string payload="{\"symbol\":\""+g_symbol+"\",\"timeframe\":\""+frameName+"\",\"candles\":"+candles+"}";
   string response;int code=0;
   if(ApiRequest("POST","/api/mt5-candles",payload,response,code))
      Print("DARS candles OK: ",g_symbol," ",frameName," bars=",bars," HTTP=",code);
}

void PostAllCandleFrames(const int bars)
{
   ENUM_TIMEFRAMES tfs[6]={PERIOD_M1,PERIOD_M5,PERIOD_M15,PERIOD_M30,PERIOD_H1,PERIOD_H4};
   string names[6]={"M1","M5","M15","M30","H1","H4"};
   string frames="{";
   int added=0;
   for(int i=0;i<6;i++)
   {
      string candles=BuildFrameJson(tfs[i],names[i],bars);
      if(candles=="") continue;
      if(added>0) frames+=",";
      frames+="\\""+names[i]+"\\":"+candles;
      added++;
   }
   frames+="}";
   if(added==0) return;
   string payload="{\\"symbol\\":\\""+g_symbol+"\\",\\"clock_basis\\":\\"broker\\",\\"frames\\":"+frames+"}";
   string response;int code=0;
   if(ApiRequest("POST","/api/mt5-candles",payload,response,code))
      Print("DARS candle batch OK: ",g_symbol," frames=",added," bars/frame=",bars," HTTP=",code);
}

void SendCandleHistory()
{
   PostAllCandleFrames(InpBarsPerTimeframe);
}

void SendLiveCandleUpdates()
{
   PostAllCandleFrames(3);
}

void ClearCommand()
{
   g_commandId="";g_side="";g_strategy="";
   g_entry=0;g_sl=0;g_tp1=0;g_tp2=0;g_score=0;
   g_tp1Alerted=false;g_tp1Ticket=0;
}

void PollCommand()
{
   if(StringLen(InpBridgeToken)<24)
   {
      g_status="LOCKED - paste valid Bridge Token in EA Inputs";
      return;
   }
   string response;int code=0;
   string path="/api/dars-execution-status?symbol="+g_symbol;
   if(!ApiRequest("GET",path,"",response,code)) return;
   if(StringFind(response,"\"ok\":true")<0)
   {
      g_status="API RESPONSE INVALID";
      return;
   }
   if(StringFind(response,"\"command\":null")>=0)
   {
      if(g_commandId=="") g_status="CONNECTED - waiting for DARS Robot setup";
      return;
   }
   string id=JsonString(response,"command_id");
   string side=JsonString(response,"side");
   if(id=="")
   {
      g_status="CONNECTED - no valid pending setup";
      return;
   }
   if(id==g_commandId) return;

   double entry=JsonNumber(response,"entry");
   double sl=JsonNumber(response,"stop_loss");
   double tp1=JsonNumber(response,"tp1");
   double tp2=JsonNumber(response,"tp2");
   if((side!="BUY" && side!="SELL") || entry<=0 || sl<=0 || tp1<=0 || tp2<=0)
   {
      g_status="REJECTED INVALID ROBOT SETUP DATA";
      return;
   }
   if(side=="BUY" && !(sl<entry && tp1>entry && tp2>tp1))
   {
      g_status="REJECTED INVALID BUY LEVEL ORDER";
      return;
   }
   if(side=="SELL" && !(sl>entry && tp1<entry && tp2<tp1))
   {
      g_status="REJECTED INVALID SELL LEVEL ORDER";
      return;
   }
   g_commandId=id;g_side=side;g_entry=entry;g_sl=sl;g_tp1=tp1;g_tp2=tp2;
   g_strategy=JsonString(response,"strategy");
   g_score=JsonNumber(response,"strategy_score");
   g_status="SETUP RECEIVED - CHECK LEVELS, THEN CLICK APPROVE";
   Alert("DARS Robot setup received: ",side," ",g_strategy,
         " | Entry ",DoubleToString(entry,_Digits),
         " | SL ",DoubleToString(sl,_Digits),
         " | TP1 ",DoubleToString(tp1,_Digits),
         " | TP2 ",DoubleToString(tp2,_Digits),
         ". No order sent until you approve.");
}

datetime TodayStart()
{
   MqlDateTime dt;TimeToStruct(TimeCurrent(),dt);
   dt.hour=0;dt.min=0;dt.sec=0;
   return StructToTime(dt);
}

int TradesToday()
{
   if(!HistorySelect(TodayStart(),TimeCurrent())) return 0;
   int count=0;
   for(int i=0;i<HistoryDealsTotal();i++)
   {
      ulong deal=HistoryDealGetTicket(i);
      if(deal==0) continue;
      if((ulong)HistoryDealGetInteger(deal,DEAL_MAGIC)!=InpMagic) continue;
      if(HistoryDealGetString(deal,DEAL_SYMBOL)!=g_symbol) continue;
      ENUM_DEAL_ENTRY e=(ENUM_DEAL_ENTRY)HistoryDealGetInteger(deal,DEAL_ENTRY);
      if(e==DEAL_ENTRY_IN || e==DEAL_ENTRY_INOUT) count++;
   }
   return count;
}

double TodayNet()
{
   if(!HistorySelect(TodayStart(),TimeCurrent())) return 0.0;
   double net=0;
   for(int i=0;i<HistoryDealsTotal();i++)
   {
      ulong deal=HistoryDealGetTicket(i);
      if(deal==0) continue;
      if((ulong)HistoryDealGetInteger(deal,DEAL_MAGIC)!=InpMagic) continue;
      if(HistoryDealGetString(deal,DEAL_SYMBOL)!=g_symbol) continue;
      net+=HistoryDealGetDouble(deal,DEAL_PROFIT)+HistoryDealGetDouble(deal,DEAL_SWAP)+HistoryDealGetDouble(deal,DEAL_COMMISSION);
   }
   return net;
}

bool HasPosition()
{
   for(int i=PositionsTotal()-1;i>=0;i--)
   {
      ulong t=PositionGetTicket(i);
      if(t==0) continue;
      // Block if ANY position already exists on this symbol (including manual trades).
      if(PositionGetString(POSITION_SYMBOL)==g_symbol) return true;
   }
   return false;
}

double LotForRisk(const ENUM_ORDER_TYPE type,const double entry,const double sl,string &why)
{
   // Fixed user-selected size: never scale up beyond 0.01 lots.
   const double lots=0.01;
   double minLot=SymbolInfoDouble(g_symbol,SYMBOL_VOLUME_MIN);
   double maxLot=SymbolInfoDouble(g_symbol,SYMBOL_VOLUME_MAX);
   double step=SymbolInfoDouble(g_symbol,SYMBOL_VOLUME_STEP);
   if(step<=0 || minLot<=0){why="Invalid broker volume specification";return 0;}
   if(lots<minLot-1e-8 || lots>maxLot+1e-8 || MathAbs(lots/step-MathRound(lots/step))>1e-6)
   {why="Broker does not support exactly 0.01 lot";return 0;}
   double oneLot=0;
   if(!OrderCalcProfit(type,g_symbol,1.0,entry,sl,oneLot) || oneLot>=0)
   {why="Cannot calculate stop risk from broker contract specifications";return 0;}
   double estimatedRisk=MathAbs(oneLot)*lots;
   double riskCash=AccountInfoDouble(ACCOUNT_BALANCE)*InpRiskPercent/100.0;
   if(estimatedRisk>riskCash*1.01)
   {why="Fixed 0.01 lot exceeds the configured risk cap; trade skipped";return 0;}
   return lots;
}

bool SendCommandStatus(const string status,const string ticket,const string note)
{
   if(g_commandId=="") return false;
   string payload="{\"command_id\":\""+JsonEscape(g_commandId)+"\",\"status\":\""+status+
      "\",\"broker_order_ticket\":\""+JsonEscape(ticket)+"\",\"execution_note\":\""+JsonEscape(note)+"\"}";
   string response;int code=0;
   if(!ApiRequest("POST","/api/dars-execution-status",payload,response,code))
   {
      Print("DARS status callback failed: ",g_status," response=",response);
      return false;
   }
   Print("DARS command status updated: ",response);
   return StringFind(response,"\"ok\":true")>=0;
}

void RejectCommand(const string reason)
{
   if(g_commandId=="") return;
   string oldId=g_commandId;
   SendCommandStatus("REJECTED","",reason);
   g_status="COMMAND REJECTED: "+reason;
   Print("DARS rejected command ",oldId,": ",reason);
   ClearCommand();
}

void ApproveAndExecute()
{
   if(!DemoAccount()){g_status="SAFETY LOCK - DEMO ACCOUNT REQUIRED";return;}
   if(_Symbol!=g_symbol){g_status="Attach EA to exact "+g_symbol+" chart";return;}
   if(g_commandId=="" || (g_side!="BUY" && g_side!="SELL")){g_status="No pending Robot setup to approve";return;}
   if(HasPosition()){g_status="BLOCKED - one DARS position already open";return;}
   if(TradesToday()>=InpMaxTradesPerDay){RejectCommand("Daily trade limit reached");return;}
   double maxLoss=AccountInfoDouble(ACCOUNT_BALANCE)*InpMaxDailyLossPct/100.0;
   if(TodayNet()<=-maxLoss){RejectCommand("Daily loss limit reached");return;}

   MqlTick tick;
   if(!SymbolInfoTick(g_symbol,tick) || tick.bid<=0 || tick.ask<=0){g_status="BLOCKED - no live quote";return;}
   double spread=tick.ask-tick.bid;
   if(spread>InpMaxSpreadPrice){g_status="BLOCKED - spread too wide";return;}
   double currentEntry=g_side=="BUY"?tick.ask:tick.bid;
   if(MathAbs(currentEntry-g_entry)>InpMaxEntryDriftPrice)
   {RejectCommand("Market moved too far from Robot entry; request a fresh setup");return;}

   ENUM_ORDER_TYPE type=g_side=="BUY"?ORDER_TYPE_BUY:ORDER_TYPE_SELL;
   string why="";
   double lots=LotForRisk(type,currentEntry,g_sl,why);
   if(lots<=0){RejectCommand(why);return;}
   double margin=0;
   if(!OrderCalcMargin(type,g_symbol,lots,currentEntry,margin) || margin>AccountInfoDouble(ACCOUNT_MARGIN_FREE))
   {RejectCommand("Insufficient free margin");return;}

   trade.SetExpertMagicNumber(InpMagic);
   trade.SetDeviationInPoints(InpDeviationPoints);
   trade.SetTypeFillingBySymbol(g_symbol);
   // Claim the one-time command before sending the broker request. If the terminal
   // crashes after this point, the server will not hand the same command to MT5 again.
   if(!SendCommandStatus("CLAIMED","","Manual approval clicked; validating broker order"))
   {
      g_status="ORDER BLOCKED - could not claim command on DARS server";
      return;
   }

   bool sent=false;
   string comment="DARS DEMO "+StringSubstr(g_commandId,0,12);
   if(g_side=="BUY")
      sent=trade.Buy(lots,g_symbol,0.0,NormalizeDouble(g_sl,_Digits),NormalizeDouble(g_tp2,_Digits),comment);
   else
      sent=trade.Sell(lots,g_symbol,0.0,NormalizeDouble(g_sl,_Digits),NormalizeDouble(g_tp2,_Digits),comment);

   uint rc=trade.ResultRetcode();
   if(!sent || (rc!=TRADE_RETCODE_DONE && rc!=TRADE_RETCODE_PLACED && rc!=TRADE_RETCODE_DONE_PARTIAL))
   {
      RejectCommand("Broker rejected order: "+trade.ResultRetcodeDescription());
      return;
   }

   string ticket=(string)trade.ResultOrder();
   string executedId=g_commandId;
   SendCommandStatus("EXECUTED",ticket,"Demo order opened; lots="+DoubleToString(lots,2));
   g_status="DEMO ORDER OPENED - "+g_side+" "+DoubleToString(lots,2)+" lots";
   Print(g_status," command=",executedId," order=",ticket," TP1 alert=",DoubleToString(g_tp1,_Digits)," TP2=",DoubleToString(g_tp2,_Digits));
   Alert("DARS DEMO order opened: ",g_side," ",DoubleToString(lots,2)," lots. TP1 alert ",DoubleToString(g_tp1,_Digits),".");
   ClearCommand();
}

void MonitorTP1()
{
   for(int i=PositionsTotal()-1;i>=0;i--)
   {
      ulong ticket=PositionGetTicket(i);
      if(ticket==0) continue;
      if(PositionGetString(POSITION_SYMBOL)!=g_symbol ||
         (ulong)PositionGetInteger(POSITION_MAGIC)!=InpMagic) continue;
      if(g_tp1Alerted && g_tp1Ticket==ticket) return;
      if(g_tp1<=0) return;
      MqlTick tick;if(!SymbolInfoTick(g_symbol,tick))return;
      long type=PositionGetInteger(POSITION_TYPE);
      bool hit=(type==POSITION_TYPE_BUY?tick.bid>=g_tp1:tick.ask<=g_tp1);
      if(hit)
      {
         g_tp1Alerted=true;g_tp1Ticket=ticket;
         g_status="TP1 REACHED - check DARS continuation decision";
         Alert("DARS: TP1 reached. Check Robot continuation decision. TP2 remains broker-side target.");
         Print(g_status," ticket=",ticket,". EA does not auto-close at TP1 in this version.");
      }
   }
}

void DrawPanel()
{
   MqlTick tick;
   double bid=0,ask=0;
   if(SymbolInfoTick(g_symbol,tick)){bid=tick.bid;ask=tick.ask;}
   Comment("DARS MT5 ALL-IN-ONE DEMO BRIDGE v1.11\n",
      "Bridge: ",(StringLen(InpBridgeToken)>=24?"TOKEN SET":"TOKEN MISSING"),
      " | Account: ",(DemoAccount()?"DEMO":"NOT DEMO"),"\n",
      "API: ",InpApiBaseURL," | Symbol: ",g_symbol,"\n",
      "Bid: ",DoubleToString(bid,_Digits)," Ask: ",DoubleToString(ask,_Digits),
      " Spread: ",DoubleToString(ask-bid,_Digits),"\n",
      "Pending: ",(g_commandId==""?"NONE":g_commandId),"\n",
      "Robot: ",g_side," ",g_strategy," Score: ",DoubleToString(g_score,1),"%\n",
      "Entry: ",DoubleToString(g_entry,_Digits)," SL: ",DoubleToString(g_sl,_Digits),
      " TP1: ",DoubleToString(g_tp1,_Digits)," TP2: ",DoubleToString(g_tp2,_Digits),"\n",
      "Risk: ",DoubleToString(InpRiskPercent,2),"% | Trades today: ",TradesToday(),"/",InpMaxTradesPerDay,
      " | Daily P/L: ",DoubleToString(TodayNet(),2),"\n",
      "STATUS: ",g_status,"\n",
      "Quote + candles + Robot command bridge active. Manual approval required. DEMO ONLY. TP1 alert-only.");
}

int OnInit()
{
   string requestedSymbol=InpSymbol;
   StringTrimLeft(requestedSymbol);
   StringTrimRight(requestedSymbol);
   StringToUpper(requestedSymbol);
   if(requestedSymbol=="" || requestedSymbol=="XAUUSD-STD OR XAUUSD-VIP" || requestedSymbol=="AUTO")
      g_symbol=_Symbol;
   else
      g_symbol=requestedSymbol;
   if(g_symbol!="XAUUSD-STD" && g_symbol!="XAUUSD-VIP")
   {
      Print("DARS supports XAUUSD-STD or XAUUSD-VIP only. Selected symbol=",g_symbol);
      return INIT_FAILED;
   }
   if(_Symbol!=g_symbol)
   {
      Print("Attach this EA to ",g_symbol," chart. Current chart=",_Symbol);
      return INIT_FAILED;
   }
   if(!DemoAccount()){Print("DARS safety lock: this EA only starts on a DEMO account.");return INIT_FAILED;}
   if(StringLen(InpBridgeToken)<24){Print("Enter the same MT5_BRIDGE_TOKEN in EA Inputs.");g_status="TOKEN REQUIRED";}
   if(InpPollSeconds<1 || InpRiskPercent<=0 || InpRiskPercent>0.50 ||
      InpMaxDailyLossPct<=0 || InpMaxDailyLossPct>2.0 ||
      InpMaxTradesPerDay<1 || InpMaxTradesPerDay>10)
      return INIT_PARAMETERS_INCORRECT;

   MakeButton(BTN_APPROVE,"APPROVE DEMO ORDER",20,clrDarkGreen);
   MakeButton(BTN_REJECT,"REJECT SETUP",175,clrFireBrick);
   EventSetTimer(InpPollSeconds);
   if(StringLen(InpBridgeToken)>=24)
   {
      SendQuoteData();
      SendCandleHistory();
      PollCommand();
   }
   DrawPanel();
   Print("DARS Demo Executor started. No order will be sent without chart approval.");
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   EventKillTimer();ObjectDelete(0,BTN_APPROVE);ObjectDelete(0,BTN_REJECT);Comment("");
}

void OnTimer()
{
   if(StringLen(InpBridgeToken)>=24)
   {
      SendQuoteData();
      SendLiveCandleUpdates();
      if(g_commandId=="") PollCommand();
      g_candleElapsed+=InpPollSeconds;
      if(g_candleElapsed>=MathMax(10,InpCandleRefreshSeconds))
      {
         g_candleElapsed=0;
         SendCandleHistory();
      }
   }
   DrawPanel();
}

void OnTick()
{
   MonitorTP1();
   DrawPanel();
}

void OnChartEvent(const int id,const long &lparam,const double &dparam,const string &sparam)
{
   if(id!=CHARTEVENT_OBJECT_CLICK)return;
   if(sparam==BTN_APPROVE) ApproveAndExecute();
   if(sparam==BTN_REJECT) RejectCommand("Manually rejected by user in MT5 chart");
   ObjectSetInteger(0,sparam,OBJPROP_STATE,false);
   ChartRedraw();
}
//+------------------------------------------------------------------+
