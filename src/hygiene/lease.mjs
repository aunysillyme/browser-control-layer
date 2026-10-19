import { spawn as spawnProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { inspect } from '../proc/owns.mjs';
import { verifiedGroup } from '../proc/signals.mjs';
import { headroom } from './headroom.mjs';
import { PROFILE, profileArgument } from './profiles.mjs';
import { cleanup } from './cleanup.mjs';

export async function startLease(command, options) {
  const { ledger, processAdapter, sessionKey, hostPid = process.pid, driverId = 'aun-lease', spawn = spawnProcess, now = Date.now, env = process.env } = options;
  if (processAdapter.platform === 'win32') throw new Error('LEASE_PLATFORM: lease requires a verified process-group adapter');
  if (!Array.isArray(command) || !command.length || !command.some(arg => arg === '--user-data-dir={profile}') || command.filter(arg => arg.startsWith('--user-data-dir')).length !== 1) throw new Error('LEASE_PROFILE: pass --user-data-dir={profile} to the driver');
  const room = headroom(options.headroomOptions);
  if (!room.allowed) throw new Error('HEADROOM: launch exceeds the explicit headroom policy');
  const id = randomBytes(16).toString('hex');
  const runToken = randomBytes(24).toString('hex');
  const runDir = await ledger.createRunDirectory(id);
  const userDataDir = join(runDir, 'profile');
  await ledger.fs.mkdir(userDataDir, { mode: 0o700 });
  const argv = command.map(arg => arg.replaceAll('{profile}', userDataDir));
  const at = typeof now === 'function' ? now() : now;
  const provisional = { id, kind: 'leased', sessionKey, hostPid, driverId, runToken, userDataDir, profileClass: PROFILE.THROWAWAY, lastActivity: at, status: 'UNVERIFIED', executable: argv[0], argv, budgets: options.budgets || {} };
  await ledger.writeOwner(id, provisional);
  await ledger.write(provisional);
  const child = spawn(argv[0], argv.slice(1), { detached: true, stdio: options.stdio || 'inherit', env: { ...env, AUN_RUN_TOKEN: runToken, AUN_PROFILE_DIR: userDataDir } });
  const completion = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code, signal) => resolve({ code, signal })); });
  // Register immediately after spawn; a refused inspection returns a clear
  // unverified result and never substitutes a PID-only cleanup.
  await new Promise((resolve, reject) => { if (child.pid) resolve(); else { child.once('spawn', resolve); child.once('error', reject); } });
  await ledger.update(id, old => ({ ...old, pid: child.pid, pgid: child.pid }));
  const current = await inspect(processAdapter, child.pid);
  if (!current?.readable || current.pgid !== child.pid || profileArgument(current.argv) !== userDataDir) return { verified: false, reason: 'LEASE_INSPECTION: launched process requires inspection before cleanup', child, completion, id, userDataDir };
  const host = await inspect(processAdapter, hostPid);
  const record = { ...current, id, kind: 'leased', sessionKey, hostPid, hostStartTime: host?.startTime, driverId, runToken, userDataDir, profileClass: PROFILE.THROWAWAY, lastActivity: at, leaseRenewedAt: at, tabsCreated: [], remoteSessionIds: [], budgets: options.budgets || {}, members: [current] };
  await ledger.writeOwner(id, { pid: record.pid, pgid: record.pgid, startTime: record.startTime, runToken, userDataDir });
  await ledger.write(record);
  return { verified: true, child, completion, record, headroom: room };
}

export async function refreshLease(record, options) {
  const members = await verifiedGroup(record, options);
  if (!members) return false;
  await options.ledger.update(record.id, old => ({ ...old, members, leaseRenewedAt: typeof options.now === 'function' ? options.now() : options.now ?? Date.now() }));
  return true;
}

export async function lease(command, options) {
  const started = await startLease(command, options);
  if (!started.verified) {
    // Wait for the child this command opened. Ownership remains unverified, so
    // recovery uses the provisional ledger record and never a PID-only signal.
    await started.completion;
    return { exitCode: 3, output: `${started.reason}; recovery record=${started.id}`, id: started.id };
  }
  const events = options.events || process;
  let cleaning;
  const finish = () => cleaning ||= cleanup({ ...options, sessionKey: started.record.sessionKey, runId: started.record.id, apply: true, mode: 'cleanup' });
  const interrupted = () => { void finish(); };
  events.on('SIGINT', interrupted);
  events.on('SIGTERM', interrupted);
  let result;
  try { result = await started.completion; }
  finally { await finish(); events.removeListener('SIGINT', interrupted); events.removeListener('SIGTERM', interrupted); }
  const cleaned = await cleaning;
  return { exitCode: cleaned.exitCode || result.code || (result.signal ? 1 : 0), output: cleaned.line, cleanup: cleaned };
}
