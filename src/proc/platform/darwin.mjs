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
    const app = command.match(/^(\/.*?\.app\/Contents\/MacOS\/[^]*?)(?=\s--|$)/)?.[1];
    const executable = app || command.match(/^(\/\S+)(?=\s|$)/)?.[1];
    const flags = command.match(/--[\w-]+(?:=[^\s]+)?/g) || [];
    const argv = executable ? [executable, ...flags.filter(arg => !arg.startsWith('--user-data-dir'))] : [];
    if (profile) argv.push(`--user-data-dir=${profile}`);
    return { pid: Number(pid), ppid: Number(ppid), pgid: Number(pgid), startTime, uid: Number(uid), cpuPercent: Number(cpuPercent), rssBytes: Number(rssKiB) * 1024, executable, argv, command, readable: Boolean(executable) };
  });
}

export function darwinAdapter({ run = exec, signal = process.kill.bind(process) } = {}) {
  async function list() {
    const result = await run('/bin/ps', ['-Aww', '-o', 'pid=,ppid=,pgid=,lstart=,uid=,%cpu=,rss=,command='], { timeout: 1500, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, LC_ALL: 'C' } });
    return parseProcessTable(result.stdout);
  }
  return { platform: 'darwin', list, async inspect(pid) {
    if (!Number.isInteger(pid) || pid <= 0) return null;
    try { const result = await run('/bin/ps', ['-ww', '-p', String(pid), '-o', 'pid=,ppid=,pgid=,lstart=,uid=,%cpu=,rss=,command='], { timeout: 1500, maxBuffer: 1024 * 1024, env: { ...process.env, LC_ALL: 'C' } }); return parseProcessTable(result.stdout)[0] || null; }
    catch (error) { if (error.code === 1 && !error.stdout?.trim()) return null; return { pid, readable: false, reason: 'PROCESS_INSPECT' }; }
  }, async inspectToken(pid) {
    if (!Number.isInteger(pid) || pid <= 0) return null;
    try {
      const { stdout } = await run('/bin/ps', ['eww', '-p', String(pid), '-o', 'command='], { timeout: 1500, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, LC_ALL: 'C' } });
      const runToken = stdout.match(/(?:^|\s)AUN_RUN_TOKEN=([a-f0-9]+)(?=\s|$)/)?.[1];
      const profilePath = stdout.match(/(?:^|\s)AUN_PROFILE_DIR=(.*?)(?=\s[A-Za-z_][A-Za-z0-9_]*=|$)/)?.[1]?.trim();
      return runToken && profilePath ? { runToken, profilePath } : null;
    } catch { return null; }
  }, signal };
}
