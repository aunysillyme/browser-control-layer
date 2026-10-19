import { basename, dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { inspect, owns, leaseProof, verifyProfilePath } from '../proc/owns.mjs';
import { signalOwned, signalLeasedSurvivors, verifiedGroup } from '../proc/signals.mjs';
import { processTable } from '../proc/table.mjs';
import { PROFILE, isUserProfile, samePath } from './profiles.mjs';
import { matchRecipe } from './recipes.mjs';
import { closeRemote } from './remote.mjs';
import { idleStatus, localIdleSeconds } from './idle.mjs';
import { budgetStatus } from './budget.mjs';
import defaults from './defaults.json' with { type: 'json' };

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const atTime = now => typeof now === 'function' ? now() : now;

export async function removeThrowaway(record, options) {
  const { ledger, processAdapter, profileOptions = {} } = options;
  if (record.profileClass !== PROFILE.THROWAWAY || isUserProfile(record.userDataDir, profileOptions)) return { removed: false, reason: 'profile-kept' };
  if (await inspect(processAdapter, record.pid)) return { removed: false, reason: 'process-present' };
  const table = await processTable(processAdapter);
  if (!table.verified || table.rows.some(row => row.pgid == null || row.pgid === record.pgid || row.argv?.some(arg => arg.includes(record.userDataDir)))) return { removed: false, reason: 'profile-use-unverified' };
  const proven = record.kind === 'leased' ? await leaseProof(record, options) : Boolean(matchRecipe({ ...record, readable: true, argv: record.argv }, options));
  if (!proven || !(await verifyProfilePath(record, options))) return { removed: false, reason: 'profile-unverified' };
  const parent = dirname(record.userDataDir);
  const realParent = await ledger.fs.realpath(parent);
  if (!samePath(parent, realParent)) return { removed: false, reason: 'profile-parent-unverified' };
  const before = await ledger.fs.lstat(record.userDataDir);
  const quarantine = join(parent, `.${basename(record.userDataDir)}.aun-close-${randomBytes(6).toString('hex')}`);
  // Move the exact directory out of the launch path, then verify its inode again.
  await ledger.fs.rename(record.userDataDir, quarantine);
  const moved = await ledger.fs.lstat(quarantine);
  if (!moved.isDirectory() || moved.isSymbolicLink() || moved.ino !== before.ino || moved.dev !== before.dev) return { removed: false, reason: 'profile-changed', quarantine };
  const fresh = await processTable(processAdapter);
  if (!fresh.verified || fresh.rows.some(row => row.pgid == null || row.pgid === record.pgid || row.argv?.some(arg => arg.includes(record.userDataDir)))) return { removed: false, reason: 'profile-use-changed', quarantine };
  await ledger.fs.rm(quarantine, { recursive: true, force: false });
  return { removed: true };
}

async function eligible(record, options, table) {
  const { mode, idleSeconds, now } = options;
  if (mode === 'cleanup') return true;
  if (mode === 'idle') return idleStatus(record, { now: atTime(now), idleSeconds }).idle;
  if (mode === 'budget') {
    const rows = table.rows.filter(row => record.kind === 'leased' ? row.pgid === record.pgid : row.pid === record.pid);
    return budgetStatus(rows, record.budgets, record.cpuHistory, atTime(now)).exceeded;
  }
  const ownerPid = record.kind === 'recipe' ? record.parentPid : record.hostPid;
  const ownerStart = record.kind === 'recipe' ? record.parentStartTime : record.hostStartTime;
  if (!Number.isInteger(ownerPid)) return false;
  const host = await inspect(options.processAdapter, ownerPid);
  return !host || (host.readable && ownerStart != null && String(host.startTime) !== String(ownerStart));
}

export async function cleanup(input) {
  const options = { now: Date.now, mode: 'cleanup', apply: false, idleSeconds: localIdleSeconds, ...input };
  const { ledger, processAdapter, sessionKey, apply, mode, now } = options;
  const initial = await processTable(processAdapter);
  const records = (await ledger.list()).filter(row => (!sessionKey || row.sessionKey === sessionKey) && (!options.runId || row.id === options.runId));
  const result = { apply, mode, browsers: { closed: 0, owned: 0 }, tabs: { closed: 0, owned: records.reduce((n, row) => n + (row.tabsCreated?.length || 0), 0) }, sessions: { closed: 0, owned: records.reduce((n, row) => n + (row.remoteSessionIds?.length || 0), 0) }, remaining: 0, checks: { ps: initial.verified, tabs: false, api: false }, actions: [], warnings: [], verified: initial.verified };
  for (const record of records) {
    if (record.kind === 'remote') {
      if (apply && options.allowRemote !== false && await eligible(record, options, initial)) {
        const remote = await closeRemote(record, options);
        result.checks.api = result.actions.some(row => row.remote) ? result.checks.api && remote.verified : remote.verified;
        result.sessions.closed += remote.closed.length;
        result.remaining += remote.remaining.length;
        result.actions.push({ id: record.id, remote });
        if (remote.verified) await ledger.update(record.id, old => ({ ...old, remoteSessionIds: remote.remaining }));
      } else result.remaining += record.remoteSessionIds?.length || 0;
      continue;
    }
    const proof = await owns(record, options);
    if (proof.owned) result.browsers.owned++;
    const shouldClose = await eligible(record, options, initial);
    if (!apply || !shouldClose) { if (!proof.gone) result.remaining++; result.actions.push({ id: record.id, eligible: shouldClose, owned: proof.owned, reason: proof.reason }); continue; }
    if (!initial.verified) { result.remaining++; result.warnings.push('UNVERIFIED: process inventory'); continue; }
    const action = { id: record.id, profileClass: record.profileClass };
    if (proof.owned) {
      const members = record.kind === 'leased' ? await verifiedGroup(record, options) : [];
      if (members) { record.members = members; await ledger.update(record.id, old => ({ ...old, members })); }
      action.signal = await signalOwned(record, { ...options, group: record.kind === 'leased', signal: 'SIGTERM' });
      const grace = options.termGraceMs ?? defaults.termGraceMs.value;
      if (action.signal.sent && Number.isFinite(grace) && grace >= 0) await (options.sleep || sleep)(grace);
      const after = await inspect(processAdapter, record.pid);
      if (after && record.kind === 'leased' && Number.isFinite(grace) && grace >= 0) action.escalation = await signalOwned(record, { ...options, group: true, signal: 'SIGKILL' });
    } else if (proof.gone && record.kind === 'leased') action.survivors = await signalLeasedSurvivors(record, options);
    const after = await inspect(processAdapter, record.pid);
    const final = await processTable(processAdapter);
    const groupRemaining = record.kind === 'leased' && final.rows.some(row => row.pgid === record.pgid);
    if (!after && final.verified && !groupRemaining) {
      if (proof.owned) result.browsers.closed++;
      action.profile = await removeThrowaway(record, options);
      action.closed = true;
      await ledger.update(record.id, old => ({ ...old, closedAt: atTime(now), status: 'closed', profileRemoved: action.profile.removed }));
      if (mode === 'idle') await ledger.updateSession(record.sessionKey, old => ({ ...old, idleNotice: { closedAt: atTime(now), idleSeconds: idleStatus(record, { now: atTime(now) }).idleSeconds, temporaryStateGone: action.profile.removed } }));
    } else { result.remaining++; action.reason = after?.readable === false || !final.verified ? 'UNVERIFIED' : 'process-remains'; }
    result.actions.push(action);
  }
  if (options.probeTabs) {
    try { const tabs = await options.probeTabs(records); result.checks.tabs = tabs.verified === true; if (tabs.verified) result.tabs.closed = result.tabs.owned - tabs.remaining; }
    catch { result.checks.tabs = false; }
  }
  if (!result.checks.ps || records.some(row => row.tabsCreated?.length) && !result.checks.tabs || records.some(row => row.remoteSessionIds?.length) && !result.checks.api) result.verified = false;
  result.exitCode = apply && (result.remaining > 0 || !result.verified) ? 3 : 0;
  result.line = cleanupLine(result);
  return result;
}

export function cleanupLine(result) {
  const count = (value, checked) => `${checked ? value.closed : 'UNVERIFIED'}/${value.owned}`;
  const checks = Object.entries(result.checks).filter(([, ok]) => ok).map(([key]) => key).join('|') || 'UNVERIFIED';
  return `cleanup: browsers=${count(result.browsers, result.checks.ps)} tabs=${count(result.tabs, result.checks.tabs)} sessions=${count(result.sessions, result.checks.api)} remaining=${result.verified ? result.remaining : 'UNVERIFIED'} checks=${checks}`;
}
