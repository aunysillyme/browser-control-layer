import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { realpath } from 'node:fs/promises';
import { RECIPES } from '../../hygiene/recipes.mjs';
const exec = promisify(execFile);
const driverTitles = new Set(RECIPES.flatMap(recipe => recipe.platformDriverTitles.darwin));

export function parseProcessTable(text) {
  return text.split('\n').filter(line => line.trim()).map(line => {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\w{3}\s+\w{3}\s+\d+\s+[\d:]+\s+\d{4})\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(?:([IRUSTZ][sSEJNVWXL+<>-]*)\s+)?(.*)$/);
    if (!match) return { pid: Number(line.trim().split(/\s+/)[0]), readable: false, reason: 'PROCESS_FORMAT' };
    const [, pid, ppid, pgid, startTime, uid, cpuPercent, rssKiB, state, command] = match;
    // ps cannot preserve argv boundaries. The root profile flag is parsed only
    // when its absolute value has an unambiguous end at the next option.
    const profile = command.match(/(?:^|\s)--user-data-dir=(\/.*?)(?=\s--|$)/)?.[1];
    // A worker's JSON arguments can contain an app path. It is not its executable.
    const app = command.match(/^(\/[^"'{}\n]*?\.app\/Contents\/MacOS\/[^]*?)(?=\s--|$)/)?.[1];
    const node = command.match(/^(node)\s+(?:(?:--no-warnings|--enable-source-maps|--experimental-network-inspection|--disable-warning=[\w]+)\s+)*\/[^\s"'{}]+(?=\s|$)/)?.[1];
    const executable = (app && !/\s\//.test(app) ? app : null) || command.match(/^(\/\S+)(?=\s|$)/)?.[1] || node;
    const flags = command.match(/--[\w-]+(?:=[^\s]+)?/g) || [];
    const argv = executable ? [executable, ...flags.filter(arg => !arg.startsWith('--user-data-dir'))] : [];
    // Preserve an unambiguous absolute entry script for driver ancestry. ps
    // cannot recover paths containing spaces, so those remain report-only.
    const tail = executable && command.slice(executable.length);
    // Only non-evaluating Node switches may precede an entry script. Values of
    // eval, import or arbitrary flags are never evidence of a driver script.
    const script = tail && (/^(?:node|.*\/node)$/.test(executable)
      ? tail.match(/^\s+(?:(?:--no-warnings|--enable-source-maps|--experimental-network-inspection|--disable-warning=[\w]+)\s+)*(\/[^\s"'{}]+)(?=\s|$)/)?.[1]
      : tail.match(/^\s+(\/[^\s"'{}]+)(?=\s|$)/)?.[1]);
    if (script) argv.splice(1,0,script);
    if (profile) argv.push(`--user-data-dir=${profile}`);
    return { pid: Number(pid), ppid: Number(ppid), pgid: Number(pgid), startTime, uid: Number(uid), cpuPercent: Number(cpuPercent), rssBytes: Number(rssKiB) * 1024, ...(state ? { state: state[0] } : {}), executable, argv, entryScript: script || null, command, platform: 'darwin', identityReadable: true, readable: Boolean(executable), reason: executable ? undefined : 'PROCESS_ARGV', commandKind: /^node(?:\s|$)/.test(command) ? script ? 'node-entry' : 'node-command' : executable ? 'absolute-command' : 'unparsed-command' };
  });
}

export function darwinAdapter({ run = exec, signal = process.kill.bind(process) } = {}) {
  const columns = 'pid=,ppid=,pgid=,lstart=,uid=,%cpu=,rss=,state=,';
  const psOptions = { timeout: 1500, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, LC_ALL: 'C' } };
  const readRow = async (pid, field = 'command=') => {
    const { stdout } = await run('/bin/ps', ['-ww', '-p', String(pid), '-o', columns + field], { ...psOptions, maxBuffer: 1024 * 1024 });
    const rows = parseProcessTable(stdout);
    if (!rows.length) return null;
    return rows.length === 1 && rows[0].pid === pid ? rows[0] : { pid, readable: false, reason: 'PROCESS_INSPECT' };
  };
  const unchanged = (left, right) => right?.identityReadable && right.state !== 'Z' && ['pid', 'ppid', 'pgid', 'startTime', 'uid'].every(key => left[key] === right[key]);
  async function verifyTitle(row) {
    const title = row?.command?.trimEnd();
    if (row?.readable || !row?.identityReadable || row.state === 'Z' || !driverTitles.has(title)) return row;
    try {
      // A rewritten title hides the entry script. Require the kernel accounting
      // name and main text mapping, bound to the same identity across reads.
      const accounting = await readRow(row.pid, 'ucomm=');
      if (!unchanged(row, accounting) || accounting.command.trimEnd() !== 'node') return row;
      const { stdout } = await run('/usr/sbin/lsof', ['-nP', '-a', '-p', String(row.pid), '-d', 'txt', '-F0pfn'], psOptions);
      const fields = stdout.split('\0').map(field => field.replace(/^\n/, '')).filter(Boolean);
      if (fields[0] !== `p${row.pid}` || fields.filter(field => field.startsWith('p')).length !== 1 || fields[1] !== 'ftxt' || fields[2] !== `n${await realpath(process.execPath)}`) return row;
      const fresh = await readRow(row.pid);
      if (!unchanged(row, fresh) || fresh.command.trimEnd() !== title) return row;
      return { ...fresh, executable: process.execPath, argv: [process.execPath], processTitle: title, executableVerified: true, readable: true, reason: undefined, commandKind: 'verified-node-title' };
    } catch { return row; }
  }
  async function environment(pid, names) {
    if (!Number.isInteger(pid) || pid <= 0) return null;
    try {
      // -E requests the environment in both ps modes; -e selects all processes
      // in modern mode. Bind the single response to the requested PID.
      const { stdout } = await run('/bin/ps', ['-Eww', '-p', String(pid), '-o', 'pid=,command='], psOptions);
      const rows = stdout.split('\n').filter(line => line.trim());
      const row = rows.length === 1 && rows[0].match(/^\s*(\d+)\s+(.*)$/);
      if (!row || Number(row[1]) !== pid) return null;
      return Object.fromEntries(names.map(name => [name, row[2].match(new RegExp(`(?:^|\\s)${name}=(.*?)(?=\\s[A-Za-z_][A-Za-z0-9_]*=|$)`))?.[1]?.trim()]).filter(([, value]) => value));
    } catch { return null; }
  }
  async function list() {
    const result = await run('/bin/ps', ['-Aww', '-o', columns + 'command='], psOptions);
    const rows = parseProcessTable(result.stdout);
    for (let i = 0; i < rows.length; i++) rows[i] = await verifyTitle(rows[i]);
    return rows;
  }
  return { platform: 'darwin', list, async inspect(pid) {
    if (!Number.isInteger(pid) || pid <= 0) return null;
    try {
      return await verifyTitle(await readRow(pid));
    }
    catch (error) { if (error.code === 1 && !error.stdout?.trim()) return null; return { pid, readable: false, reason: 'PROCESS_INSPECT' }; }
  }, async inspectToken(pid) {
    const env = await environment(pid, ['AUN_RUN_TOKEN', 'AUN_PROFILE_DIR']);
    return env?.AUN_RUN_TOKEN && /^[a-f0-9]+$/.test(env.AUN_RUN_TOKEN) && env.AUN_PROFILE_DIR ? { runToken: env.AUN_RUN_TOKEN, profilePath: env.AUN_PROFILE_DIR } : null;
  }, inspectEnv: environment, signal };
}
