/**
 * DARS research validation helpers.
 * Chronological development folds are stability checks on fixed candidate rules;
 * the final 30% holdout remains a separate untouched evaluation.
 */
function chronologicalWalkForward(trades, startMs, endMs, summarize, foldCount = 3) {
  const rows = Array.isArray(trades) ? trades : [];
  const span = endMs - startMs;
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || span <= 0 || !Number.isInteger(foldCount) || foldCount < 2) {
    return { method: "CHRONOLOGICAL_FOLDS", stable: false, profitableFolds: 0, validFolds: 0, folds: [] };
  }
  const folds = [];
  for (let i = 0; i < foldCount; i++) {
    const from = startMs + span * i / foldCount;
    const to = startMs + span * (i + 1) / foldCount;
    const selected = rows.filter(t => {
      const time = Date.parse(t.time);
      return Number.isFinite(time) && time >= from && (i === foldCount - 1 ? time <= to : time < to);
    });
    const metrics = summarize(selected);
    folds.push({
      index: i + 1,
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
      ...metrics,
      valid: metrics.trades >= 2,
      profitable: metrics.trades >= 2 && metrics.expectancyR > 0
    });
  }
  const validFolds = folds.filter(f => f.valid).length;
  const profitableFolds = folds.filter(f => f.profitable).length;
  const allDevelopment = summarize(rows);
  return {
    method: "3 chronological rolling validation windows inside development data; fixed rules, no parameter refitting",
    stable: validFolds >= 2 && profitableFolds >= 2 && allDevelopment.expectancyR > 0,
    validFolds,
    profitableFolds,
    totalFolds: foldCount,
    development: allDevelopment,
    folds
  };
}

function fixed(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(5) : "NA";
}
function executionSignature(trades) {
  if (!Array.isArray(trades) || trades.length < 3) return null;
  return trades.map(t => [
    t.time || "",
    t.side || "",
    fixed(t.entry),
    fixed(t.exit),
    fixed(t.risk),
    fixed(t.r),
    t.reason || ""
  ].join("|")).join("\n");
}
function hash(value) {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
function auditDuplicateCandidates(candidates) {
  const bySignature = new Map();
  for (const candidate of candidates) {
    const signature = executionSignature(candidate._auditTrades);
    if (!signature) {
      candidate.duplicateBehavior = { checked: false, isDuplicate: false, reason: "Fewer than 3 holdout executions; insufficient fingerprint." };
      continue;
    }
    candidate.duplicateBehavior = { checked: true, isDuplicate: false, reason: "No exact duplicate holdout signature found." };
    if (!bySignature.has(signature)) bySignature.set(signature, []);
    bySignature.get(signature).push(candidate);
  }
  const groups = [];
  for (const [signature, members] of bySignature.entries()) {
    if (members.length < 2) continue;
    const ranked = members.slice().sort((a, b) =>
      (b.holdout?.expectancyR || 0) - (a.holdout?.expectancyR || 0) ||
      (b.holdout?.profitFactor || 0) - (a.holdout?.profitFactor || 0) ||
      (a.holdout?.maxDrawdownR || 0) - (b.holdout?.maxDrawdownR || 0) ||
      String(a.id).localeCompare(String(b.id))
    );
    const representativeId = ranked[0].id;
    const groupId = "DUP-" + hash(signature);
    for (const candidate of members) {
      candidate.duplicateBehavior = {
        checked: true,
        isDuplicate: candidate.id !== representativeId,
        groupId,
        groupSize: members.length,
        representativeId,
        reason: candidate.id === representativeId
          ? "Representative of an identical holdout execution group."
          : "Exact holdout execution fingerprint matches the representative; excluded from independent qualification."
      };
    }
    groups.push({ groupId, representativeId, candidateIds: ranked.map(x => x.id), size: members.length });
  }
  return {
    method: "Exact holdout execution fingerprint (time, side, entry, exit, risk, net R and exit reason); minimum 3 trades",
    groups,
    duplicateGroups: groups.length,
    duplicateCandidates: groups.reduce((sum, group) => sum + group.size - 1, 0),
    candidatesAudited: candidates.length,
    independentCandidateCount: candidates.length - groups.reduce((sum, group) => sum + group.size - 1, 0)
  };
}

module.exports = { chronologicalWalkForward, auditDuplicateCandidates, executionSignature };
