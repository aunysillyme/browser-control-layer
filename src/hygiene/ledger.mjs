import * as nativeFs from 'node:fs/promises';
import { constants } from 'node:fs';
import { randomBytes, createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join, resolve, dirname, parse } from 'node:path';
import { config } from '../config.mjs';

const marker = '.aun-state';
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]+$/.test(value);
const sessionId = value => createHash('sha256').update(String(value)).digest('hex');
const fail = (code, message) => Object.assign(new Error(`${code}: ${message}`), { code });

export function stateRoot({ platform = process.platform, env = process.env, home = homedir(), name = config().skillName } = {}) {
  if (platform === 'darwin') return join(home, 'Library/Application Support', name);
  if (platform === 'win32') return join(env.LOCALAPPDATA || join(home, 'AppData/Local'), name);
  return join(env.XDG_STATE_HOME || join(home, '.local/state'), name);
}

function validate(record) {
  if (!record || !validId(record.id) || !['leased', 'recipe', 'remote'].includes(record.kind)) throw fail('LEDGER_SCHEMA', 'run id and kind are required');
  if (typeof record.sessionKey !== 'string' || !Number.isFinite(record.lastActivity)) throw fail('LEDGER_SCHEMA', 'session key and activity are required');
  for (const key of ['pid', 'pgid', 'hostPid']) if (record[key] != null && (!Number.isInteger(record[key]) || record[key] <= 0)) throw fail('LEDGER_SCHEMA', `${key} must be a positive integer`);
  return { tabsCreated: [], remoteSessionIds: [], budgets: {}, ...record, version: 1 };
}

export function createLedger({ root = stateRoot(), fs = nativeFs, now = Date.now } = {}) {
  root = resolve(root);
  let opened = false;
  async function stat(path) { try { return await fs.lstat(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
  async function safeDirectory(path, create = false) {
    const ancestors = [];
    let cursor = path;
    while (cursor !== parse(cursor).root) { ancestors.unshift(cursor); cursor = dirname(cursor); }
    for (const item of ancestors) {
      let info = await stat(item);
      if (!info && create) { await fs.mkdir(item, { mode: 0o700 }); info = await stat(item); }
      if (!info || info.isSymbolicLink() || !info.isDirectory()) throw fail('LEDGER_SYMLINK', 'state path must contain real directories');
    }
    const info = await stat(path);
    if ((info.mode & 0o077) !== 0) throw fail('LEDGER_MODE', 'state directories require mode 0700');
    if (typeof process.getuid === 'function' && info.uid !== process.getuid()) throw fail('LEDGER_OWNER', 'state directory has another owner');
  }
  async function safeFile(path, optional = false) {
    const info = await stat(path);
    if (!info && optional) return false;
    if (!info || info.isSymbolicLink() || !info.isFile() || info.nlink !== 1) throw fail('LEDGER_SYMLINK', 'state file must be a single regular file');
    if ((info.mode & 0o077) !== 0) throw fail('LEDGER_MODE', 'state files require mode 0600');
    if (typeof process.getuid === 'function' && info.uid !== process.getuid()) throw fail('LEDGER_OWNER', 'state file has another owner');
    return true;
  }
  async function readJson(path, optional = false) {
    if (!(await safeFile(path, optional))) return null;
    const handle = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try { return JSON.parse(await handle.readFile('utf8')); }
    catch (error) { throw fail('LEDGER_READ', error.message); }
    finally { await handle.close(); }
  }
  async function atomic(path, value) {
    await safeDirectory(dirname(path));
    await safeFile(path, true);
    const temp = `${path}.${randomBytes(8).toString('hex')}.tmp`;
    const handle = await fs.open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await handle.writeFile(JSON.stringify(value) + '\n'); await handle.sync(); }
    finally { await handle.close(); }
    try { await fs.rename(temp, path); }
    catch (error) { await fs.unlink(temp).catch(() => {}); throw error; }
  }
  async function initialize({ readOnly = false } = {}) {
    const present = await stat(root);
    if (!present && readOnly) return false;
    await safeDirectory(root, !present);
    if (!present) {
      const handle = await fs.open(join(root, marker), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try { await handle.writeFile(JSON.stringify({ format: 'aun-ledger', version: 1 }) + '\n'); await handle.sync(); } finally { await handle.close(); }
    }
    const owner = await readJson(join(root, marker));
    if (owner?.format !== 'aun-ledger' || owner.version !== 1) throw fail('LEDGER_MARKER', 'state marker does not match');
    for (const dir of ['records', 'sessions', 'runs']) {
      const path = join(root, dir);
      if (!(await stat(path)) && readOnly) continue;
      await safeDirectory(path, true);
    }
    opened = true;
    return true;
  }
  async function ensure(readOnly = false) { if (!opened) return initialize({ readOnly }); await safeDirectory(root); return true; }
  async function withLock(action) {
    await ensure();
    const path = join(root, '.lock');
    let handle;
    try { handle = await fs.open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
    catch (error) { throw fail('LEDGER_LOCKED', error.code || 'state lock unavailable'); }
    try { await handle.writeFile(JSON.stringify({ pid: process.pid, at: now() })); return await action(); }
    finally { await handle.close(); await fs.unlink(path); }
  }
  const recordPath = id => { if (!validId(id)) throw fail('LEDGER_ID', 'invalid run id'); return join(root, 'records', `${id}.json`); };
  async function read(id) { if (!(await ensure(true))) return null; const row = await readJson(recordPath(id), true); return row ? validate(row) : null; }
  async function list() {
    if (!(await ensure(true))) return [];
    if (!(await stat(join(root, 'records')))) return [];
    await safeDirectory(join(root, 'records'));
    const files = await fs.readdir(join(root, 'records'));
    const records = [];
    for (const file of files.filter(name => name.endsWith('.json')).sort()) records.push(validate(await readJson(join(root, 'records', file))));
    return records;
  }
  async function write(record) { const checked = validate(record); return withLock(async () => { await atomic(recordPath(checked.id), checked); return checked; }); }
  async function update(id, change) { return withLock(async () => { const old = await readJson(recordPath(id)); const next = validate(await change(old)); if (next.id !== id) throw fail('LEDGER_ID', 'run id is immutable'); await atomic(recordPath(id), next); return next; }); }
  async function remove(id) { return withLock(async () => { const path = recordPath(id); if (await safeFile(path, true)) await fs.unlink(path); }); }
  const sessionPath = key => join(root, 'sessions', `${sessionId(key)}.json`);
  async function readSession(key) { if (!(await ensure(true))) return null; if (!(await stat(join(root, 'sessions')))) return null; return readJson(sessionPath(key), true); }
  async function updateSession(key, change) { return withLock(async () => { const next = await change(await readJson(sessionPath(key), true)); await atomic(sessionPath(key), next); return next; }); }
  async function createRunDirectory(id) { recordPath(id); await ensure(); const path = join(root, 'runs', id); await safeDirectory(path, true); return path; }
  async function writeOwner(id, owner) { const path = await createRunDirectory(id); return withLock(() => atomic(join(path, 'owner.json'), owner)); }
  async function readOwner(id) { const path = join(root, 'runs', id); if (!(await stat(path))) return null; await safeDirectory(path); return readJson(join(path, 'owner.json'), true); }
  return { root, fs, now, initialize, list, read, write, update, remove, withLock, readSession, updateSession, createRunDirectory, writeOwner, readOwner, safeDirectory, safeFile };
}

export async function stampActivity({ ledger, sessionKey, hostPid, hostStartTime, driverId, driverVersion, driverSession, processAdapter, now = Date.now }) {
  if (processAdapter) {
    const { cancelIdleTimer } = await import('./idle-timer.mjs');
    await cancelIdleTimer({ ledger, sessionKey, processAdapter });
  }
  const at = typeof now === 'function' ? now() : now;
  await ledger.updateSession(sessionKey, old => ({ ...old, sessionKey, lastActivity: at, generation: (old?.generation || 0) + 1, stamps: { ...old?.stamps, [`${hostPid}:${driverId}`]: { hostPid, hostStartTime, driverId, driverVersion, ...(driverSession || old?.stamps?.[`${hostPid}:${driverId}`]?.driverSessions ? { driverSessions: [...new Set([...(old?.stamps?.[`${hostPid}:${driverId}`]?.driverSessions || []), ...(driverSession ? [driverSession] : [])])] } : {}), lastActivity: at } } }));
  for (const record of await ledger.list()) if (record.sessionKey === sessionKey && record.hostPid === hostPid && record.driverId === driverId && String(record.hostStartTime) === String(hostStartTime)) await ledger.update(record.id, old => ({ ...old, lastActivity: at, leaseRenewedAt: old.kind === 'leased' ? at : old.leaseRenewedAt }));
  return at;
}
