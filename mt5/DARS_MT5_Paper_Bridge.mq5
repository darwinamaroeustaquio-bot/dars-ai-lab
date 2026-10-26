// Dars AI Lab - VT Markets MT5 Read-only Quote + Candle Bridge
// Sends DARS API-compatible quote snapshots and M1/M5/M15/H1 closed candles. DOES NOT trade.
#property strict
#property version "1.22"
#property description "Read-only quote and candle sender for Dars AI Lab"

input string ApiEndpoint = "https://dars-indol.vercel.app/api/mt5-quote";
input string CandleEndpoint = "https://dars-indol.vercel.app/api/mt5-candles";
input string BridgeToken = ""; // Enter the same NEW token as Vercel MT5_BRIDGE_TOKEN. Do not publish secrets.
input string SymbolsCsv = "XAUUSD-STD";
input int SendEverySeconds = 3;
input int SendCandlesEverySeconds = 300;
input int BarsPerTimeframe = 500;
input int HttpTimeoutMs = 10000;

string symbols[];
int candleTimer = 0;
int quoteSendCount = 0;
int quoteTickMissCount = 0;

int OnInit()
{
   if(StringLen(BridgeToken) < 24 ||
      StringFind(BridgeToken, "SET_THE_SAME") >= 0 ||
      StringFind(BridgeToken, "YOUR_") >= 0)
   {
      Print("Dars bridge setup required: set BridgeToken to the same new long token configured as Vercel MT5_BRIDGE_TOKEN.");
      return INIT_PARAMETERS_INCORRECT;
   }
   if(StringFind(ApiEndpoint, "https://") != 0 || StringFind(CandleEndpoint, "https://") != 0)
   {
      Print("Dars bridge setup required: endpoints must use HTTPS.");
      return INIT_PARAMETERS_INCORRECT;
   }

   ushort separator = (ushort)StringGetCharacter(",", 0);
   int count = StringSplit(SymbolsCsv, separator, symbols);
   if(count < 1)
   {
      Print("Dars bridge setup error: SymbolsCsv is empty.");
      return INIT_PARAMETERS_INCORRECT;
   }

   int usable = 0;
   for(int i = 0; i < count; i++)
   {
      StringTrimLeft(symbols[i]);
      StringTrimRight(symbols[i]);
      if(StringLen(symbols[i]) > 0)
      {
         if(SymbolSelect(symbols[i], true))
            usable++;
         else
            Print("Dars bridge warning: could not select symbol ", symbols[i],
                  ". Check exact broker symbol in Market Watch.");
      }
   }
   if(usable < 1)
   {
      Print("Dars bridge setup error: no symbols could be selected.");
      return INIT_PARAMETERS_INCORRECT;
   }

   EventSetTimer(MathMax(1, SendEverySeconds));
   Print("Dars read-only quote + M1/M5/M15/H1 candle bridge started. No broker orders are sent.");
   OnTimer();
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   EventKillTimer();
   Print("Dars read-only bridge stopped. reason=", reason);
}

bool PostJson(const string endpoint, const string payload, const string label)
{
   char data[], result[];
   string resultHeaders;
   int copied = StringToCharArray(payload, data, 0, WHOLE_ARRAY, CP_UTF8);
   if(copied <= 1)
   {
      Print("Dars ", label, " failed: could not encode JSON payload.");
      return false;
   }
   ArrayResize(data, copied - 1);

   string headers = "Content-Type: application/json\r\nX-Bridge-Token: " + BridgeToken + "\r\n";
   ResetLastError();
   int code = WebRequest("POST", endpoint, headers, HttpTimeoutMs, data, result, resultHeaders);
   int mt5Error = GetLastError();
   string responseText = CharArrayToString(result, 0, -1, CP_UTF8);

   if(code >= 200 && code < 300)
      return true;

   Print("Dars ", label, " failed. HTTP=", code, " MT5 error=", mt5Error,
         " response=", responseText,
         ". Check MT5 WebRequest allow-list, matching BridgeToken, endpoint and Vercel Function Logs.");
   return false;
}

void SendQuote(const string sym)
{
   MqlTick tick;
   ResetLastError();
   if(!SymbolInfoTick(sym, tick) || tick.bid <= 0 || tick.ask <= 0 || tick.ask < tick.bid)
   {
      quoteTickMissCount++;
      if(quoteTickMissCount == 1 || quoteTickMissCount % 20 == 0)
         Print("Dars quote waiting for valid tick: symbol=", sym,
               " selected=", SymbolInfoInteger(sym, SYMBOL_SELECT),
               " tick_misses=", quoteTickMissCount, " MT5 error=", GetLastError(),
               ". Confirm exact broker symbol is visible in Market Watch and has a live quote.");
      return;
   }

   int digits = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
   double spreadPrice = tick.ask - tick.bid; // DARS API/dashboard expects spread in price units.
   string payload = StringFormat(
      "{\"symbol\":\"%s\",\"bid\":%s,\"ask\":%s,\"last\":%s,\"digits\":%d,\"spread\":%s}",
      sym, DoubleToString(tick.bid, digits), DoubleToString(tick.ask, digits),
      DoubleToString(tick.last, digits), digits, DoubleToString(spreadPrice, digits));

   if(PostJson(ApiEndpoint, payload, "quote " + sym))
   {
      quoteSendCount++;
      if(quoteSendCount == 1 || quoteSendCount % 10 == 0)
         Print("Dars quote OK: ", sym, " Bid=", DoubleToString(tick.bid, digits),
               " Ask=", DoubleToString(tick.ask, digits), " spread=", DoubleToString(spreadPrice, digits),
               " successful_posts=", quoteSendCount);
   }
}

string FrameJson(const string sym, const ENUM_TIMEFRAMES tf, const string frameName)
{
   MqlRates rates[];
   ArraySetAsSeries(rates, false);
   int wanted = MathMax(30, MathMin(5000, BarsPerTimeframe));
   ResetLastError();
   int copied = CopyRates(sym, tf, 1, wanted, rates); // closed candles only
   if(copied < 10)
   {
      Print("Dars waiting for enough ", frameName, " closed bars on ", sym,
            ". CopyRates=", copied, " error=", GetLastError(),
            ". Load history for this timeframe in MT5.");
      return "";
   }

   int digits = (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
   string out = "\"candles\":[";
   for(int j = 0; j < copied; j++)
   {
      if(j > 0) out += ",";
      out += StringFormat(
         "{\"time\":%I64d,\"open\":%s,\"high\":%s,\"low\":%s,\"close\":%s,\"tick_volume\":%I64d}",
         (long)rates[j].time, DoubleToString(rates[j].open, digits),
         DoubleToString(rates[j].high, digits), DoubleToString(rates[j].low, digits),
         DoubleToString(rates[j].close, digits), (long)rates[j].tick_volume);
   }
   return out + "]";
}

void PostFrame(const string sym, const string frameName, const string frameJson)
{
   if(frameJson == "") return;
   string payload = "{\"symbol\":\"" + sym + "\",\"timeframe\":\"" + frameName + "\"," + frameJson + "}";
   if(PostJson(CandleEndpoint, payload, "candles " + sym + " " + frameName))
      Print("Dars candles OK: ", sym, " ", frameName, " uploaded to API.");
}

void SendCandles(const string sym)
{
   PostFrame(sym, "M1", FrameJson(sym, PERIOD_M1, "M1"));
   PostFrame(sym, "M5", FrameJson(sym, PERIOD_M5, "M5"));
   PostFrame(sym, "M15", FrameJson(sym, PERIOD_M15, "M15"));
   PostFrame(sym, "H1", FrameJson(sym, PERIOD_H1, "H1"));
}

void OnTimer()
{
   for(int i = 0; i < ArraySize(symbols); i++)
   {
      string sym = symbols[i];
      if(StringLen(sym) > 0) SendQuote(sym);
   }

   candleTimer += MathMax(1, SendEverySeconds);
   if(candleTimer >= MathMax(10, SendCandlesEverySeconds))
   {
      candleTimer = 0;
      for(int j = 0; j < ArraySize(symbols); j++)
      {
         string sym = symbols[j];
         if(StringLen(sym) > 0) SendCandles(sym);
      }
   }
}

void OnTick()
{
   // Timer-based sending avoids flooding the API on every market tick.
}
