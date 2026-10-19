import { owns } from '../proc/owns.mjs';
import { processTable } from '../proc/table.mjs';
import { budgetStatus } from './budget.mjs';

export async function top(options) {
  const { ledger, processAdapter, sessionKey, now = Date.now } = options;
  const at = typeof now === 'function' ? now() : now;
  let table = await processTable(processAdapter);
  if (Number.isFinite(options.sampleMs) && options.sampleMs > 0) {
    await (options.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms))))(options.sampleMs);
    table = await processTable(processAdapter);
  }
  const records = (await ledger.list()).filter(row => !sessionKey || row.sessionKey === sessionKey);
  const rows = [];
  for (const record of records.filter(row => row.kind !== 'remote')) {
    const proof = await owns(record, { ...options, mode: 'cleanup' });
    const members = table.rows.filter(row => record.kind === 'leased' ? row.pgid === record.pgid : row.pid === record.pid);
    rows.push({ id: record.id, driverId: record.driverId, pid: record.pid, owned: proof.owned, reason: proof.reason, profileClass: record.profileClass, idleSeconds: Math.max(0, at - record.lastActivity) / 1000, ...budgetStatus(members, record.budgets, record.cpuHistory, at) });
  }
  return { verified: table.verified, reason: table.reason, rows };
}
