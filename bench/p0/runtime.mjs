import { execFile, fork } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, mkdtemp, mkdir, writeFile, realpath, lstat, rm } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const execute = promisify(execFile);
const worker = fileURLToPath(new URL('./worker.mjs', import.meta.url));
export const wait = ms => new Promise(resolveWait => setTimeout(resolveWait, ms));

export function parseTable(text) {
  return text.split('\n').filter(Boolean).map(line => {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\S+\s+\S+\s+\d+\s+\d+:\d+:\d+\s+\d+)\s+(.*)$/);
    if (!match) throw new Error(`P0_PS_FORMAT: ${line}`);
    return { pid: Number(match[1]), ppid: Number(match[2]), start: match[3].replace(/\s+/g, ' '), argv: match[4] };
  });
}

export function profileFrom(argv) {
  const match = argv.match(/--user-data-dir(?:=|\s+)(.*?)(?=\s--[A-Za-z]|$)/);
  if (!match) return null;
  return match[1].replace(/^(["'])(.*)\1$/, '$2');
}

export function ownedRoots(table, runDir, browserPath) {
  const prefix = resolve(runDir) + sep;
  return table.filter(proc => {
    const profile = profileFrom(proc.argv);
    const executableMatches = !browserPath || [browserPath, `"${browserPath}"`].some(path => proc.argv.startsWith(path + ' '));
    return executableMatches && profile && resolve(profile).startsWith(prefix) && !/(?:^|\s)--type=/.test(proc.argv);
  });
}

export function sameIdentity(expected, actual) {
  return Boolean(actual && expected.pid === actual.pid && expected.start === actual.start && expected.argv === actual.argv);
}

export function descendants(table, roots) {
  const ids = new Set(roots.map(proc => proc.pid));
  let changed = true;
  while (changed) {
    changed = false;
    for (const proc of table) if (ids.has(proc.ppid) && !ids.has(proc.pid)) { ids.add(proc.pid); changed = true; }
  }
  return table.filter(proc => ids.has(proc.pid));
}

export function requireCi(env = process.env, { authorizedBenchmark = false } = {}) {
  if (authorizedBenchmark) return;
  if (env.CI !== 'true' || env.GITHUB_ACTIONS !== 'true' || !env.RUNNER_TEMP) {
    throw new Error('P0_CI_ONLY: real browser observations require a GitHub Actions runner');
  }
}

export async function signalChecked(expected, name, { table, send, validate }) {
  if (!expected || !Number.isSafeInteger(expected.pid) || expected.pid <= 1 || !expected.start || !expected.argv) {
    throw new Error('P0_IDENTITY_MISSING: refused signal');
  }
  await validate(expected);
  const current = (await table()).find(proc => proc.pid === expected.pid);
  if (!current) return false;
  if (!sameIdentity(expected, current)) throw new Error(`P0_IDENTITY_CHANGED: ${expected.pid}`);
  send(expected.pid, name);
  return true;
}

export async function validateRun(handle) {
  const dir = await lstat(handle.runDir);
  const marker = await lstat(join(handle.runDir, '.owner'));
  if (!dir.isDirectory() || dir.isSymbolicLink() || !marker.isFile() || marker.isSymbolicLink() ||
      (dir.mode & 0o777) !== 0o700 || (marker.mode & 0o777) !== 0o600 ||
      await readFile(join(handle.runDir, '.owner'), 'utf8') !== handle.token) {
    throw new Error('P0_OWNER_MARKER: refused cleanup');
  }
}

export async function createRuntime({ root, versions, browserPath, env = process.env, authorizedBenchmark = false }) {
  requireCi(env, { authorizedBenchmark });
  const table = async () => parseTable((await execute('ps', ['-axo', 'pid=,ppid=,lstart=,command='], { env: { ...env, LC_ALL: 'C', LANG: 'C' }, maxBuffer: 16 * 1024 * 1024 })).stdout);
  const rootsFor = (all, handle) => ownedRoots(all, handle.runDir, browserPath);
  const validateProfile = async (handle, proc) => {
    if (!rootsFor([proc], handle).length) throw new Error('P0_UNKNOWN_ROOT: refused signal');
    const profile = await realpath(profileFrom(proc.argv));
    if (!profile.startsWith((await realpath(handle.runDir)) + sep)) throw new Error('P0_PROFILE_ESCAPE: refused signal');
  };
  const signal = (expected, name, handle, browser = false) => signalChecked(expected, name, {
    table, send: (pid, value) => process.kill(pid, value),
    validate: async proc => { await validateRun(handle); if (browser) await validateProfile(handle, proc); }
  });
  return {
    now: () => Date.now(), wait,
    async start(item) {
      const runDir = await mkdtemp(join(env.RUNNER_TEMP, 'aun-p0-'));
      const token = randomUUID();
      await writeFile(join(runDir, '.owner'), token, { mode: 0o600 });
      for (const dir of ['home', 'tmp', 'cache', 'config', 'state']) await mkdir(join(runDir, dir), { mode: 0o700 });
      const driverEnv = {
        PATH: env.PATH, HOME: join(runDir, 'home'), TMPDIR: join(runDir, 'tmp'),
        XDG_CACHE_HOME: join(runDir, 'cache'), XDG_CONFIG_HOME: join(runDir, 'config'),
        XDG_STATE_HOME: join(runDir, 'state'), LANG: 'C', LC_ALL: 'C',
        CI: 'true', NO_COLOR: '1', AGENT_BROWSER_SESSION: token,
        AGENT_BROWSER_SOCKET_DIR: join(runDir, 'state')
      };
      const executable = item.driver.executable || join(root, 'node_modules', '.bin', item.driver.command);
      const spec = { ...item, runDir, token, executable, browserPath };
      const owner = fork(worker, [JSON.stringify(spec)], { env: driverEnv, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
      let output = '';
      owner.stdout.on('data', chunk => { output += chunk; });
      owner.stderr.on('data', chunk => { output += chunk; });
      const handle = { owner, runDir, token, item, observed: [], output: () => output, versions: { ...versions, node: process.version } };
      // Keep the handle on launch errors so the caller can retain evidence and close owned children.
      try {
        const ready = await new Promise((resolveReady, reject) => {
          const timer = setTimeout(() => reject(new Error(`P0_LAUNCH_TIMEOUT\n${output}`)), 60_000);
          owner.once('error', error => { clearTimeout(timer); reject(error); });
          owner.once('exit', (code, name) => { clearTimeout(timer); reject(new Error(`P0_OWNER_EXIT: ${code} ${name}\n${output}`)); });
          owner.once('message', message => {
            clearTimeout(timer);
            if (message.type === 'ready') resolveReady(message);
            else reject(new Error(`P0_DRIVER_START: ${JSON.stringify(message.error)}\n${output}`));
          });
        });
        const all = await table();
        handle.ownerIdentity = all.find(proc => proc.pid === owner.pid);
        handle.driverIdentity = all.find(proc => proc.pid === ready.driverPid && proc.ppid === owner.pid);
        handle.launch = ready;
        if (!handle.ownerIdentity) throw new Error('P0_OWNER_PROBE: process identity unavailable');
        if (ready.driverPid && !handle.driverIdentity) throw new Error('P0_DRIVER_PROBE: driver identity unavailable');
        return handle;
      } catch (error) {
        error.handle = handle;
        const all = await table().catch(() => []);
        handle.ownerIdentity ??= all.find(proc => proc.pid === owner.pid);
        handle.observed = descendants(all, rootsFor(all, handle));
        error.message += `\nP0 launch directory retained: ${runDir}`;
        throw error;
      }
    },
    async probe(handle) {
      await validateRun(handle);
      const all = await table();
      const browserRoots = rootsFor(all, handle);
      for (const proc of browserRoots) await validateProfile(handle, proc);
      const processes = descendants(all, browserRoots);
      for (const proc of processes) if (!handle.observed.some(item => sameIdentity(item, proc))) handle.observed.push(proc);
      const remainingObserved = all.filter(proc => handle.observed.some(item => sameIdentity(item, proc)));
      return { browserRoots, processes: remainingObserved };
    },
    endOwner: (handle, name = 'SIGKILL') => signal(handle.ownerIdentity, name, handle),
    async cleanup(handle) {
      await validateRun(handle);
      if (handle.owner.connected) handle.owner.send({ type: 'close' });
      await wait(1_000);
      const all = await table();
      for (const proc of rootsFor(all, handle)) {
        const known = handle.observed.find(item => sameIdentity(item, proc));
        if (!known) throw new Error('P0_UNKNOWN_ROOT: refused signal');
        await signal(known, 'SIGTERM', handle, true);
      }
      if (handle.driverIdentity) await signal(handle.driverIdentity, 'SIGTERM', handle);
      if (handle.ownerIdentity) await signal(handle.ownerIdentity, 'SIGTERM', handle);
      await wait(3_000);
      const observed = [...handle.observed, handle.ownerIdentity, handle.driverIdentity].filter(Boolean);
      const remaining = (await table()).filter(proc => observed.some(item => sameIdentity(item, proc)));
      const persistent = handle.item.variant.profileClass === 'driver-persistent';
      if (!remaining.length && !persistent) { await validateRun(handle); await rm(handle.runDir, { recursive: true }); }
      return { remaining, profile_kept: persistent, launch: handle.launch, output: handle.output(), run_dir: handle.runDir };
    }
  };
}
