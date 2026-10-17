// Public Supabase configuration only. Never expose service-role/secret keys here.
module.exports = (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    res.statusCode = 503;
    return res.end(JSON.stringify({
      configured: false,
      message: "Supabase URL or publishable/anon key is missing from Vercel Environment Variables."
    }));
  }
  res.statusCode = 200;
  return res.end(JSON.stringify({ configured: true, url, key }));
};
