//+------------------------------------------------------------------+
//| DARS_Execution_Gateway.mq5                                       |
//| FOUNDATION ONLY: authenticated execution is NOT implemented.    |
//| This EA only checks the DARS fail-closed status endpoint.        |
//| It cannot submit, modify or close broker orders in this release. |
//+------------------------------------------------------------------+
#property strict
#property version   "0.10"
#property description "DARS dormant MT5 gateway — status handshake only; no trading."

input string InpStatusURL = "https://dars-indol.vercel.app/api/dars-execution-status";
input int    InpPollSeconds = 5;
input bool   InpEnableLiveTrading = false; // Must remain false. No order code exists in this foundation.
input double InpMaxRiskPercent = 0.25;      // Proposed cap for later review; not active.
input double InpDailyLossLimitPercent = 1.00; // Proposed cap for later review; not active.
input int    InpMaxOpenPositions = 1;       // Proposed cap for later review; not active.
input int    InpMaxTradesPerDay = 3;        // Proposed cap for later review; not active.
input double InpMaxSpreadPrice = 0.50;      // Proposed XAUUSD price-unit cap; not active.

string g_status = "STARTING";
datetime g_last_poll = 0;

bool EmergencyStopActive()
{
   // Create/set this terminal Global Variable to 1.0 to locally stop the gateway.
   if(GlobalVariableCheck("DARS_EMERGENCY_STOP"))
      if(GlobalVariableGet("DARS_EMERGENCY_STOP") > 0.5)
         return true;
   return false;
}

bool ServerExplicitlyAllowsLive(const string response)
{
   // Server foundation endpoint is hard-coded live_enabled=false.
   // Even if the local input is changed, this function remains false unless
   // a future reviewed protocol replaces this implementation.
   if(StringFind(response, "\"live_enabled\":true") >= 0)
      return false;
   return false;
}

void PollDarsStatus()
{
   if(EmergencyStopActive())
   {
      g_status = "EMERGENCY STOP — LOCAL LOCK";
      Comment("DARS EXECUTION GATEWAY\n", g_status,
              "\nNo orders can be submitted by this foundation build.");
      return;
   }

   char data[];
   char result[];
   string response_headers;
   string headers = "Accept: application/json\r\n";
   ResetLastError();
   int code = WebRequest("GET", InpStatusURL, headers, 5000, data, result, response_headers);
   if(code != 200)
   {
      g_status = "LOCKED — STATUS ENDPOINT UNAVAILABLE";
      Comment("DARS EXECUTION GATEWAY\n", g_status,
              "\nHTTP=", code, " error=", GetLastError(),
              "\nNo orders can be submitted.");
      return;
   }

   string body = CharArrayToString(result, 0, -1, CP_UTF8);
   bool live_allowed = ServerExplicitlyAllowsLive(body);
   if(InpEnableLiveTrading && live_allowed)
      g_status = "LOCKED — FINAL EXECUTION MODULE NOT INSTALLED";
   else
      g_status = "SAFE LOCK — LIVE OFF / ORDER ROUTING DISABLED";

   Comment("DARS EXECUTION GATEWAY\n", g_status,
           "\nServer: ", body,
           "\nLocal live input: ", (InpEnableLiveTrading ? "true" : "false"),
           "\nRisk inputs are proposed only; no orders are sent.");
}

int OnInit()
{
   if(InpPollSeconds < 1)
      return INIT_PARAMETERS_INCORRECT;
   EventSetTimer(InpPollSeconds);
   PollDarsStatus();
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   EventKillTimer();
   Comment("");
}

void OnTimer()
{
   PollDarsStatus();
}

void OnTick()
{
   // Intentionally empty. This foundation EA has NO order submission logic.
}
//+------------------------------------------------------------------+
