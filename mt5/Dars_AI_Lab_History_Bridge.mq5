//+------------------------------------------------------------------+
//| Dars_AI_Lab_History_Bridge.mq5                                   |
//| Read-only exporter: candles + closed deal history to Vercel       |
//+------------------------------------------------------------------+
#property strict
#property version   "1.00"
#property description "Read-only MT5 candles and closed-deal history exporter"

input string ApiEndpoint = "https://YOUR-VERCEL-DOMAIN.vercel.app/api/mt5-history";
input string BridgeToken = "PASTE_THE_SAME_SECRET_AS_VERCEL_MT5_BRIDGE_TOKEN";
input string SymbolsCSV = "XAUUSD-STD";
input string TimeframesCSV = "M5,M15,H1";
input int    CandlesPerTimeframe = 100;
input int    HistoryDays = 90;
input int    SendEverySeconds = 60;
input int    MaxDealsPerBatch = 300;

string JsonEscape(string s)
{
   StringReplace(s, "\\", "\\\\");
   StringReplace(s, "\"", "\\\"");
   StringReplace(s, "\r", "");
   StringReplace(s, "\n", " ");
   return s;
}
string TFName(ENUM_TIMEFRAMES tf)
{
   if(tf==PERIOD_M5) return "M5";
   if(tf==PERIOD_M15) return "M15";
   if(tf==PERIOD_H1) return "H1";
   return EnumToString(tf);
}
void AddCandles(string &out, bool &first, string symbol, ENUM_TIMEFRAMES tf)
{
   MqlRates rates[];
   ArraySetAsSeries(rates, false);
   int copied=CopyRates(symbol, tf, 1, CandlesPerTimeframe, rates); // closed candles only
   if(copied<=0) { Print("CopyRates failed for ",symbol," ",TFName(tf),": ",GetLastError()); return; }
   for(int i=0;i<copied;i++)
   {
      if(!first) out+=",";
      first=false;
      out+="{\"symbol\":\""+JsonEscape(symbol)+"\",\"timeframe\":\""+TFName(tf)+
           "\",\"time\":\""+TimeToString(rates[i].time,TIME_DATE|TIME_MINUTES)+
           "\",\"open\":"+DoubleToString(rates[i].open,_Digits)+
           ",\"high\":"+DoubleToString(rates[i].high,_Digits)+
           ",\"low\":"+DoubleToString(rates[i].low,_Digits)+
           ",\"close\":"+DoubleToString(rates[i].close,_Digits)+
           ",\"tick_volume\":"+(string)rates[i].tick_volume+
           ",\"spread\":"+(string)rates[i].spread+
           ",\"real_volume\":"+(string)rates[i].real_volume+"}";
   }
}
void AddDeals(string &out, bool &first)
{
   datetime to=TimeCurrent();
   datetime from=to-(datetime)(HistoryDays*86400);
   if(!HistorySelect(from,to)) { Print("HistorySelect failed: ",GetLastError()); return; }
   int total=HistoryDealsTotal();
   int start=MathMax(0,total-MaxDealsPerBatch);
   for(int i=start;i<total;i++)
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
           ",\"symbol\":\""+JsonEscape(symbol)+
           "\",\"time\":\""+TimeToString(tm,TIME_DATE|TIME_SECONDS)+
           "\",\"type\":"+(string)HistoryDealGetInteger(ticket,DEAL_TYPE)+
           ",\"entry\":"+(string)entry+
           ",\"volume\":"+DoubleToString(HistoryDealGetDouble(ticket,DEAL_VOLUME),2)+
           ",\"price\":"+DoubleToString(HistoryDealGetDouble(ticket,DEAL_PRICE),8)+
           ",\"profit\":"+DoubleToString(HistoryDealGetDouble(ticket,DEAL_PROFIT),2)+
           ",\"commission\":"+DoubleToString(HistoryDealGetDouble(ticket,DEAL_COMMISSION),2)+
           ",\"swap\":"+DoubleToString(HistoryDealGetDouble(ticket,DEAL_SWAP),2)+
           ",\"fee\":"+DoubleToString(HistoryDealGetDouble(ticket,DEAL_FEE),2)+
           ",\"position_id\":"+(string)HistoryDealGetInteger(ticket,DEAL_POSITION_ID)+"}";
   }
}
void SendHistory()
{
   if(StringFind(ApiEndpoint,"YOUR-VERCEL-DOMAIN")>=0 || StringLen(BridgeToken)<20)
   { Print("Set ApiEndpoint and BridgeToken in EA Inputs first."); return; }

   string candles="", deals="";
   bool first=true;
   string symbols[];
   int sn=StringSplit(SymbolsCSV,',',symbols);
   for(int s=0;s<sn;s++)
   {
      StringTrimLeft(symbols[s]); StringTrimRight(symbols[s]);
      if(symbols[s]=="") continue;
      if(!SymbolSelect(symbols[s],true)) { Print("Could not select symbol ",symbols[s]); continue; }
      ENUM_TIMEFRAMES tfs[3]={PERIOD_M5,PERIOD_M15,PERIOD_H1};
      string requested[];
      int tn=StringSplit(TimeframesCSV,',',requested);
      for(int t=0;t<tn;t++)
      {
         StringTrimLeft(requested[t]); StringTrimRight(requested[t]);
         ENUM_TIMEFRAMES tf=PERIOD_CURRENT;
         if(requested[t]=="M5") tf=PERIOD_M5;
         else if(requested[t]=="M15") tf=PERIOD_M15;
         else if(requested[t]=="H1") tf=PERIOD_H1;
         else continue;
         AddCandles(candles,first,symbols[s],tf);
      }
   }
   first=true;
   AddDeals(deals,first);
   string account=(string)AccountInfoInteger(ACCOUNT_LOGIN);
   string symbol=Symbol();
   string payload="{\"version\":1,\"account\":\""+account+
                  "\",\"symbol\":\""+JsonEscape(symbol)+
                  "\",\"timeframe\":\"MULTI\",\"candles\":["+candles+
                  "],\"deals\":["+deals+"]}";
   char data[], result[];
   string result_headers;
   StringToCharArray(payload,data,0,WHOLE_ARRAY,CP_UTF8);
   if(ArraySize(data)>0) ArrayResize(data,ArraySize(data)-1);
   string headers="Content-Type: application/json\r\nX-Bridge-Token: "+BridgeToken+"\r\n";
   ResetLastError();
   int status=WebRequest("POST",ApiEndpoint,headers,15000,data,result,result_headers);
   if(status==-1) { Print("WebRequest failed: ",GetLastError(),". Add your Vercel domain under MT5 Tools > Options > Expert Advisors > WebRequest."); return; }
   string response=CharArrayToString(result,0,WHOLE_ARRAY,CP_UTF8);
   Print("Dars history bridge HTTP ",status,": ",response);
}
int OnInit()
{
   if(SendEverySeconds<15) SendEverySeconds=15;
   EventSetTimer(SendEverySeconds);
   Print("Dars AI Lab History Bridge initialized (read-only).");
   SendHistory();
   return INIT_SUCCEEDED;
}
void OnDeinit(const int reason) { EventKillTimer(); }
void OnTimer() { SendHistory(); }
