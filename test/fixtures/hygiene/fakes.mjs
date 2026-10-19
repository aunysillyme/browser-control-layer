import { constants } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createLedger } from '../../../src/hygiene/ledger.mjs';

const failure = code => Object.assign(new Error(code), { code });
export function fakeFs() {
  const entries = new Map();
  const uid = process.getuid?.() ?? 0;
  let inode = 1;
  const make = (kind, mode, data = '') => ({ kind, mode, data, uid, ino: inode++, dev: 1, nlink: 1 });
  entries.set('/', make('dir', 0o755));
  const get = path => { const entry = entries.get(resolve(path)); if (!entry) throw failure('ENOENT'); return entry; };
  const stat = entry => ({ ...entry, isDirectory: () => entry.kind === 'dir', isFile: () => entry.kind === 'file', isSymbolicLink: () => entry.kind === 'link' });
  const fs = {
    entries, removals: [], writes: [],
    async lstat(path) { return stat(get(path)); },
    async realpath(path) {
      path = resolve(path);
      let current = '';
      for (const part of path.split('/').filter(Boolean)) { current += `/${part}`; const row = get(current); if (row.kind === 'link') current = await fs.realpath(row.data); }
      return current || '/';
    },
    async mkdir(path, { mode = 0o777, recursive = false } = {}) {
      path = resolve(path);
      if (entries.has(path)) { if (recursive) return; throw failure('EEXIST'); }
      if (!entries.has(dirname(path))) { if (recursive) await fs.mkdir(dirname(path), { mode, recursive }); else throw failure('ENOENT'); }
      entries.set(path, make('dir', mode)); fs.writes.push(path);
    },
    async open(path, flags, mode = 0o666) {
      path = resolve(path);
      const previous = entries.get(path);
      if (previous?.kind === 'link' && flags & constants.O_NOFOLLOW) throw failure('ELOOP');
      if (previous && flags & constants.O_EXCL) throw failure('EEXIST');
      if (!previous && !(flags & constants.O_CREAT)) throw failure('ENOENT');
      if (!previous) { get(dirname(path)); entries.set(path, make('file', mode)); }
      const entry = get(path);
      return { async readFile() { return entry.data; }, async writeFile(data) { entry.data = String(data); fs.writes.push(path); }, async sync() {}, async close() {}, async stat() { return stat(entry); } };
    },
    async readFile(path) { return get(path).data; },
    async writeFile(path, data, { mode = 0o600 } = {}) { entries.set(resolve(path), make('file', mode, String(data))); fs.writes.push(resolve(path)); },
    async rename(source, target) {
      source = resolve(source); target = resolve(target); get(source); get(dirname(target));
      const moved = [...entries].filter(([path]) => path === source || path.startsWith(source + '/'));
      for (const [path] of moved) entries.delete(path);
      for (const [path, entry] of moved) entries.set(target + path.slice(source.length), entry);
      fs.writes.push(target);
    },
    async readdir(path) { get(path); return [...entries.keys()].filter(item => dirname(item) === resolve(path) && item !== '/').map(item => item.split('/').at(-1)); },
    async unlink(path) { get(path); entries.delete(resolve(path)); fs.removals.push(resolve(path)); },
    async rm(path, { recursive = false } = {}) {
      path = resolve(path); const entry = get(path);
      if (!recursive && entry.kind === 'dir') throw failure('EISDIR');
      for (const key of entries.keys()) if (key === path || recursive && key.startsWith(path + '/')) entries.delete(key);
      fs.removals.push(path);
    },
    async symlink(target, path) { entries.set(resolve(path), make('link', 0o777, resolve(target))); }
  };
  return fs;
}

export function fakeProcess(rows = []) {
  const state = new Map(rows.map(row => [row.pid, { ...row }]));
  const tokens = new Map();
  const signals = [];
  const adapter = { platform: 'linux', state, tokens, signals, keepAlive: false,
    async list() { return [...state.values()].map(row => ({ ...row })); },
    async inspect(pid) { return state.has(pid) ? { ...state.get(pid) } : null; },
    async inspectToken(pid) { return tokens.get(pid) || null; },
    async signal(pid, signal) {
      signals.push({ pid, signal });
      if (adapter.keepAlive) return;
      if (pid < 0) { for (const row of state.values()) if (row.pgid === -pid) state.delete(row.pid); }
      else state.delete(pid);
    }
  };
  return adapter;
}

export function processRow(pid, extra = {}) {
  return { pid, ppid: 50, pgid: pid, uid: process.getuid?.() ?? 0, startTime: `start-${pid}`, executable: '/test/chrome', argv: ['/test/chrome'], readable: true, rssBytes: 10, cpuPercent: 0, ...extra };
}

export async function leasedFixture(extra = {}) {
  const fs = fakeFs();
  const ledger = createLedger({ root: '/state', fs, now: () => 1000 });
  await ledger.initialize();
  const userDataDir = '/state/runs/run1/profile';
  await ledger.createRunDirectory('run1');
  await fs.mkdir(userDataDir, { mode: 0o700 });
  const record = { ...processRow(100, { argv: ['/test/chrome', `--user-data-dir=${userDataDir}`] }), id: 'run1', kind: 'leased', runToken: 'f'.repeat(48), sessionKey: 'session-1', driverId: 'fixture-driver', hostPid: 50, hostStartTime: 'start-50', userDataDir, profileClass: 'throwaway', lastActivity: 0, leaseRenewedAt: 0, tabsCreated: [], remoteSessionIds: [], budgets: {}, ...extra };
  record.members = [processRow(record.pid, record)];
  await ledger.write(record);
  await ledger.writeOwner(record.id, { pid: record.pid, pgid: record.pgid, startTime: record.startTime, runToken: record.runToken, userDataDir: record.userDataDir });
  const adapter = fakeProcess([processRow(100, record), processRow(50, { ppid: 1, executable: '/test/host', pgid: 50, argv: ['/test/host'] })]);
  adapter.tokens.set(record.pid, { runToken: record.runToken, profilePath: userDataDir });
  return { fs, ledger, record, processAdapter: adapter, now: () => 400000, profileOptions: { home: '/user', env: {}, platform: 'linux' } };
}
