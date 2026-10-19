import { owns, sameIdentity, inspect, leaseProof } from './owns.mjs';
import { samePath, profileArgument, PROFILE } from '../hygiene/profiles.mjs';

// A zombie holds no memory and takes no signal; it is reaped with its parent.
// Chrome helpers can have unreadable environments. A helper
// that shows no token is accepted only when its parent chain reaches the token-verified root.
export async function verifiedGroup(record, options) {
  const { processAdapter } = options;
  const diagnostics = options.groupDiagnostics || [];
  const report = (row, verdict, reason, extra = {}) => {
    const result = { pid: row?.pid, ppid: row?.ppid, pgid: row?.pgid, state: row?.state, startTime: row?.startTime, readable: row?.readable, exe: row?.executable?.split('/').pop(), type: row?.argv?.find(arg => arg.startsWith('--type=')), verdict, reason, ...extra };
    diagnostics.push(result);
  };
  const identityReason = (saved, current) => {
    if (!current) return 'process-gone';
    if (!current.readable) return 'identity-unreadable';
    if (saved.pid !== current.pid) return 'pid-mismatch';
    if (saved.startTime == null || current.startTime == null) return 'start-time-unreadable';
    if (String(saved.startTime) !== String(current.startTime)) return 'start-time-changed';
    if (saved.executable !== current.executable) return 'executable-changed';
    if (saved.uid == null || current.uid !== saved.uid) return 'uid-changed';
    return 'identity-unverified';
  };
  let table;
  try { table = await processAdapter.list(); }
  catch (error) { report(null, 'refused', 'initial-list-failed', { error: error.code || 'PROCESS_LIST' }); return null; }
  const initial = table.filter(row => row.pgid === record.pgid && row.state !== 'Z');
  if (!initial.length) { report({ pid: record.pid, pgid: record.pgid }, 'departed', 'group-empty'); return []; }
  const observations = new Map();
  const observe = async member => {
    const fresh = await inspect(processAdapter, member.pid);
    let token;
    try { token = await processAdapter.inspectToken?.(member.pid); } catch { /* An unreadable environment still needs ancestry proof. */ }
    observations.set(member.pid, { member, fresh, token });
  };
  for (const member of initial) await observe(member);
  // Helpers can exit during inspection. Refresh once to omit departed identities
  // and refuse new or replaced processes that a group signal would also reach.
  try { table = await processAdapter.list(); }
  catch (error) {
    for (const member of initial) report(member, 'refused', 'final-list-failed', { error: error.code || 'PROCESS_LIST' });
    return null;
  }
  // macOS helpers can join while ps inspects the first snapshot. Inspect those
  // identities once, then refresh again; further arrivals remain unverified.
  const arrivals = table.filter(row => row.pgid === record.pgid && row.state !== 'Z' && !observations.has(row.pid));
  if (processAdapter.platform === 'darwin' && arrivals.length) {
    for (const member of arrivals) await observe(member);
    try { table = await processAdapter.list(); }
    catch (error) {
      for (const { member } of observations.values()) report(member, 'refused', 'final-list-failed', { error: error.code || 'PROCESS_LIST' });
      return null;
    }
  }
  const members = table.filter(row => row.pgid === record.pgid && row.state !== 'Z');
  let refused = false;
  const foreign = new Map();
  for (const { member, token } of observations.values()) {
    if (token?.runToken && (token.runToken !== record.runToken || !samePath(token.profilePath, record.userDataDir))) {
      foreign.set(member.pid, token.runToken !== record.runToken ? 'foreign-token' : 'token-profile-mismatch');
      refused = true;
    }
    if (!members.some(row => row.pid === member.pid)) report(member, foreign.has(member.pid) ? 'refused' : 'departed', foreign.get(member.pid) || 'left-group');
  }
  const byPid = new Map(table.map(row => [row.pid, row]));
  const root = members.find(row => row.pid === record.pid);
  const descends = member => {
    for (let at = member, hops = 0; at && hops < 64; at = byPid.get(at.ppid), hops++) if (at.ppid === record.pid) return String(root?.startTime) === String(record.startTime);
    return false;
  };
  for (const member of members) {
    const observed = observations.get(member.pid);
    const { fresh, token } = observed || {};
    let phase = 'initial-to-final';
    let reason = foreign.get(member.pid) || (!observed ? 'member-unobserved' : !sameIdentity(observed.member, member) ? identityReason(observed.member, member) : null);
    if (!reason) { phase = 'inspection-to-final'; if (!sameIdentity(member, fresh)) reason = identityReason(member, fresh); }
    if (!reason && fresh.pgid !== record.pgid) reason = 'group-changed';
    if (!reason && !token?.runToken && (member.pid === record.pid || !descends(member))) reason = member.pid === record.pid ? 'root-token-unverified' : 'ancestry-unverified';
    const path = profileArgument(fresh?.argv);
    if (!reason && path && !samePath(path, record.userDataDir)) reason = 'inspection-profile-mismatch';
    const currentPath = profileArgument(member.argv);
    if (!reason && currentPath && !samePath(currentPath, record.userDataDir)) reason = 'final-profile-mismatch';
    if (reason) refused = true;
    report(member, reason ? 'refused' : 'accepted', reason || (token?.runToken ? member.pid === record.pid ? 'root-token-verified' : 'helper-token-verified' : 'helper-ancestry-verified'), { phase, inspectionReason: fresh?.reason, environ: token ? 'readable' : 'unverified', tokenMatch: token?.runToken === record.runToken, profileMatch: token?.profilePath === record.userDataDir });
  }
  return refused ? null : members;
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
    const groupDiagnostics = [];
    const members = await verifiedGroup(record, { ...options, groupDiagnostics });
    if (!members?.some(row => row.pid === record.pid)) {
      if (members?.length) groupDiagnostics.push({ pid: record.pid, verdict: 'refused', reason: 'root-absent' });
      return { sent: false, reason: 'group-unverified', group: groupDiagnostics };
    }
  }
  const fresh = await owns(record, options);
  if (!fresh.owned) return { sent: false, ...fresh };
  try { await processAdapter.signal(group ? -record.pgid : record.pid, signal); }
  catch (error) { return { sent: false, reason: error.code || 'SIGNAL_FAILED' }; }
  return { sent: true, signal, target: group ? -record.pgid : record.pid, proof: fresh };
}

export async function signalLeasedSurvivors(record, options = {}) {
  if (record.kind !== 'leased' || !(await leaseProof(record, options))) return { sent: false, reason: 'lease-proof-unverified' };
  const groupDiagnostics = [];
  const members = await verifiedGroup(record, { ...options, groupDiagnostics });
  if (!members) return { sent: false, reason: 'group-unverified', group: groupDiagnostics };
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
