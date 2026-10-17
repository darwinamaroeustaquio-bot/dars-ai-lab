// Public Supabase configuration only. Never expose service-role/secret keys here.
module.exports = (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  // Supabase JS expects the project root URL, not /rest/v1/.
  let rawUrl = String(process.env.SUPABASE_URL || "").trim();
  rawUrl = rawUrl.replace(/\/rest\/v1\/?$/i, "").replace(/\/+$/, "");
  let url = "";
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol === "https:" || parsed.protocol === "http:") url = parsed.origin;
  } catch (_) {}
  if (!url) url = "https://nemazjqhbfzysulgzcxg.supabase.co";

  const key = String(process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || "").trim();

  // Never expose new-format secret keys or legacy service_role JWTs to the browser.
  let legacyRole = "";
  try {
    const parts = key.split(".");
    if (parts.length === 3) {
      const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
      legacyRole = String(payload.role || "");
    }
  } catch (_) {}
  const looksPublic = key.startsWith("sb_publishable_") ||
    (key.startsWith("eyJ") && legacyRole === "anon");

  if (!key || !looksPublic) {
    res.statusCode = 503;
    return res.end(JSON.stringify({
      configured: false,
      message: "Supabase public key is missing or unsafe. Set SUPABASE_ANON_KEY to the anon/public key or SUPABASE_PUBLISHABLE_KEY to the publishable key in Vercel."
    }));
  }

  res.statusCode = 200;
  return res.end(JSON.stringify({ configured: true, url, key }));
};
