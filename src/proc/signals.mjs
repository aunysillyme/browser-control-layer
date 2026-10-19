import { owns, sameIdentity, inspect, leaseProof } from './owns.mjs';
import { samePath, profileArgument, PROFILE } from '../hygiene/profiles.mjs';

// A zombie holds no memory and takes no signal; it is reaped with its parent.
// Chrome helpers can be non-dumpable, so /proc/<pid>/environ is unreadable for them. A helper
// that shows no token is accepted only when its parent chain reaches the token-verified root.
export async function verifiedGroup(record, options) {
  const { processAdapter } = options;
  let table;
  try { table = await processAdapter.list(); }
  catch { return null; }
  const initial = table.filter(row => row.pgid === record.pgid && row.state !== 'Z');
  if (!initial.length) return [];
  const observations = new Map();
  for (const member of initial) {
    const fresh = await inspect(processAdapter, member.pid);
    let token;
    try { token = await processAdapter.inspectToken?.(member.pid); } catch { /* An unreadable environment still needs ancestry proof. */ }
    observations.set(member.pid, { member, fresh, token });
  }
  // Helpers can exit during inspection. Refresh once to omit departed identities
  // and refuse new or replaced processes that a group signal would also reach.
  try { table = await processAdapter.list(); }
  catch { return null; }
  const members = table.filter(row => row.pgid === record.pgid && row.state !== 'Z');
  for (const { token } of observations.values()) if (token?.runToken && (token.runToken !== record.runToken || !samePath(token.profilePath, record.userDataDir))) return null;
  const byPid = new Map(table.map(row => [row.pid, row]));
  const root = members.find(row => row.pid === record.pid);
  const descends = member => {
    for (let at = member, hops = 0; at && hops < 64; at = byPid.get(at.ppid), hops++) if (at.ppid === record.pid) return String(root?.startTime) === String(record.startTime);
    return false;
  };
  for (const member of members) {
    const observed = observations.get(member.pid);
    if (!observed || !sameIdentity(observed.member, member)) return null;
    const { fresh, token } = observed;
    if (!sameIdentity(member, fresh) || fresh.pgid !== record.pgid) return null;
    if (!token?.runToken && (member.pid === record.pid || !descends(member))) return null;
    const path = profileArgument(fresh.argv);
    if (path && !samePath(path, record.userDataDir)) return null;
    const currentPath = profileArgument(member.argv);
    if (currentPath && !samePath(currentPath, record.userDataDir)) return null;
  }
  return members;
}

// Inspection and signal are kept adjacent. An OS PID handle would strengthen this
// boundary further; a failed inspection never authorizes a signal.
export async function signalOwned(record, options = {}) {
  const { processAdapter, signal = 'SIGTERM', group = false } = options;
  const proof = await owns(record, options);
  if (!proof.owned) return { sent: false, ...proof };
  if (!['SIGTERM', 'SIGKILL'].includes(signal)) return { sent: false, reason: 'signal-refused' };
  if ((group || signal === 'SIGKILL') && (proof.class !== 'leased' || proof.profileClass !== PROFILE.THROWAWAY)) return { sent: false, reason: 'force-refused' };
  if (group) {
    const members = await verifiedGroup(record, options);
    if (!members?.some(row => row.pid === record.pid)) return { sent: false, reason: 'group-unverified' };
  }
  const fresh = await owns(record, options);
  if (!fresh.owned) return { sent: false, ...fresh };
  try { await processAdapter.signal(group ? -record.pgid : record.pid, signal); }
  catch (error) { return { sent: false, reason: error.code || 'SIGNAL_FAILED' }; }
  return { sent: true, signal, target: group ? -record.pgid : record.pid, proof: fresh };
}

export async function signalLeasedSurvivors(record, options = {}) {
  if (record.kind !== 'leased' || !(await leaseProof(record, options))) return { sent: false, reason: 'lease-proof-unverified' };
  const members = await verifiedGroup(record, options);
  if (!members) return { sent: false, reason: 'group-unverified' };
  const sent = [];
  for (const member of members) {
    // Persisted identity prevents an unrelated reused PID from entering this set.
    const saved = record.members?.find(item => sameIdentity(item, member));
    if (!saved) return { sent: false, reason: 'member-identity-unrecorded', targets: sent };
    const token = await options.processAdapter.inspectToken?.(member.pid).catch(() => null);
    const fresh = await inspect(options.processAdapter, member.pid);
    if (token?.runToken && (token.runToken !== record.runToken || !samePath(token.profilePath, record.userDataDir))) return { sent: false, reason: 'member-identity-unverified', targets: sent };
    // The environment read may outlive this member. Never signal its replacement.
    if (!fresh || fresh.startTime != null && String(fresh.startTime) !== String(saved.startTime)) continue;
    if (!sameIdentity(saved, fresh) || fresh.pgid !== record.pgid || !(await leaseProof(record, options))) return { sent: false, reason: 'member-identity-unverified', targets: sent };
    await options.processAdapter.signal(member.pid, 'SIGTERM');
    sent.push(member.pid);
  }
  return { sent: sent.length > 0, targets: sent };
}
