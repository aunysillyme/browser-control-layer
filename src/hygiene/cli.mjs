import { createLedger } from './ledger.mjs';
import { processAdapter as makeAdapter } from '../proc/table.mjs';
import { cleanup } from './cleanup.mjs';
import { doctor } from './doctor.mjs';
import { reap } from './reap.mjs';
import { top } from './top.mjs';
import { lease } from './lease.mjs';
import { cliSweep } from './sweep.mjs';

function parse(args) {
  const [command, ...rest] = args;
  const allowed = { doctor: ['--json', '--remote'], top: ['--json', '--session', '--sample-ms'], cleanup: ['--session', '--apply'], reap: ['--session', '--idle', '--orphans', '--budget', '--dry-run'], lease: ['--session'] }[command];
  if (!allowed) throw new Error('HYGIENE_COMMAND: choose doctor, cleanup, lease, reap or top');
  const flags = new Set(); let sessionKey; let sampleMs; let commandArgs;
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (command === 'lease' && arg === '--') { commandArgs = rest.slice(i + 1); break; }
    if (!allowed.includes(arg) || flags.has(arg)) throw new Error(`HYGIENE_ARGUMENT: unsupported or repeated option ${arg}`);
    flags.add(arg);
    if (arg === '--sample-ms') { sampleMs = Number(rest[++i]); if (!Number.isFinite(sampleMs) || sampleMs <= 0) throw new Error('HYGIENE_SAMPLE: --sample-ms requires a positive duration'); }
    if (arg === '--session') { sessionKey = rest[++i]; if (!sessionKey || sessionKey.startsWith('--')) throw new Error('HYGIENE_SESSION: --session requires an id'); }
  }
  return { command, flags, sessionKey, sampleMs, commandArgs };
}

function summary(command, result) {
  const rows = result.rows || result.sessions || [];
  const owned = rows.filter(row => row.owned).length;
  const lines = [`${command}: ${result.verified ? 'verified' : 'UNVERIFIED'} total=${rows.length} owned=${owned}`];
  for (const row of rows.slice(0, 12)) lines.push(`  ${row.pid ?? row.id} ${row.owned ? 'owned' : 'report-only'} ${row.reason || row.driverId || row.status || ''}`.trimEnd());
  if (result.reason) lines.push(`reason: ${result.reason}`);
  if (result.headroom) lines.push(`headroom: ${result.headroom.policy}`);
  lines.push('Full detail: repeat with --json');
  return lines.join('\n');
}

export async function hygieneCommand(args, deps = {}) {
  let parsed;
  try { parsed = parse(args); } catch (error) { return { exitCode: 2, output: error.message }; }
  const { command, flags, sessionKey, sampleMs, commandArgs } = parsed;
  const options = { ledger: createLedger(), processAdapter: makeAdapter(), ...deps, sampleMs: sampleMs ?? deps.sampleMs, sessionKey: sessionKey || deps.sessionKey || (deps.env || process.env).AUN_SESSION_KEY };
  try {
    if (command === 'doctor' || command === 'top') {
      const result = command === 'doctor' ? await doctor({ ...options, remote: flags.has('--remote') }) : await top(options);
      return { exitCode: result.verified ? 0 : 3, output: flags.has('--json') ? JSON.stringify(result, null, 2) : summary(command, result), result };
    }
    if (command === 'cleanup') { if (flags.has('--apply')) await cliSweep({ ...options, modes: [] }); const result = await cleanup({ ...options, apply: flags.has('--apply') }); return { ...result, output: result.line }; }
    if (command === 'reap') {
      const modes = ['idle', 'orphans', 'budget'].filter(mode => flags.has(`--${mode}`));
      if (modes.length !== 1) return { exitCode: 2, output: 'REAP_MODE: select one of --idle, --orphans or --budget' };
      if (!flags.has('--dry-run')) await cliSweep({ ...options, modes: [] });
      const result = await reap({ ...options, mode: modes[0], apply: !flags.has('--dry-run') });
      return { ...result, output: result.line };
    }
    if (!commandArgs?.length) return { exitCode: 2, output: 'LEASE_COMMAND: pass -- followed by a driver command and --user-data-dir={profile}' };
    await cliSweep(options);
    return lease(commandArgs, { ...options, sessionKey: options.sessionKey || `lease-${process.pid}` });
  } catch (error) { return { exitCode: 3, output: `${error.code || 'HYGIENE_FAILED'}: ${error.message}` }; }
}
