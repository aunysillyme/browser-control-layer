import { basename } from 'node:path';
import { isUserProfile, samePath, profileArgument, PROFILE, isWithin } from '../hygiene/profiles.mjs';
import { matchRecipe } from '../hygiene/recipes.mjs';

export function sameIdentity(saved, current) {
  return Boolean(current?.readable && current.pid === saved.pid && saved.startTime != null && current.startTime != null && String(current.startTime) === String(saved.startTime) && current.executable === saved.executable && saved.uid != null && current.uid === saved.uid);
}

export async function inspect(adapter, pid) {
  try { return await adapter.inspect(pid); }
  catch (error) { return { pid, readable: false, reason: error.code || 'PROCESS_INSPECT' }; }
}

// Check only the declared path. The user's browser directories are never opened.
export async function verifyProfilePath(record, { ledger, profileOptions = {} }) {
  if (isUserProfile(record.userDataDir, profileOptions)) return false;
  try {
    const path = await ledger.fs.realpath(record.userDataDir);
    const stat = await ledger.fs.lstat(record.userDataDir);
    return stat.isDirectory() && !stat.isSymbolicLink() && samePath(path, record.userDataDir, profileOptions.platform) && !isUserProfile(path, profileOptions);
  } catch { return false; }
}

export async function leaseProof(record, { ledger, profileOptions = {} }) {
  if (!record.runToken || !isWithin(`${ledger.root}/runs/${record.id}`, record.userDataDir, profileOptions.platform) || record.profileClass !== PROFILE.THROWAWAY) return false;
  try {
    const owner = await ledger.readOwner(record.id);
    return Boolean(owner && owner.runToken === record.runToken && owner.pid === record.pid && owner.startTime === record.startTime && owner.pgid === record.pgid && samePath(owner.userDataDir, record.userDataDir) && await verifyProfilePath(record, { ledger, profileOptions }));
  } catch { return false; }
}

// A missing environment, a different session or a replaced daemon proves nothing, so none of them authorizes a signal or a close.
export async function daemonProof(record, recipe, daemon, adapter) {
  const rule = recipe?.daemon, saved = record.daemon;
  if (!rule || !saved || saved.pid !== record.parentPid || saved.pid !== daemon?.pid || !daemon.readable || String(saved.startTime) !== String(daemon.startTime) || daemon.executable !== saved.executable || !rule.executable(basename(daemon.executable || ''))) return { ok: false, reason: 'daemon-unverified' };
  let env;
  try { env = await adapter.inspectEnv?.(daemon.pid, [rule.sessionEnv, ...rule.passEnv]); } catch { env = null; }
  if (!env?.[rule.sessionEnv]) return { ok: false, reason: 'session-unverified' };
  if (env[rule.sessionEnv] !== saved.session) return { ok: false, reason: 'session-mismatch' };
  return { ok: true, env };
}

export async function owns(record, { processAdapter, ledger, now = Date.now, idleSeconds, mode = 'orphans', recipes, versions, profileOptions = {} }) {
  const current = await inspect(processAdapter, record.pid);
  if (!current) return { owned: false, gone: true, reason: 'process-gone' };
  if (!sameIdentity(record, current)) return { owned: false, reason: 'identity-unverified' };
  if (isUserProfile(record.userDataDir, profileOptions)) return { owned: false, reason: 'user-profile' };
  const observedPath = profileArgument(current.argv);
  if (!samePath(observedPath, record.userDataDir, profileOptions.platform)) return { owned: false, reason: 'profile-mismatch' };
  if (!(await verifyProfilePath(record, { ledger, profileOptions }))) return { owned: false, reason: 'profile-unverified' };
  if (record.kind === 'leased') {
    if (!(await leaseProof(record, { ledger, profileOptions }))) return { owned: false, reason: 'owner-file-unverified' };
    let token;
    try { token = await processAdapter.inspectToken?.(record.pid); } catch { /* Inspection refusal stays unowned. */ }
    if (token?.runToken !== record.runToken || !samePath(token.profilePath, record.userDataDir) || current.pgid !== record.pgid || record.pgid !== record.pid) return { owned: false, reason: 'lease-proof-unverified' };
    return { owned: true, class: 'leased', current, profileClass: PROFILE.THROWAWAY, path: observedPath };
  }
  const recipe = matchRecipe(current, { recipes, versions: versions || { [record.driverId]: record.driverVersion } });
  if (!recipe || record.driverId !== recipe.id || record.driverVersion !== recipe.version || record.profileClass !== recipe.profileClass) return { owned: false, reason: 'recipe-unverified' };
  const parent = await inspect(processAdapter, record.parentPid);
  if (parent && (!parent.readable || String(parent.startTime) !== String(record.parentStartTime))) return { owned: false, reason: 'parent-unverified' };
  // Daemon recipes (agent-browser): the browser's parent is a daemon that may outlive the AI host.
  // Owned only while the daemon is the recorded one AND its own environment still names the stamped session.
  // "Owner gone" means the AI host is gone; a live host leaves the browser alone (owner-active below).
  if (record.daemon && parent) {
    const proof = await daemonProof(record, recipe, parent, processAdapter);
    if (!proof.ok) return { owned: false, reason: proof.reason };
    if (mode === 'orphans' && current.ppid === record.parentPid) {
      const host = await inspect(processAdapter, record.hostPid);
      const hostGone = !host || (host.readable && record.hostStartTime != null && String(host.startTime) !== String(record.hostStartTime));
      if (hostGone) return { owned: true, class: 'daemon-orphan', current, recipe, profileClass: recipe.profileClass, path: observedPath };
    }
  }
  // Reparenting to init after the recorded launching parent exits is expected.
  if (!parent && (current.ppid === record.parentPid || current.ppid === 1)) return { owned: true, class: 'recipe-orphan', current, recipe, profileClass: recipe.profileClass, path: observedPath };
  if (current.ppid !== record.parentPid) return { owned: false, reason: 'parent-changed' };
  if (mode === 'idle' && Number.isFinite(idleSeconds) && idleSeconds >= 0 && (typeof now === 'function' ? now() : now) - record.lastActivity >= idleSeconds * 1000) return { owned: true, class: 'idle-session', current, recipe, profileClass: recipe.profileClass, path: observedPath };
  if (mode === 'cleanup' && record.sessionKey) return { owned: true, class: 'session', current, recipe, profileClass: recipe.profileClass, path: observedPath };
  if (mode === 'budget') return { owned: true, class: 'budget', current, recipe, profileClass: recipe.profileClass, path: observedPath };
  return { owned: false, reason: 'owner-active' };
}
