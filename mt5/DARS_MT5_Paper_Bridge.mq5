// DARS AI LAB - MT5 bridge for automatic PAPER trading data only.
// Sends live quotes every 10 seconds and closed M5 candles periodically.
// It NEVER places, modifies, or closes broker orders.
#property strict
#property version   "1.00"
#property description "Read-only MT5 quote and closed-candle bridge for DARS AI LAB paper trading"

input string InpSymbol = "XAUUSD-STD";
input string InpQuoteEndpoint = "https://dars-indol.vercel.app/api/mt5-quote";
input string InpCandleEndpoint = "https://dars-indol.vercel.app/api/mt5-candles";
input string InpBridgeToken = ""; // Must match Vercel MT5_BRIDGE_TOKEN exactly
input int    InpTimerSeconds = 10;
input int    InpCandleRefreshSeconds = 60;
input int    InpClosedM5Bars = 200;
input int    InpHttpTimeoutMs = 10000;

datetime g_last_candle_send = 0;
string g_bridge_token = "";

string JsonEscape(string value)
{
   StringReplace(value, "\\", "\\\\");
   StringReplace(value, "\"", "\\\"");
   StringReplace(value, "\r", "");
   StringReplace(value, "\n", "");
   return value;
}

bool PostJson(const string endpoint, const string payload, const string label)
{
   if(StringLen(g_bridge_token) == 0)
   {
      Print("DARS bridge ERROR: bridge token is blank after trimming. Open chart > Expert Advisors > Properties > Inputs, set InpBridgeToken, then press OK. Re-attach the EA if needed.");
      return false;
   }

   char data[];
   int copied = StringToCharArray(payload, data, 0, WHOLE_ARRAY, CP_UTF8);
   if(copied <= 1)
   {
      Print("DARS bridge ERROR: could not encode ", label, " payload.");
      return false;
   }
   ArrayResize(data, copied - 1); // remove terminating null byte

   char result[];
   string result_headers;
   string headers = "Content-Type: application/json\r\nX-Bridge-Token: " + g_bridge_token + "\r\n";
   ResetLastError();
   int status = WebRequest("POST", endpoint, headers, InpHttpTimeoutMs, data, result, result_headers);
   string response = CharArrayToString(result, 0, -1, CP_UTF8);

   if(status == -1)
   {
      Print("DARS bridge ", label, " WebRequest failed. MT5 error=", GetLastError(),
            ". Add https://dars-indol.vercel.app to Tools > Options > Expert Advisors > Allow WebRequest.");
      return false;
   }

   if(status < 200 || status >= 300)
   {
      Print("DARS bridge ", label, " HTTP=", status, " response=", response);
      return false;
   }

   Print("DARS bridge ", label, " OK: ", response);
   return true;
}

bool SendQuote()
{
   MqlTick tick;
   if(!SymbolInfoTick(InpSymbol, tick) || tick.bid <= 0 || tick.ask < tick.bid)
   {
      Print("DARS bridge waiting for valid quote on ", InpSymbol);
      return false;
   }

   int digits = (int)SymbolInfoInteger(InpSymbol, SYMBOL_DIGITS);
   double spread = tick.ask - tick.bid;
   string payload = StringFormat(
      "{\"symbol\":\"%s\",\"bid\":%s,\"ask\":%s,\"last\":%s,\"digits\":%d,\"spread\":%s}",
      JsonEscape(InpSymbol),
      DoubleToString(tick.bid, digits),
      DoubleToString(tick.ask, digits),
      DoubleToString(tick.last, digits),
      digits,
      DoubleToString(spread, digits)
   );
   return PostJson(InpQuoteEndpoint, payload, "QUOTE");
}

bool SendClosedM5Candles()
{
   MqlRates rates[];
   ArraySetAsSeries(rates, false);
   int wanted = MathMax(50, MathMin(InpClosedM5Bars, 500));
   ResetLastError();
   int count = CopyRates(InpSymbol, PERIOD_M5, 1, wanted, rates);
   if(count < 50)
   {
      Print("DARS bridge waiting for M5 history. Copied closed bars=", count,
            " error=", GetLastError(), ". Open XAUUSD-STD M5 and load history.");
      return false;
   }

   int digits = (int)SymbolInfoInteger(InpSymbol, SYMBOL_DIGITS);
   string payload = "{\"symbol\":\"" + JsonEscape(InpSymbol) + "\",\"timeframe\":\"M5\",\"candles\":[";
   for(int i = 0; i < count; i++)
   {
      if(i > 0) payload += ",";
      payload += StringFormat(
         "{\"time\":%I64d,\"open\":%s,\"high\":%s,\"low\":%s,\"close\":%s,\"tick_volume\":%I64d}",
         (long)rates[i].time,
         DoubleToString(rates[i].open, digits),
         DoubleToString(rates[i].high, digits),
         DoubleToString(rates[i].low, digits),
         DoubleToString(rates[i].close, digits),
         rates[i].tick_volume
      );
   }
   payload += "]}";

   bool ok = PostJson(InpCandleEndpoint, payload, "M5 CANDLES");
   if(ok) g_last_candle_send = TimeCurrent();
   return ok;
}

void RunBridgeCycle()
{
   SendQuote();
   datetime now = TimeCurrent();
   if(g_last_candle_send == 0 || now - g_last_candle_send >= MathMax(30, InpCandleRefreshSeconds))
      SendClosedM5Candles();
}

int OnInit()
{
   g_bridge_token = InpBridgeToken;
   StringTrimLeft(g_bridge_token);
   StringTrimRight(g_bridge_token);
   if(StringLen(g_bridge_token) == 0)
      Print("DARS bridge SETUP NEEDED: InpBridgeToken is blank. Set it under EA Properties > Inputs; token value is never printed.");
   else
      Print("DARS bridge token input detected (value hidden). Checking MT5 permissions and server response next.");

   if(!SymbolSelect(InpSymbol, true))
   {
      Print("DARS bridge ERROR: could not select symbol ", InpSymbol,
            ". Confirm the exact broker symbol name.");
      return INIT_FAILED;
   }
   EventSetTimer(MathMax(5, InpTimerSeconds));
   Print("DARS read-only bridge started for ", InpSymbol,
         ". Quote interval=", InpTimerSeconds,
         "s; closed M5 candle refresh=", InpCandleRefreshSeconds,
         "s. NO broker orders are sent.");
   RunBridgeCycle();
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   EventKillTimer();
   Print("DARS read-only bridge stopped. reason=", reason);
}

void OnTimer()
{
   RunBridgeCycle();
}

void OnTick()
{
   // Timer-based sending avoids flooding the API on every market tick.
}
