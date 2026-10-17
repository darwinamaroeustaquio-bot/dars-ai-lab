// Dars AI Lab - VT Markets MT5 Read-only Quote Bridge
// Sends quotes only. It DOES NOT open, modify, or close trades.
#property strict
#property version "1.00"
#property description "Read-only quote sender for Dars AI Lab"

input string ApiEndpoint = "https://YOUR-VERCEL-DOMAIN/api/mt5-quote";
input string BridgeToken = "SET_THE_SAME_RANDOM_TOKEN_IN_VERCEL";
input string SymbolsCsv = "XAUUSD-STD,EURUSD,GBPUSD,BTCUSD";
input int SendEverySeconds = 3;

string symbols[];
int OnInit()
{
   if(StringFind(ApiEndpoint, "YOUR-VERCEL-DOMAIN") >= 0 || StringLen(BridgeToken) < 24)
   {
      Print("Configure ApiEndpoint and a long random BridgeToken in EA inputs first.");
      return INIT_PARAMETERS_INCORRECT;
   }
   int count = StringSplit(SymbolsCsv, ',', symbols);
   if(count < 1) return INIT_PARAMETERS_INCORRECT;
   for(int i=0;i<count;i++)
   {
      StringTrimLeft(symbols[i]); StringTrimRight(symbols[i]);
      if(StringLen(symbols[i]) > 0) SymbolSelect(symbols[i], true);
   }
   EventSetTimer(MathMax(1, SendEverySeconds));
   Print("Dars read-only quote bridge started. No trading functions are used.");
   return INIT_SUCCEEDED;
}
void OnDeinit(const int reason) { EventKillTimer(); }
void OnTimer()
{
   for(int i=0;i<ArraySize(symbols);i++)
   {
      string sym = symbols[i];
      if(StringLen(sym) == 0) continue;
      MqlTick tick;
      if(!SymbolInfoTick(sym, tick) || tick.bid <= 0 || tick.ask <= 0) continue;
      int digits = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
      double point = SymbolInfoDouble(sym, SYMBOL_POINT);
      double spread = point > 0 ? (tick.ask-tick.bid)/point : 0;
      string payload = StringFormat("{\"symbol\":\"%s\",\"bid\":%s,\"ask\":%s,\"last\":%s,\"digits\":%d,\"spread\":%s}",
         sym, DoubleToString(tick.bid,digits), DoubleToString(tick.ask,digits),
         DoubleToString(tick.last,digits), digits, DoubleToString(spread,1));
      char data[], result[];
      string resultHeaders;
      StringToCharArray(payload, data, 0, WHOLE_ARRAY, CP_UTF8);
      if(ArraySize(data)>0) ArrayResize(data, ArraySize(data)-1);
      string headers = "Content-Type: application/json\r\nX-Bridge-Token: " + BridgeToken + "\r\n";
      ResetLastError();
      int code = WebRequest("POST", ApiEndpoint, headers, 5000, data, result, resultHeaders);
      if(code == 200) Print("Dars quote sent: ", sym, " bid=", DoubleToString(tick.bid,digits), " ask=", DoubleToString(tick.ask,digits));
      else Print("Dars quote send failed for ", sym, ". HTTP=", code, " MT5 error=", GetLastError(), ". Check MT5 WebRequest allow-list and API settings.");
   }
}
