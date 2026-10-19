import defaults from './defaults.json' with { type: 'json' };
export const localIdleSeconds = defaults.localIdleSeconds.value;
export function idleStatus(record, { now = Date.now(), idleSeconds = localIdleSeconds } = {}) {
  const lastActivity = record.kind === 'leased' ? record.leaseRenewedAt ?? record.lastActivity : record.lastActivity;
  const idleMs = Math.max(0, now - lastActivity);
  return { idle: Number.isFinite(lastActivity) && idleMs >= idleSeconds * 1000, idleSeconds: idleMs / 1000, deadline: lastActivity + idleSeconds * 1000 };
}
export async function consumeIdleNotice({ ledger, sessionKey }) {
  const session = await ledger.readSession(sessionKey);
  if (!session?.idleNotice) return null;
  const notice = session.idleNotice;
  await ledger.updateSession(sessionKey, old => ({ ...old, idleNotice: null }));
  return notice;
}
