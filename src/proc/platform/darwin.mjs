import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);

export function parseProcessTable(text) {
  return text.split('\n').filter(line => line.trim()).map(line => {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\w{3}\s+\w{3}\s+\d+\s+[\d:]+\s+\d{4})\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(.*)$/);
    if (!match) return { pid: Number(line.trim().split(/\s+/)[0]), readable: false, reason: 'PROCESS_FORMAT' };
    const [, pid, ppid, pgid, startTime, uid, cpuPercent, rssKiB, command] = match;
    // ps cannot preserve argv boundaries. The root profile flag is parsed only
    // when its absolute value has an unambiguous end at the next option.
    const profile = command.match(/(?:^|\s)--user-data-dir=(\/.*?)(?=\s--|$)/)?.[1];
    // A worker's JSON arguments can contain an app path. It is not its executable.
    const app = command.match(/^(\/[^"'{}\n]*?\.app\/Contents\/MacOS\/[^]*?)(?=\s--|$)/)?.[1];
    const node = command.match(/^(node)\s+\/[^\s"'{}]+(?=\s|$)/)?.[1];
    const executable = (app && !/\s\//.test(app) ? app : null) || command.match(/^(\/\S+)(?=\s|$)/)?.[1] || node;
    const flags = command.match(/--[\w-]+(?:=[^\s]+)?/g) || [];
    const argv = executable ? [executable, ...flags.filter(arg => !arg.startsWith('--user-data-dir'))] : [];
    // Preserve an unambiguous absolute entry script for driver ancestry. ps
    // cannot recover paths containing spaces, so those remain report-only.
    const script=executable && command.slice(executable.length).match(/^\s+(\/[^\s"'{}]+)(?=\s|$)/)?.[1];
    if (script) argv.splice(1,0,script);
    if (profile) argv.push(`--user-data-dir=${profile}`);
    return { pid: Number(pid), ppid: Number(ppid), pgid: Number(pgid), startTime, uid: Number(uid), cpuPercent: Number(cpuPercent), rssBytes: Number(rssKiB) * 1024, executable, argv, command, platform: 'darwin', identityReadable: true, readable: Boolean(executable) };
  });
}

export function darwinAdapter({ run = exec, signal = process.kill.bind(process) } = {}) {
  async function environment(pid, names) {
    if (!Number.isInteger(pid) || pid <= 0) return null;
    try {
      // -E requests the environment in both ps modes; -e selects all processes
      // in modern mode. Bind the single response to the requested PID.
      const { stdout } = await run('/bin/ps', ['-Eww', '-p', String(pid), '-o', 'pid=,command='], { timeout: 1500, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, LC_ALL: 'C' } });
      const rows = stdout.split('\n').filter(line => line.trim());
      const row = rows.length === 1 && rows[0].match(/^\s*(\d+)\s+(.*)$/);
      if (!row || Number(row[1]) !== pid) return null;
      return Object.fromEntries(names.map(name => [name, row[2].match(new RegExp(`(?:^|\\s)${name}=(.*?)(?=\\s[A-Za-z_][A-Za-z0-9_]*=|$)`))?.[1]?.trim()]).filter(([, value]) => value));
    } catch { return null; }
  }
  async function list() {
    const result = await run('/bin/ps', ['-Aww', '-o', 'pid=,ppid=,pgid=,lstart=,uid=,%cpu=,rss=,command='], { timeout: 1500, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, LC_ALL: 'C' } });
    return parseProcessTable(result.stdout);
  }
  return { platform: 'darwin', list, async inspect(pid) {
    if (!Number.isInteger(pid) || pid <= 0) return null;
    try {
      const result = await run('/bin/ps', ['-ww', '-p', String(pid), '-o', 'pid=,ppid=,pgid=,lstart=,uid=,%cpu=,rss=,command='], { timeout: 1500, maxBuffer: 1024 * 1024, env: { ...process.env, LC_ALL: 'C' } });
      const rows = parseProcessTable(result.stdout);
      if (!rows.length) return null;
      return rows.length === 1 && rows[0].pid === pid ? rows[0] : { pid, readable: false, reason: 'PROCESS_INSPECT' };
    }
    catch (error) { if (error.code === 1 && !error.stdout?.trim()) return null; return { pid, readable: false, reason: 'PROCESS_INSPECT' }; }
  }, async inspectToken(pid) {
    const env = await environment(pid, ['AUN_RUN_TOKEN', 'AUN_PROFILE_DIR']);
    return env?.AUN_RUN_TOKEN && /^[a-f0-9]+$/.test(env.AUN_RUN_TOKEN) && env.AUN_PROFILE_DIR ? { runToken: env.AUN_RUN_TOKEN, profilePath: env.AUN_PROFILE_DIR } : null;
  }, inspectEnv: environment, signal };
}
