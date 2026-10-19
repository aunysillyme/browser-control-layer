import { readFile, readdir, readlink } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);

export function parseStat(text) {
  const end = text.lastIndexOf(')');
  if (end < 0) throw new Error('PROCESS_FORMAT: malformed stat');
  const pid = Number(text.slice(0, text.indexOf(' ')));
  const fields = text.slice(end + 2).trim().split(/\s+/);
  if (!Number.isInteger(pid) || fields.length < 22) throw new Error('PROCESS_FORMAT: short stat');
  return { pid, state: fields[0], ppid: Number(fields[1]), pgid: Number(fields[2]), startTime: fields[19], cpuTicks: Number(fields[11]) + Number(fields[12]), rssPages: Number(fields[21]) };
}

export function linuxAdapter({ fs = { readFile, readdir, readlink }, procRoot = '/proc', signal = process.kill.bind(process), run = exec, now = Date.now } = {}) {
  let clockTicks;
  const samples = new Map();
  async function tickRate() {
    if (!clockTicks) clockTicks = run('getconf', ['CLK_TCK'], { timeout: 1500, maxBuffer: 1024 }).then(result => { const ticks = Number(result.stdout.trim()); return Number.isFinite(ticks) && ticks > 0 ? ticks : null; }).catch(() => null);
    return clockTicks;
  }
  async function inspect(pid) {
    if (!Number.isInteger(pid) || pid <= 0) return null;
    const base = `${procRoot}/${pid}`;
    let row;
    try { row = parseStat(await fs.readFile(`${base}/stat`, 'utf8')); }
    catch (error) { return error.code === 'ENOENT' || error.code === 'ESRCH' ? null : { pid, readable: false, reason: error.code || 'PROCESS_INSPECT' }; }
    const values = await Promise.allSettled([fs.readFile(`${base}/cmdline`, 'utf8'), fs.readlink(`${base}/exe`), fs.readFile(`${base}/status`, 'utf8')]);
    const [command, executable, status] = values.map(value => value.status === 'fulfilled' ? value.value : null);
    const argv = command?.split('\0').filter(Boolean) || [];
    const uid = Number(status?.match(/^Uid:\s+(\d+)/m)?.[1]);
    const rssKiB = Number(status?.match(/^VmRSS:\s+(\d+)\s+kB/m)?.[1]);
    const at = now(); const previous = samples.get(pid); const rate = await tickRate();
    const cpuPercent = previous?.startTime === row.startTime && at > previous.at && rate ? Math.max(0, (row.cpuTicks - previous.cpuTicks) / rate / ((at - previous.at) / 1000) * 100) : null;
    samples.set(pid, { startTime: row.startTime, cpuTicks: row.cpuTicks, at });
    return { ...row, executable, argv, uid: Number.isFinite(uid) ? uid : null, rssBytes: Number.isFinite(rssKiB) ? rssKiB * 1024 : row.state === 'Z' ? 0 : null, cpuPercent, readable: Boolean(argv.length && executable && status), reason: values.some(value => value.status === 'rejected') ? 'PROCESS_INSPECT' : undefined };
  }
  async function inspectToken(pid) {
    try {
      const entries = (await fs.readFile(`${procRoot}/${pid}/environ`, 'utf8')).split('\0');
      const value = key => entries.find(item => item.startsWith(`${key}=`))?.slice(key.length + 1);
      return { runToken: value('AUN_RUN_TOKEN'), profilePath: value('AUN_PROFILE_DIR') };
    } catch { return null; }
  }
  // Returns only the named variables. Chrome helpers are non-dumpable, so a refusal returns null and never authorizes anything.
  async function inspectEnv(pid, names) {
    try {
      const entries = (await fs.readFile(`${procRoot}/${pid}/environ`, 'utf8')).split('\0');
      return Object.fromEntries(names.map(name => [name, entries.find(item => item.startsWith(`${name}=`))?.slice(name.length + 1)]).filter(([, value]) => value !== undefined));
    } catch { return null; }
  }
  return { platform: 'linux', inspect, inspectToken, inspectEnv, signal, async list() {
    const rows = (await Promise.all((await fs.readdir(procRoot)).filter(name => /^\d+$/.test(name)).map(name => inspect(Number(name))))).filter(Boolean);
    const live = new Set(rows.map(row => row.pid)); for (const pid of samples.keys()) if (!live.has(pid)) samples.delete(pid);
    return rows;
  } };
}
