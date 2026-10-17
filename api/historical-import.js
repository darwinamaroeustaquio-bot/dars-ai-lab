// Legacy endpoint disabled: Dars AI Lab now uses Twelve Data for external history.
// Kept as a clear response for old browser tabs or stale deployments.
module.exports = async (req, res) => {
  res.status(410);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  return res.json({
    ok: false,
    error: "Dukascopy import has been removed. Use the Twelve Data external Gold history import in the dashboard."
  });
};
