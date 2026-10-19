import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);

export function parseWindowsInventory(text) {
  const value = JSON.parse(text);
  return (Array.isArray(value) ? value : value ? [value] : []).map(row => {
    const command = typeof row.CommandLine === 'string' ? row.CommandLine : '';
    const balanced = (command.match(/"/g) || []).length % 2 === 0;
    const argv = balanced ? (command.match(/(?:[^\s"]+|"[^"]*")+/g) || []).map(arg => arg.replaceAll('"', '')) : [];
    return { pid: Number(row.ProcessId), ppid: Number(row.ParentProcessId), pgid: null, startTime: row.CreationDate, executable: row.ExecutablePath, argv, uid: null, rssBytes: Number(row.WorkingSetSize), cpuPercent: null, readable: Boolean(row.ExecutablePath && row.CreationDate && argv.length), reason: 'WINDOWS_READ_ONLY' };
  });
}

// Inspection is available on Windows. Signaling awaits a verified job-object
// implementation so a process-group guess cannot terminate another browser.
export function win32Adapter({ inventory, run = exec } = {}) {
  const list = inventory || (async () => {
    const script = 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CreationDate,ExecutablePath,CommandLine,WorkingSetSize | ConvertTo-Json -Compress';
    const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 1500, maxBuffer: 8 * 1024 * 1024, windowsHide: true });
    return parseWindowsInventory(stdout);
  });
  return { platform: 'win32', list, async inspect(pid) { return (await list()).find(row => row.pid === pid) || null; }, async inspectToken() { return null; }, signal() { throw new Error('PLATFORM_UNVERIFIED: process control requires a verified adapter'); } };
}
