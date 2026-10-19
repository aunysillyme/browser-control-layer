import { basename } from 'node:path';

export function ancestors(pid, table) {
  const byPid = new Map(table.map(row => [row.pid, row]));
  const seen = new Set([pid]);
  const result = [];
  let cursor = byPid.get(pid);
  while (cursor && Number.isInteger(cursor.ppid) && cursor.ppid > 0) {
    if (seen.has(cursor.ppid)) return { verified: false, rows: result, reason: 'ancestry-cycle' };
    seen.add(cursor.ppid);
    cursor = byPid.get(cursor.ppid);
    if (!cursor) break;
    result.push(cursor);
  }
  return { verified: true, rows: result };
}

export function attribute(processInfo, table, stamps, recipes = []) {
  const chain = ancestors(processInfo.pid, table);
  if (!chain.verified) return null;
  for (const stamp of stamps) {
    const host = chain.rows.find(row => row.pid === stamp.hostPid);
    if (!host || !host.readable || !stamp.hostStartTime || host.startTime !== stamp.hostStartTime) continue;
    const recipe = recipes.find(row => row.id === stamp.driverId);
    if (!recipe || !recipe.version || stamp.driverVersion !== recipe.version) continue;
    const driver = chain.rows.find(row => row.pid !== host.pid && (recipe.driverExecutables?.includes(row.executable) || recipe.platformDriverExecutables?.[row.platform]?.includes(row.executable)) && row.argv?.some(arg => recipe.driverArg?.(arg)));
    if (driver) return { ...stamp, driverPid: driver.pid, driverStartTime: driver.startTime };
  }
  return null;
}

// Daemon recipes: the browser's own parent is the recipe's daemon, and the daemon's environment names a session the host stamped.
// The host need not be an ancestor (the daemon may live on after the host is gone); an unreadable environment or a session no stamp names attributes nothing.
export async function attributeDaemon(processInfo, table, stamps, recipe, adapter) {
  const daemon = recipe?.daemon;
  if (!daemon || typeof adapter?.inspectEnv !== 'function') return null;
  const parent = table.find(row => row.pid === processInfo.ppid);
  if (!parent?.readable || parent.startTime == null || !daemon.executable(basename(parent.executable || ''))) return null;
  let env;
  try { env = await adapter.inspectEnv(parent.pid, [daemon.sessionEnv]); } catch { return null; }
  const session = env?.[daemon.sessionEnv];
  if (!session) return null;
  const stamp = stamps.find(item => item.driverId === recipe.id && item.driverVersion === recipe.version && item.hostStartTime && Array.isArray(item.driverSessions) && item.driverSessions.includes(session));
  return stamp ? { ...stamp, driver: { pid: parent.pid, startTime: parent.startTime, executable: parent.executable, session } } : null;
}
