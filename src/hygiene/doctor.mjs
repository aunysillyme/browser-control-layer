import { processTable } from '../proc/table.mjs';
import { owns } from '../proc/owns.mjs';
import { profileArgument } from './profiles.mjs';
import { headroom } from './headroom.mjs';
import { remoteDoctor } from './remote.mjs';

export async function doctor(options) {
  if (options.remote) return remoteDoctor(options);
  const table = await processTable(options.processAdapter);
  const records = await options.ledger.list();
  const rows = [];
  for (const row of table.rows.filter(row => /(?:chrome|chromium)/i.test(row.executable || '') || profileArgument(row.argv))) {
    const record = records.find(record => record.pid === row.pid);
    const proof = record ? await owns(record, { ...options, mode: 'cleanup' }) : { owned: false, reason: 'unrecorded' };
    rows.push({ pid: row.pid, driverId: record?.driverId, profileClass: record?.profileClass || 'user', owned: proof.owned, reason: proof.reason, rssBytes: row.rssBytes, cpuPercent: row.cpuPercent });
  }
  return { verified: table.verified, reason: table.reason, rows, headroom: headroom(options.headroomOptions), reportOnly: true };
}
