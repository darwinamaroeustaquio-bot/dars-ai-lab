//+------------------------------------------------------------------+
//| Dars_AI_Lab_History_Bridge.mq5                                   |
//| Read-only historical candles + closed-deal exporter for Dars AI  |
//+------------------------------------------------------------------+
#property strict
#property version "1.10"
#property description "Exports closed M5/M15/H1 candles and closed deal history; never trades."

input string ApiEndpoint = "https://dars-indol.vercel.app/api/mt5-history";
input string BridgeToken = "SET_THE_SAME_RANDOM_TOKEN_IN_VERCEL";
input string SymbolsCSV = "XAUUSD-STD";
input int CandlesPerTimeframe = 500;
input int HistoryDays = 90;
input int MaxDealsPerBatch = 100;
input int SendEverySeconds = 300;

string EscapeJson(string s)
{
   StringReplace(s, "\\", "\\\\");
   StringReplace(s, "\"", "\\\"");
   StringReplace(s, "\r", "");
   StringReplace(s, "\n", " ");
   return s;
}
bool IsAllowedFrame(ENUM_TIMEFRAMES tf)
{
   return tf==PERIOD_M5 || tf==PERIOD_M15 || tf==PERIOD_H1;
}
string FrameName(ENUM_TIMEFRAMES tf)
{
   if(tf==PERIOD_M5) return "M5";
   if(tf==PERIOD_M15) return "M15";
   if(tf==PERIOD_H1) return "H1";
   return "UNKNOWN";
}
void AppendCandles(string &out, bool &first, const string symbol, ENUM_TIMEFRAMES tf)
{
   MqlRates rates[];
   ArraySetAsSeries(rates,false);
   int copied=CopyRates(symbol,tf,1,MathMax(10,MathMin(500,CandlesPerTimeframe)),rates);
   if(copied<=0) { Print("No candles loaded for ",symbol," ",FrameName(tf),"; error=",GetLastError()); return; }
   int digits=(int)SymbolInfoInteger(symbol,SYMBOL_DIGITS);
   for(int i=0;i<copied;i++)
   {
      if(!first) out+=",";
      first=false;
      out+="{\"symbol\":\""+EscapeJson(symbol)+"\",\"timeframe\":\""+FrameName(tf)+
           "\",\"time\":"+(string)(long)rates[i].time+
           ",\"open\":"+DoubleToString(rates[i].open,digits)+
           ",\"high\":"+DoubleToString(rates[i].high,digits)+
           ",\"low\":"+DoubleToString(rates[i].low,digits)+
           ",\"close\":"+DoubleToString(rates[i].close,digits)+
           ",\"tick_volume\":"+(string)rates[i].tick_volume+"}";
   }
}
void AppendClosedDeals(string &out, bool &first)
{
   datetime to=TimeCurrent(), from=to-(datetime)(MathMax(1,HistoryDays)*86400);
   if(!HistorySelect(from,to)) { Print("HistorySelect failed: ",GetLastError()); return; }
   int total=HistoryDealsTotal();
   int sent=0;
   for(int i=total-1;i>=0 && sent<MathMax(1,MathMin(100,MaxDealsPerBatch));i--)
   {
      ulong ticket=HistoryDealGetTicket(i);
      if(ticket==0) continue;
      long entry=HistoryDealGetInteger(ticket,DEAL_ENTRY);
      if(entry!=DEAL_ENTRY_OUT && entry!=DEAL_ENTRY_OUT_BY && entry!=DEAL_ENTRY_INOUT) continue;
      string symbol=HistoryDealGetString(ticket,DEAL_SYMBOL);
      datetime tm=(datetime)HistoryDealGetInteger(ticket,DEAL_TIME);
      if(!first) out+=",";
      first=false;
      out+="{\"ticket\":"+(string)ticket+
         ",\"symbol\":\""+EscapeJson(symbol)+
         "\",\"time\":"+(string)(long)tm+
         ",\"type\":"+(string)HistoryDealGetInteger(ticket,DEAL_TYPE)+
         ",\"entry\":"+(string)entry+
         ",\"volume\":"+DoubleToString(HistoryDealGetDouble(ticket,DEAL_VOLUME),2)+
         ",\"price\":"+DoubleToString(HistoryDealGetDouble(ticket,DEAL_PRICE),8)+
         ",\"profit\":"+DoubleToString(HistoryDealGetDouble(ticket,DEAL_PROFIT),2)+
         ",\"commission\":"+DoubleToString(HistoryDealGetDouble(ticket,DEAL_COMMISSION),2)+
         ",\"swap\":"+DoubleToString(HistoryDealGetDouble(ticket,DEAL_SWAP),2)+
         ",\"fee\":"+DoubleToString(HistoryDealGetDouble(ticket,DEAL_FEE),2)+
         ",\"position_id\":"+(string)HistoryDealGetInteger(ticket,DEAL_POSITION_ID)+"}";
      sent++;
   }
}
bool PostPayload(const string payload)
{
   char data[],result[];
   string resultHeaders;
   StringToCharArray(payload,data,0,WHOLE_ARRAY,CP_UTF8);
   if(ArraySize(data)>0) ArrayResize(data,ArraySize(data)-1);
   string headers="Content-Type: application/json\r\nX-Bridge-Token: "+BridgeToken+"\r\n";
   ResetLastError();
   int status=WebRequest("POST",ApiEndpoint,headers,20000,data,result,resultHeaders);
   string reply=CharArrayToString(result,0,WHOLE_ARRAY,CP_UTF8);
   if(status!=200) { Print("History bridge failed. HTTP=",status," MT5 error=",GetLastError()," response=",reply); return false; }
   Print("History bridge OK: ",reply);
   return true;
}
void ExportHistory()
{
   if(StringFind(ApiEndpoint,"YOUR-VERCEL-DOMAIN")>=0 || StringLen(BridgeToken)<24 || StringFind(BridgeToken,"SET_THE_SAME")>=0)
   { Print("Set ApiEndpoint and BridgeToken in Inputs first."); return; }
   string candles="";
   bool first=true;
   string symbols[];
   int n=StringSplit(SymbolsCSV,',',symbols);
   ENUM_TIMEFRAMES frames[3]={PERIOD_M5,PERIOD_M15,PERIOD_H1};
   for(int s=0;s<n;s++)
   {
      StringTrimLeft(symbols[s]); StringTrimRight(symbols[s]);
      if(symbols[s]=="") continue;
      if(!SymbolSelect(symbols[s],true)) { Print("Symbol not available: ",symbols[s]); continue; }
      for(int f=0;f<3;f++) AppendCandles(candles,first,symbols[s],frames[f]);
   }
   string deals="";
   first=true;
   AppendClosedDeals(deals,first);
   string payload="{\"version\":1,\"account\":\""+(string)AccountInfoInteger(ACCOUNT_LOGIN)+
      "\",\"symbol\":\""+EscapeJson(Symbol())+"\",\"candles\":["+candles+"],\"deals\":["+deals+"]}";
   PostPayload(payload);
}
int OnInit()
{
   EventSetTimer(MathMax(60,SendEverySeconds));
   Print("Dars AI Lab History Bridge started (read-only; no order functions).");
   ExportHistory();
   return INIT_SUCCEEDED;
}
void OnDeinit(const int reason){EventKillTimer();}
void OnTimer(){ExportHistory();}
