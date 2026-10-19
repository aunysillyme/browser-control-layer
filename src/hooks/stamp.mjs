import { RECIPES } from '../hygiene/recipes.mjs';
import { basename } from 'node:path';
import { stampActivity } from '../hygiene/ledger.mjs';
import { discoverRuns } from '../hygiene/sweep.mjs';
import { inspect } from '../proc/owns.mjs';

export async function hostIdentity(event, { processAdapter, hostPid, parentPid = process.ppid }) {
  const specified = hostPid || event.hostPid;
  if (specified) {
    const row = await inspect(processAdapter, specified);
    return row?.readable && row.startTime != null ? row : null;
  }
  const seen = new Set();
  let pid = parentPid;
  while (pid > 1 && !seen.has(pid)) {
    seen.add(pid);
    const row = await inspect(processAdapter, pid);
    if (!row?.readable || row.startTime == null) return null;
    if (/^claude(?:\.exe)?$/.test(basename(row.executable || '')) || row.argv?.some(arg => /(?:^|\/)@anthropic-ai\/claude-code\/cli\.js$/.test(arg))) return row;
    pid = row.ppid;
  }
  return null;
}

export async function stamp(event, tool, options) {
  if (!tool) return { stamped: false };
  const host = await hostIdentity(event, options);
  if (!host) return { stamped: false, reason: 'UNVERIFIED: host process identity' };
  await (options.stampActivity || stampActivity)({ ...options, sessionKey: event.sessionKey, hostPid: host.pid, hostStartTime: host.startTime, driverId: tool.driverId, driverVersion: options.versions?.[tool.driverId] || (RECIPES.find(recipe => recipe.id === tool.driverId)?.version === (options.env || process.env).AUN_DRIVER_VERSION ? (options.env || process.env).AUN_DRIVER_VERSION : undefined) });
  await options.ledger.updateSession(event.sessionKey, old => ({ ...old, hooks: { ...old?.hooks, closeBlocked: false } }));
  const discovery = await (options.discoverRuns || discoverRuns)({ ...options, sessionKey: event.sessionKey, allowRemote: false });
  return { stamped: true, hostPid: host.pid, driverId: tool.driverId, discovery };
}
