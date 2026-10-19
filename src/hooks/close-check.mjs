import { cleanup } from '../hygiene/cleanup.mjs';
import { deny } from './_event.mjs';

export async function closeCheck(event, options) {
  if (!['Stop', 'SubagentStop'].includes(event.event)) return {};
  const { ledger } = options;
  const records = (await ledger.list()).filter(row => row.sessionKey === event.sessionKey && row.status !== 'closed');
  if (!records.length) return {};
  const result = await (options.cleanup || cleanup)({ ...options, sessionKey: event.sessionKey, apply: false, allowRemote: false });
  const current = await ledger.readSession(event.sessionKey);
  if (event.stopHookActive || current?.hooks?.closeBlocked) return {};
  const open = result.remaining > 0 || result.tabs?.owned > result.tabs?.closed || result.sessions?.owned > result.sessions?.closed || !result.verified;
  if (!open) return {};
  const list = records.map(row => `run=${row.id} browser=${row.pid || 'remote'} tabs=${(row.tabsCreated || []).join(',') || 'UNVERIFIED'}`).join('\n');
  await ledger.updateSession(event.sessionKey, old => ({ ...old, hooks: { ...old?.hooks, closeBlocked: true } }));
  return deny(event, `aun-cleanup: Close the resources recorded for this run and report the checked cleanup line.\n${list}\n${result.line}`);
}
