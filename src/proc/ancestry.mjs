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
    const driver = chain.rows.find(row => row.pid !== host.pid && recipe.driverExecutables?.includes(row.executable) && row.argv?.some(arg => recipe.driverArg?.(arg)));
    if (driver) return { ...stamp, driverPid: driver.pid, driverStartTime: driver.startTime };
  }
  return null;
}
