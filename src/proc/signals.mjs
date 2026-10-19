import { owns, sameIdentity, inspect, leaseProof } from './owns.mjs';
import { samePath, profileArgument, PROFILE } from '../hygiene/profiles.mjs';

export async function verifiedGroup(record, options) {
  const { processAdapter } = options;
  let members;
  try { members = (await processAdapter.list()).filter(row => row.pgid === record.pgid); }
  catch { return null; }
  if (!members.length) return [];
  for (const member of members) {
    const fresh = await inspect(processAdapter, member.pid);
    let token;
    try { token = await processAdapter.inspectToken?.(member.pid); } catch { return null; }
    if (!sameIdentity(member, fresh) || token?.runToken !== record.runToken || !samePath(token.profilePath, record.userDataDir) || fresh.pgid !== record.pgid) return null;
    const path = profileArgument(fresh.argv);
    if (path && !samePath(path, record.userDataDir)) return null;
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
    const fresh = await inspect(options.processAdapter, member.pid);
    const token = await options.processAdapter.inspectToken?.(member.pid).catch(() => null);
    if (!sameIdentity(saved, fresh) || fresh.pgid !== record.pgid || token?.runToken !== record.runToken || !samePath(token.profilePath, record.userDataDir) || !(await leaseProof(record, options))) return { sent: false, reason: 'member-identity-unverified', targets: sent };
    await options.processAdapter.signal(member.pid, 'SIGTERM');
    sent.push(member.pid);
  }
  return { sent: sent.length > 0, targets: sent };
}
