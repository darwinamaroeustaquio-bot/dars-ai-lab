// DARS MT5 Economic Calendar bridge — read-only, no trading functions.
#property strict
#property version   "1.01"
#property description "Uploads MT5 Economic Calendar events to DARS AI LAB. Does not place trades."

input string BridgeEndpoint = "https://dars-indol.vercel.app/api/mt5-news";
input string BridgeToken = ""; // Set to the same secret as Vercel MT5_BRIDGE_TOKEN
input string SymbolForDars = "XAUUSD-STD";
input int SyncSeconds = 60;
input int DaysBack = 120;
input int DaysForward = 90;
input bool IncludeMediumImpact = true;

string JsonEscape(const string value)
{
   string out="";
   for(int i=0;i<StringLen(value);i++)
   {
      ushort ch=StringGetCharacter(value,i);
      if(ch==34) out+="\\\"";
      else if(ch==92) out+="\\\\";
      else if(ch==10) out+="\\n";
      else if(ch==13) out+="\\r";
      else if(ch==9) out+="\\t";
      else out+=ShortToString(ch);
   }
   return out;
}
string JsonNumberOrNull(const long raw)
{
   if(raw==LONG_MIN) return "null";
   return DoubleToString((double)raw/1000000.0,8);
}
string ImportanceText(const ENUM_CALENDAR_EVENT_IMPORTANCE importance)
{
   if(importance==CALENDAR_IMPORTANCE_HIGH) return "high";
   if(importance==CALENDAR_IMPORTANCE_MODERATE) return "medium";
   if(importance==CALENDAR_IMPORTANCE_LOW) return "low";
   return "none";
}
bool UploadCalendar()
{
   if(StringLen(BridgeToken)<24)
   {
      Print("DARS NEWS: BridgeToken missing or too short (minimum 24 characters).");
      return false;
   }
   datetime serverNow=TimeTradeServer();
   datetime utcNow=TimeGMT();
   int offsetSeconds=(int)(serverNow-utcNow);
   datetime fromServer=serverNow-(DaysBack*86400);
   datetime toServer=serverNow+(DaysForward*86400);
   MqlCalendarValue values[];
   ResetLastError();
   int count=CalendarValueHistory(values,fromServer,toServer,NULL,"USD");
   if(count<0)
   {
      PrintFormat("DARS NEWS: CalendarValueHistory failed. error=%d",GetLastError());
      return false;
   }
   string events="[";
   int included=0;
   for(int i=0;i<count;i++)
   {
      MqlCalendarEvent event;
      MqlCalendarCountry country;
      if(!CalendarEventById(values[i].event_id,event)) continue;
      if(!CalendarCountryById(event.country_id,country)) continue;
      string impact=ImportanceText(event.importance);
      if(impact=="none" || impact=="low") continue;
      if(!IncludeMediumImpact && impact!="high") continue;
      if(included>0) events+=",";
      long eventUtc=(long)values[i].time-(long)offsetSeconds;
      events+="{";
      events+="\"value_id\":\""+(string)values[i].id+"\",";
      events+="\"event_id\":\""+(string)values[i].event_id+"\",";
      events+="\"name\":\""+JsonEscape(event.name)+"\",";
      events+="\"currency\":\""+JsonEscape(country.currency)+"\",";
      events+="\"country_code\":\""+JsonEscape(country.code)+"\",";
      events+="\"importance\":\""+impact+"\",";
      events+="\"event_time_utc_epoch\":"+(string)eventUtc+",";
      events+="\"event_time_server\":\""+TimeToString(values[i].time,TIME_DATE|TIME_SECONDS)+"\",";
      events+="\"server_utc_offset_seconds\":"+(string)offsetSeconds+",";
      events+="\"actual\":"+JsonNumberOrNull(values[i].actual_value)+",";
      events+="\"forecast\":"+JsonNumberOrNull(values[i].forecast_value)+",";
      events+="\"previous\":"+JsonNumberOrNull(values[i].prev_value)+",";
      events+="\"revised_previous\":"+JsonNumberOrNull(values[i].revised_prev_value);
      events+="}";
      included++;
   }
   events+="]";
   string body="{\"symbol\":\""+JsonEscape(SymbolForDars)+"\",";
   body+="\"server_time\":\""+TimeToString(serverNow,TIME_DATE|TIME_SECONDS)+"\",";
   body+="\"server_utc_offset_seconds\":"+(string)offsetSeconds+",";
   body+="\"events\":"+events+"}";
   char data[],result[];
   string headers="Content-Type: application/json\r\nX-Bridge-Token: "+BridgeToken+"\r\n";
   StringToCharArray(body,data,0,WHOLE_ARRAY,CP_UTF8);
   ArrayResize(data,ArraySize(data)-1);
   ResetLastError();
   string responseHeaders;
   int code=WebRequest("POST",BridgeEndpoint,headers,15000,data,result,responseHeaders);
   if(code!=200)
   {
      PrintFormat("DARS NEWS: upload failed. HTTP=%d terminal_error=%d response=%s",code,GetLastError(),CharArrayToString(result,0,-1,CP_UTF8));
      return false;
   }
   PrintFormat("DARS NEWS: synced %d USD calendar events. MT5 server offset=%d seconds. Feed is broker-provided and not independently verified.",included,offsetSeconds);
   return true;
}
int OnInit()
{
   if(SyncSeconds<15) { Print("DARS NEWS: SyncSeconds must be at least 15."); return INIT_PARAMETERS_INCORRECT; }
   EventSetTimer(SyncSeconds);
   UploadCalendar();
   return INIT_SUCCEEDED;
}
void OnDeinit(const int reason) { EventKillTimer(); }
void OnTimer() { UploadCalendar(); }
void OnTick() {}
