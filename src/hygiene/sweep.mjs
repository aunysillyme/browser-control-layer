import { createHash } from 'node:crypto';
import { attribute, attributeDaemon } from '../proc/ancestry.mjs';
import { inspect } from '../proc/owns.mjs';
import { createLedger, stampActivity } from './ledger.mjs';
import { processAdapter as makeAdapter } from '../proc/table.mjs';
import { processTable } from '../proc/table.mjs';
import { profileArgument, isUserProfile } from './profiles.mjs';
import { matchRecipe, RECIPES } from './recipes.mjs';
import { reap } from './reap.mjs';

export async function discoverRuns(options) {
  const { ledger, processAdapter, sessionKey, recipes = RECIPES, profileOptions = {} } = options;
  const table = await processTable(processAdapter);
  if (!table.verified || !sessionKey) return { verified: table.verified, discovered: [] };
  const session = await ledger.readSession(sessionKey);
  const stamps = Object.values(session?.stamps || {});
  const existing = await ledger.list();
  const discovered = [];
  for (const row of table.rows) {
    if (existing.some(record => record.pid === row.pid && record.startTime === row.startTime)) continue;
    const versions = options.versions || Object.fromEntries(stamps.map(stamp => [stamp.driverId, stamp.driverVersion]));
    const recipe = matchRecipe(row, { ...options, versions });
    if (!recipe) continue;
    const userDataDir = profileArgument(row.argv);
    if (isUserProfile(userDataDir, profileOptions)) continue;
    const stamp = attribute(row, table.rows, stamps, recipes) || await attributeDaemon(row, table.rows, stamps, recipe, processAdapter);
    const parent = table.rows.find(item => item.pid === row.ppid);
    if (!stamp || !parent?.readable) continue;
    const id = createHash('sha256').update(`${sessionKey}:${row.pid}:${row.startTime}`).digest('hex');
    const record = { ...row, id, kind: 'recipe', sessionKey, hostPid: stamp.hostPid, hostStartTime: stamp.hostStartTime, driverId: recipe.id, driverVersion: recipe.version, parentPid: parent.pid, parentStartTime: parent.startTime, userDataDir, profileClass: recipe.profileClass, ...(stamp.driver ? { daemon: stamp.driver } : {}), lastActivity: stamp.lastActivity, tabsCreated: [], remoteSessionIds: [], budgets: {} };
    await ledger.write(record);
    discovered.push(record);
  }
  return { verified: true, discovered };
}

export async function quickSweep(options) {
  if (options.readOnly) return { reportOnly: true };
  const discovery = await discoverRuns(options);
  const results = [];
  for (const mode of options.modes || ['orphans', 'idle']) results.push(await reap({ ...options, mode, allowRemote: false }));
  return { ...discovery, results };
}

export async function cliSweep(input = {}) {
  const env = input.env || process.env;
  const sessionKey = input.sessionKey || env.AUN_SESSION_KEY;
  if (!sessionKey || input.readOnly) return { reportOnly: true, reason: 'session-context-absent' };
  const options = { ...input, sessionKey, ledger: input.ledger || createLedger(), processAdapter: input.processAdapter || makeAdapter(), allowRemote: false };
  const hostPid = input.hostPid ?? Number(env.AUN_HOST_PID);
  const driverId = input.driverId || env.AUN_DRIVER_ID;
  if (Number.isInteger(hostPid) && hostPid > 0 && driverId) {
    const host = await inspect(options.processAdapter, hostPid);
    if (host?.readable && host.startTime != null && (typeof process.getuid !== 'function' || host.uid === process.getuid())) {
      await stampActivity({ ...options, hostPid, hostStartTime: host.startTime, driverId, driverVersion: input.driverVersion || env.AUN_DRIVER_VERSION });
    }
  }
  return quickSweep(options);
}
