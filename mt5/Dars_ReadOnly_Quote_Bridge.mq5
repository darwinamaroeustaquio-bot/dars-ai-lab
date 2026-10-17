// Dars AI Lab - VT Markets MT5 Read-only Quote + Candle Bridge
// Sends quote snapshots and M5/M15/H1 candle history. DOES NOT trade.
#property strict
#property version "1.20"
#property description "Read-only quote and candle sender for Dars AI Lab"

input string ApiEndpoint = "https://dars-indol.vercel.app/api/mt5-quote";
input string CandleEndpoint = "https://dars-indol.vercel.app/api/mt5-candles";
input string BridgeToken = "SET_THE_SAME_RANDOM_TOKEN_IN_VERCEL";
input string SymbolsCsv = "XAUUSD-STD,EURUSD,GBPUSD,BTCUSD";
input int SendEverySeconds = 3;
input int SendCandlesEverySeconds = 300;
input int BarsPerTimeframe = 5000;

string symbols[];
int candleTimer = 0;

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
   return INIT_SUCCEEDED;
}
void OnDeinit(const int reason){EventKillTimer();}
bool PostJson(const string endpoint,const string payload,const string label)
{
   char data[],result[]; string resultHeaders;
   StringToCharArray(payload,data,0,WHOLE_ARRAY,CP_UTF8);
   if(ArraySize(data)>0)ArrayResize(data,ArraySize(data)-1);
   string headers="Content-Type: application/json\r\nX-Bridge-Token: "+BridgeToken+"\r\n";
   ResetLastError();
   int code=WebRequest("POST",endpoint,headers,10000,data,result,resultHeaders);
   if(code==200){Print("Dars ",label," sent. ",CharArrayToString(result));return true;}
   Print("Dars ",label," failed. HTTP=",code," MT5 error=",GetLastError(),". Check MT5 WebRequest allow-list, token and API setup.");
   return false;
}
void SendQuote(const string sym)
{
   MqlTick tick;if(!SymbolInfoTick(sym,tick)||tick.bid<=0||tick.ask<=0)return;
   int digits=(int)SymbolInfoInteger(sym,SYMBOL_DIGITS);
   double point=SymbolInfoDouble(sym,SYMBOL_POINT);
   double spread=point>0?(tick.ask-tick.bid)/point:0;
   string payload=StringFormat("{\"symbol\":\"%s\",\"bid\":%s,\"ask\":%s,\"last\":%s,\"digits\":%d,\"spread\":%s}",
      sym,DoubleToString(tick.bid,digits),DoubleToString(tick.ask,digits),DoubleToString(tick.last,digits),digits,DoubleToString(spread,1));
   PostJson(ApiEndpoint,payload,"quote "+sym);
}
string FrameJson(const string sym,const ENUM_TIMEFRAMES tf,const string frameName)
{
   MqlRates rates[];ArraySetAsSeries(rates,false);
   int wanted=MathMax(30,MathMin(5000,BarsPerTimeframe));
   int copied=CopyRates(sym,tf,0,wanted,rates);
   if(copied<10){Print("Dars waiting for enough ",frameName," bars on ",sym,". CopyRates=",copied," error=",GetLastError());return "";}
   string out="\""+frameName+"\":[";
   for(int j=0;j<copied;j++){
      if(j>0)out+=",";
      int digits=(int)SymbolInfoInteger(sym,SYMBOL_DIGITS);
      out+=StringFormat("{\"time\":%I64d,\"open\":%s,\"high\":%s,\"low\":%s,\"close\":%s,\"tick_volume\":%I64d}",
         (long)rates[j].time,DoubleToString(rates[j].open,digits),DoubleToString(rates[j].high,digits),DoubleToString(rates[j].low,digits),DoubleToString(rates[j].close,digits),(long)rates[j].tick_volume);
   }
   return out+"]";
}
void PostFrame(const string sym,const string frameName,const string frameJson)
{
   if(frameJson=="") return;
   // FrameJson returns "M5":[...]; extract only the array for the single-frame API.
   int colon=StringFind(frameJson,":");
   if(colon<0) return;
   string candles=StringSubstr(frameJson,colon+1);
   string payload="{\"symbol\":\""+sym+"\",\"timeframe\":\""+frameName+"\",\"candles\":"+candles+"}";
   PostJson(CandleEndpoint,payload,"candles "+sym+" "+frameName);
}
void SendCandles(const string sym)
{
   string m5=FrameJson(sym,PERIOD_M5,"M5");
   string m15=FrameJson(sym,PERIOD_M15,"M15");
   string h1=FrameJson(sym,PERIOD_H1,"H1");
   PostFrame(sym,"M5",m5);
   PostFrame(sym,"M15",m15);
   PostFrame(sym,"H1",h1);
}
void OnTimer()
{
   for(int i=0;i<ArraySize(symbols);i++){string sym=symbols[i];if(StringLen(sym)>0)SendQuote(sym);}
   candleTimer+=MathMax(1,SendEverySeconds);
   if(candleTimer>=MathMax(10,SendCandlesEverySeconds)){
      candleTimer=0;
      for(int i=0;i<ArraySize(symbols);i++){string sym=symbols[i];if(StringLen(sym)>0)SendCandles(sym);}
   }
}
