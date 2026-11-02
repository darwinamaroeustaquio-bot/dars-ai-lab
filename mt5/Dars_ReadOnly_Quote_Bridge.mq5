// Dars AI Lab - VT Markets MT5 Read-only Quote + Candle Bridge
// Sends quote snapshots and M1/M5/M15/M30/H1/H4 candle history. DOES NOT trade.
#property strict
#property version "1.25"
#property description "Read-only quote and candle sender for Dars AI Lab"

input string ApiEndpoint = "https://dars-indol.vercel.app/api/mt5-quote";
input string CandleEndpoint = "https://dars-indol.vercel.app/api/mt5-candles";
input string HistoryEndpoint = "https://dars-indol.vercel.app/api/mt5-history";
input int SendNewsEverySeconds = 300;
input string BridgeToken = "SET_THE_SAME_RANDOM_TOKEN_IN_VERCEL";
input string SymbolsCsv = "XAUUSD-STD";
input int SendEverySeconds = 3;
input int SendCandlesEverySeconds = 60;
input int BarsPerTimeframe = 500;

string symbols[];
int candleTimer = 0;
int quoteSendCount = 0;
int quoteTickMissCount = 0;
int newsElapsed = 0;

int OnInit()
{
   if(StringFind(ApiEndpoint, "YOUR-VERCEL-DOMAIN") >= 0 || StringFind(CandleEndpoint, "YOUR-VERCEL-DOMAIN") >= 0 || StringLen(BridgeToken) < 24 || StringFind(BridgeToken,"SET_THE_SAME") >= 0)
   {
      Print("Configure ApiEndpoint, CandleEndpoint and the same long BridgeToken in Vercel first.");
      return INIT_PARAMETERS_INCORRECT;
   }
   int count=StringSplit(SymbolsCsv,',',symbols);
   if(count<1) return INIT_PARAMETERS_INCORRECT;
   for(int i=0;i<count;i++){StringTrimLeft(symbols[i]);StringTrimRight(symbols[i]);if(StringLen(symbols[i])>0)SymbolSelect(symbols[i],true);}
   EventSetTimer(MathMax(1,SendEverySeconds));
   Print("Dars read-only quote + candle bridge started. No order functions are used.");
   // Upload candle history immediately at startup instead of waiting five minutes.
   for(int i=0;i<ArraySize(symbols);i++){string sym=symbols[i];if(StringLen(sym)>0)SendCandles(sym);}
   return INIT_SUCCEEDED;
}
void OnDeinit(const int reason){EventKillTimer();}
bool PostJson(const string endpoint,const string payload,const string label)
{
   char data[],result[]; string resultHeaders;
   StringToCharArray(payload,data,0,WHOLE_ARRAY,CP_UTF8);
   if(ArraySize(data)>0)ArrayResize(data,ArraySize(data)-1);
   string headers="Content-Type: application/json\r
X-Bridge-Token: "+BridgeToken+"\r
";
   ResetLastError();
   int code=WebRequest("POST",endpoint,headers,10000,data,result,resultHeaders);
   string responseText=CharArrayToString(result,0,-1,CP_UTF8);
   if(code>=200 && code<300){ Print("Dars ",label," HTTP OK: ",code," response=",responseText); return true; }
   Print("Dars ",label," failed. HTTP=",code," MT5 error=",GetLastError()," response=",responseText,
         ". Check MT5 WebRequest allow-list, exact BridgeToken, endpoint and Vercel Function Logs.");
   return false;
}

string EscapeNewsJson(string s)
{
   StringReplace(s, "\\", "\\\\");
   StringReplace(s, "\"", "\\\"");
   StringReplace(s, "\r", "");
   StringReplace(s, "\n", " ");
   return s;
}
string NewsImportance(const ENUM_CALENDAR_EVENT_IMPORTANCE importance)
{
   if(importance==CALENDAR_IMPORTANCE_HIGH) return "high";
   if(importance==CALENDAR_IMPORTANCE_MODERATE) return "moderate";
   if(importance==CALENDAR_IMPORTANCE_LOW) return "low";
   return "unknown";
}
string NewsMetric(const long value)
{
   if(value==LONG_MIN) return "null";
   return DoubleToString((double)value/1000000.0,6);
}
void SendNewsCalendar(const string sym)
{
   MqlCalendarValue values[];
   datetime from=TimeCurrent()-86400;
   datetime to=TimeCurrent()+30*86400;
   ResetLastError();
   int total=CalendarValueHistory(values,from,to);
   if(total<0)
   {
      Print("DARS NEWS UNAVAILABLE: MT5 CalendarValueHistory error=",GetLastError());
      return;
   }
   int sent=0;
   string newsJson="[";
   for(int i=0;i<MathMin(total,900);i++)
   {
      MqlCalendarEvent event;
      MqlCalendarCountry country;
      if(!CalendarEventById(values[i].event_id,event)) continue;
      if(!CalendarCountryById(event.country_id,country)) continue;
      if(country.currency!="USD") continue;
      if(sent>0) newsJson+=",";
      newsJson+="{\"event_id\":"+(string)values[i].event_id+
         ",\"event_time\":"+(string)(long)values[i].time+
         ",\"currency\":\"USD\""+
         ",\"event_name\":\""+EscapeNewsJson(event.name)+"\""+
         ",\"importance\":\""+NewsImportance(event.importance)+"\""+
         ",\"impact_type\":"+(string)values[i].impact_type+
         ",\"actual_value\":"+NewsMetric(values[i].actual_value)+
         ",\"forecast_value\":"+NewsMetric(values[i].forecast_value)+
         ",\"previous_value\":"+NewsMetric(values[i].prev_value)+"}";
      sent++;
   }
   newsJson+="]";
   string newsPayload="{\"version\":1,\"account\":\""+(string)AccountInfoInteger(ACCOUNT_LOGIN)+
      "\",\"symbol\":\""+sym+"\",\"candles\":[],\"deals\":[],\"news\":"+newsJson+"}";
   if(PostJson(HistoryEndpoint,newsPayload,"news calendar "+sym))
      Print("DARS NEWS UPLOADED: ",sent," USD economic-calendar events.");
}
 
void SendQuote(const string sym)
{
   MqlTick tick;
   if(!SymbolInfoTick(sym,tick)||tick.bid<=0||tick.ask<=0){
      quoteTickMissCount++;
      if(quoteTickMissCount==1 || quoteTickMissCount%20==0)
         Print("Dars quote waiting for valid tick: symbol=",sym,
               " selected=",SymbolInfoInteger(sym,SYMBOL_SELECT),
               " tick_misses=",quoteTickMissCount," MT5 error=",GetLastError(),
               ". Confirm this exact broker symbol is visible in Market Watch and the market has a quote.");
      return;
   }
   int quoteDigits=(int)SymbolInfoInteger(sym,SYMBOL_DIGITS);
   double point=SymbolInfoDouble(sym,SYMBOL_POINT);
   double spread=point>0?(tick.ask-tick.bid)/point:0;
   string quotePayload=StringFormat("{\"symbol\":\"%s\",\"bid\":%s,\"ask\":%s,\"last\":%s,\"digits\":%d,\"spread\":%s}",
      sym,DoubleToString(tick.bid,quoteDigits),DoubleToString(tick.ask,quoteDigits),DoubleToString(tick.last,quoteDigits),quoteDigits,DoubleToString(spread,1));
   if(PostJson(ApiEndpoint,quotePayload,"quote "+sym)){
      quoteSendCount++;
      if(quoteSendCount==1 || quoteSendCount%10==0)
         Print("Dars quote OK: ",sym," Bid=",DoubleToString(tick.bid,quoteDigits),
               " Ask=",DoubleToString(tick.ask,quoteDigits)," spread=",DoubleToString(spread,1),
               " successful_posts=",quoteSendCount);
   }
}
string FrameJson(const string sym,const ENUM_TIMEFRAMES tf,const string frameName,const int requestedBars)
{
   MqlRates rates[];ArraySetAsSeries(rates,false);
   int wanted=MathMax(2,MathMin(5000,requestedBars));
   ResetLastError();
   int copied=CopyRates(sym,tf,0,wanted,rates);
   int copyError=GetLastError();
   int minimumBars=MathMin(10,wanted);
   if(copied<minimumBars){Print("Dars waiting for enough ",frameName," bars on ",sym,". CopyRates=",copied," required=",minimumBars," error=",copyError,". Keep MT5 connected and allow history to synchronize.");return "";}
   // MT5 bar timestamps use broker-server clock. Convert to UTC before storing.
   // The same offset is applied to every bar in this short, current upload batch.
   long serverUtcOffset=(long)(TimeCurrent()-TimeGMT());
   string out="\""+frameName+"\":[";
   for(int j=0;j<copied;j++){
      if(j>0)out+=",";
      int candleDigits=(int)SymbolInfoInteger(sym,SYMBOL_DIGITS);
      datetime utcBarTime=(datetime)((long)rates[j].time-serverUtcOffset);
      out+=StringFormat("{\"time\":%I64d,\"open\":%s,\"high\":%s,\"low\":%s,\"close\":%s,\"tick_volume\":%I64d}",
         (long)utcBarTime,DoubleToString(rates[j].open,candleDigits),DoubleToString(rates[j].high,candleDigits),DoubleToString(rates[j].low,candleDigits),DoubleToString(rates[j].close,candleDigits),(long)rates[j].tick_volume);
   }
   Print("Dars prepared candles: ",sym," ",frameName," bars=",copied," server_utc_offset_sec=",serverUtcOffset," server_newest=",TimeToString(rates[copied-1].time,TIME_DATE|TIME_MINUTES)," utc_newest=",TimeToString((datetime)((long)rates[copied-1].time-serverUtcOffset),TIME_DATE|TIME_MINUTES));
   return out+"]";
}
void PostFrame(const string sym,const string frameName,const string frameJson)
{
   if(frameJson=="") return;
   // FrameJson returns "M5":[...]; extract only the array for the single-frame API.
   int colon=StringFind(frameJson,":");
   if(colon<0) return;
   string candles=StringSubstr(frameJson,colon+1);
   string candlePayload="{\"symbol\":\""+sym+"\",\"timeframe\":\""+frameName+"\",\"candles\":"+candles+"}";
   if(PostJson(CandleEndpoint,candlePayload,"candles "+sym+" "+frameName))
      Print("Dars candles OK: ",sym," ",frameName," uploaded to API.");
}
void SendCandles(const string sym)
{
   string m1=FrameJson(sym,PERIOD_M1,"M1",BarsPerTimeframe);
   string m5=FrameJson(sym,PERIOD_M5,"M5",BarsPerTimeframe);
   string m15=FrameJson(sym,PERIOD_M15,"M15",BarsPerTimeframe);
   string m30=FrameJson(sym,PERIOD_M30,"M30",BarsPerTimeframe);
   string h1=FrameJson(sym,PERIOD_H1,"H1",BarsPerTimeframe);
   string h4=FrameJson(sym,PERIOD_H4,"H4",BarsPerTimeframe);
   PostFrame(sym,"M1",m1);
   PostFrame(sym,"M5",m5);
   PostFrame(sym,"M15",m15);
   PostFrame(sym,"M30",m30);
   PostFrame(sym,"H1",h1);
   PostFrame(sym,"H4",h4);
}
void SendLiveCandles(const string sym)
{
   // Refresh only the newest bars frequently; do not resend hundreds of bars every few seconds.
   PostFrame(sym,"M1",FrameJson(sym,PERIOD_M1,"M1",3));
   PostFrame(sym,"M5",FrameJson(sym,PERIOD_M5,"M5",3));
   PostFrame(sym,"M15",FrameJson(sym,PERIOD_M15,"M15",3));
   PostFrame(sym,"M30",FrameJson(sym,PERIOD_M30,"M30",3));
   PostFrame(sym,"H1",FrameJson(sym,PERIOD_H1,"H1",3));
   PostFrame(sym,"H4",FrameJson(sym,PERIOD_H4,"H4",3));
}
void OnTimer()
{
   for(int i=0;i<ArraySize(symbols);i++){
      string sym=symbols[i];
      if(StringLen(sym)>0){SendQuote(sym);SendLiveCandles(sym);}
   }
   newsElapsed+=MathMax(1,SendEverySeconds);
   if(newsElapsed>=MathMax(60,SendNewsEverySeconds)){
      newsElapsed=0;
      for(int i=0;i<ArraySize(symbols);i++){string sym=symbols[i];if(StringLen(sym)>0)SendNewsCalendar(sym);}
   }
   candleTimer+=MathMax(1,SendEverySeconds);
   if(candleTimer>=MathMax(10,SendCandlesEverySeconds)){
      candleTimer=0;
      for(int i=0;i<ArraySize(symbols);i++){string sym=symbols[i];if(StringLen(sym)>0)SendCandles(sym);}
   }
}
