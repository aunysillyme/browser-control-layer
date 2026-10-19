import { spawn as spawnProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { sameIdentity, inspect } from '../proc/owns.mjs';
import { processAdapter as makeAdapter } from '../proc/table.mjs';
import { createLedger } from './ledger.mjs';
import { localIdleSeconds } from './idle.mjs';
import { reap } from './reap.mjs';

const script = fileURLToPath(import.meta.url);
const hasTimerArgs = (current, token) => current?.argv?.includes(script) && current.argv.includes(token) || current?.command?.includes(script) && current.command.split(/\s+/).includes(token);
const timerMatches = (timer, current) => sameIdentity(timer, current) && hasTimerArgs(current, timer.token);

export async function cancelIdleTimer({ ledger, sessionKey, processAdapter }) {
  const session = await ledger.readSession(sessionKey);
  const timer = session?.timer;
  if (!timer) return { cancelled: false, reason: 'timer-absent' };
  if (timer.pending) return { cancelled: false, reason: 'timer-starting' };
  const current = await inspect(processAdapter, timer.pid);
  if (!current) { await ledger.updateSession(sessionKey, old => ({ ...old, timer: null })); return { cancelled: true, gone: true }; }
  if (!timerMatches(timer, current)) return { cancelled: false, reason: 'timer-identity-unverified' };
  const fresh = await inspect(processAdapter, timer.pid);
  if (!timerMatches(timer, fresh)) return { cancelled: false, reason: 'timer-identity-changed' };
  await processAdapter.signal(timer.pid, 'SIGTERM');
  await ledger.updateSession(sessionKey, old => old?.timer?.token === timer.token ? { ...old, timer: null } : old);
  return { cancelled: true };
}

export async function startIdleTimer({ ledger, sessionKey, processAdapter, idleSeconds = localIdleSeconds, spawn = spawnProcess, now = Date.now, termGraceMs } = {}) {
  if (!Number.isFinite(idleSeconds) || idleSeconds < 0) throw new Error('IDLE_LIMIT: provide a nonnegative duration');
  const at = typeof now === 'function' ? now() : now;
  const token = randomBytes(16).toString('hex');
  let reserved = false;
  let session;
  await ledger.updateSession(sessionKey, async old => {
    session = { ...old, sessionKey, lastActivity: Number.isFinite(old?.lastActivity) ? old.lastActivity : at, generation: Number.isInteger(old?.generation) ? old.generation : 0 };
    if (session.timer) {
      if (session.timer.pending || !session.timer.pid || await inspect(processAdapter, session.timer.pid)) return session;
    }
    reserved = true;
    return { ...session, timer: { token, pending: true, deadline: session.lastActivity + idleSeconds * 1000 } };
  });
  if (!reserved) return { started: false, reason: 'timer-exists' };
  const args = [script, '--run', ledger.root, sessionKey, token, String(session.generation || 0), String(session.lastActivity + idleSeconds * 1000), String(termGraceMs ?? ''), String(idleSeconds)];
  let child;
  try {
    child = spawn(process.execPath, args, { detached: true, stdio: 'ignore' });
    await new Promise((resolve, reject) => { if (child.pid) resolve(); else { child.once('spawn', resolve); child.once('error', reject); } });
    child.unref();
    await ledger.updateSession(sessionKey, old => old?.timer?.token === token ? { ...old, timer: { ...old.timer, pid: child.pid, deadline: session.lastActivity + idleSeconds * 1000 } } : old);
    const row = await inspect(processAdapter, child.pid);
    if (!row?.readable || !hasTimerArgs(row, token)) return { started: false, reason: 'timer-identity-unverified' };
    await ledger.updateSession(sessionKey, old => old?.timer?.token === token ? { ...old, timer: { ...row, token, pending: false, deadline: session.lastActivity + idleSeconds * 1000 } } : old);
    const currentSession = await ledger.readSession(sessionKey);
    if (currentSession?.generation !== (session.generation || 0)) {
      await cancelIdleTimer({ ledger, sessionKey, processAdapter });
      return { started: false, reason: 'activity-renewed' };
    }
    return { started: true, pid: child.pid, token };
  } catch (error) {
    await ledger.updateSession(sessionKey, old => old?.timer?.token === token ? { ...old, timer: null } : old);
    throw error;
  }
}

export async function runIdleTimer({ ledger, sessionKey, token, generation, deadline, processAdapter, now = Date.now, wait = ms => new Promise(resolve => setTimeout(resolve, ms)), termGraceMs, idleSeconds = localIdleSeconds, reapFn = reap }) {
  try {
    await wait(Math.max(0, deadline - now()));
    const session = await ledger.readSession(sessionKey);
    if (session?.generation !== generation || session?.timer?.token !== token) return { fired: false, reason: 'activity-renewed' };
    const result = await reapFn({ ledger, sessionKey, processAdapter, mode: 'idle', now, allowRemote: false, termGraceMs, idleSeconds });
    return { fired: true, result };
  } finally {
    await ledger.updateSession(sessionKey, old => old?.timer?.token === token ? { ...old, timer: null } : old);
  }
}

if (process.argv[1] === script && process.argv[2] === '--run') {
  const [, , , root, sessionKey, token, generation, deadline, grace, idleSeconds] = process.argv;
  await runIdleTimer({ ledger: createLedger({ root }), processAdapter: makeAdapter(), sessionKey, token, generation: Number(generation), deadline: Number(deadline), idleSeconds: Number(idleSeconds), ...(grace ? { termGraceMs: Number(grace) } : {}) }).catch(() => { process.exitCode = 3; });
}
