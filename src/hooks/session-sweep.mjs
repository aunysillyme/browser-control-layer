import { quickSweep } from '../hygiene/sweep.mjs';
import { reap } from '../hygiene/reap.mjs';
import { cleanup } from '../hygiene/cleanup.mjs';
import { startIdleTimer, cancelIdleTimer } from '../hygiene/idle-timer.mjs';

export async function sessionSweep(event, options) {
  const local = { ...options, sessionKey: event.sessionKey, allowRemote: false };
  if (event.event === 'SessionStart') {
    await (options.reap || reap)({ ...local, sessionKey: undefined, mode: 'orphans', apply: true });
    return (options.quickSweep || quickSweep)({ ...local, modes: ['idle'] });
  }
  if (event.event === 'UserPromptSubmit' || event.event === 'Stop') return (options.quickSweep || quickSweep)({ ...local, modes: ['idle'] });
  if (event.event === 'SessionEnd') {
    await (options.cancelIdleTimer || cancelIdleTimer)(local);
    return (options.cleanup || cleanup)({ ...local, apply: true });
  }
  if (event.event === 'SubagentStop') return (options.reap || reap)({ ...local, mode: 'idle', apply: true });
  return null;
}

export async function scheduleIdle(event, options) {
  if (event.event !== 'Stop' && event.event !== 'SubagentStop') return { started: false };
  const active = (await options.ledger.list()).some(row => row.sessionKey === event.sessionKey && row.status !== 'closed' && row.kind !== 'remote');
  if (!active) return { started: false, reason: 'session-empty' };
  return (options.startIdleTimer || startIdleTimer)({ ...options, sessionKey: event.sessionKey, allowRemote: false });
}
