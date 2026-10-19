import defaults from './defaults.json' with { type: 'json' };

export function budgetStatus(rows, budgets = {}, history = [], now = Date.now()) {
  const rssCap = budgets.rssBytes ?? defaults.rssBytes.value;
  const cpuCap = budgets.sustainedCpuPercent ?? defaults.sustainedCpuPercent.value;
  const cpuWindowMs = budgets.cpuWindowMs;
  const rssKnown = rows.every(row => Number.isFinite(row.rssBytes));
  const cpuKnown = rows.every(row => Number.isFinite(row.cpuPercent));
  const rssBytes = rssKnown ? rows.reduce((sum, row) => sum + row.rssBytes, 0) : null;
  const cpuPercent = cpuKnown ? rows.reduce((sum, row) => sum + row.cpuPercent, 0) : null;
  const sorted = history.filter(row => Number.isFinite(row.at) && row.at <= now).sort((a, b) => a.at - b.at);
  const boundary = sorted.findLast(row => row.at <= now - cpuWindowMs);
  const recent = [...(boundary ? [boundary] : []), ...sorted.filter(row => row.at > now - cpuWindowMs)];
  const sustained = Number.isFinite(cpuWindowMs) && cpuWindowMs > 0 && recent.length > 1 && recent[0].at <= now - cpuWindowMs && recent.every(row => row.cpuPercent > cpuCap) && cpuPercent > cpuCap;
  const reasons = [];
  if (Number.isFinite(rssCap) && rssBytes !== null && rssBytes > rssCap) reasons.push('rss');
  if (Number.isFinite(cpuCap) && sustained) reasons.push('cpu');
  return { exceeded: reasons.length > 0, reasons, rssBytes, cpuPercent, caps: { rssBytes: rssCap, sustainedCpuPercent: cpuCap, cpuWindowMs: cpuWindowMs ?? null }, verified: rssKnown && cpuKnown };
}
