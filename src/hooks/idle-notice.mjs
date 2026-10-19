import { consumeIdleNotice } from '../hygiene/idle.mjs';
import { context } from './_event.mjs';

export async function idleNotice(event, options) {
  const notice = await (options.consumeIdleNotice || consumeIdleNotice)({ ledger: options.ledger, sessionKey: event.sessionKey });
  if (!notice) return {};
  const duration = Number.isFinite(notice.idleSeconds) ? `${Math.floor(notice.idleSeconds)} seconds` : 'the idle limit';
  const state = notice.temporaryStateGone ? 'Temporary profile state is gone; observe a new page before continuing.' : 'Check the browser state before continuing.';
  return context(event, `aun-cleanup: Browser closed after ${duration} idle. ${state}`);
}
