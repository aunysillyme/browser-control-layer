import { createHash } from 'node:crypto';
import defaults from '../hygiene/defaults.json' with { type: 'json' };
import { deny } from './_event.mjs';

export const loopLimits = Object.freeze({
  waitCap: defaults.waitCap.value,
  repeatNavigateCap: defaults.repeatNavigateCap.value,
  emptyReadCap: defaults.emptyReadCap.value,
  identicalErrorCap: defaults.identicalErrorCap.value
});
const finiteCap = value => Number.isInteger(value) && value > 0;
const digest = value => createHash('sha256').update(JSON.stringify(value) ?? '').digest('hex');
const kinds = action => ({ wait: /(?:^|_)(?:wait|wait_for)(?:$|_)/.test(action), navigate: /(?:navigate|^open$)/.test(action), read: /(?:snapshot|read|evaluate|extract|get_text)/.test(action) });

export async function loopStop(event, tool, { ledger, limits = loopLimits }) {
  if (!tool) return {};
  const kind = kinds(tool.action);
  const key = JSON.stringify([tool.driverId, String(event.input.tab_id ?? event.input.page_id ?? event.input.pageId ?? event.input.tab ?? 'default')]);
  let reason;
  await ledger.updateSession(event.sessionKey, old => {
    const counters = { ...old?.hooks?.loops?.[key] };
    if (event.event === 'PreToolUse') {
      const target = digest(event.input.url || tool.args || event.input);
      const nextWait = (counters.waits || 0) + 1;
      const nextNavigate = counters.target === target ? (counters.navigations || 0) + 1 : 1;
      if (kind.wait && finiteCap(limits.waitCap) && nextWait > limits.waitCap) reason = 'Wait cap reached; inspect the page state before retrying.';
      else if (kind.navigate && finiteCap(limits.repeatNavigateCap) && nextNavigate > limits.repeatNavigateCap) reason = 'Repeated navigation cap reached; inspect the result before retrying.';
      else if (kind.read && finiteCap(limits.emptyReadCap) && counters.emptyReads >= limits.emptyReadCap) reason = 'Empty-read cap reached; change the observation or report the missing evidence.';
      else if (finiteCap(limits.identicalErrorCap) && counters.errorCount >= limits.identicalErrorCap && counters.failedAction === digest([tool.action, event.input])) reason = 'Identical-error cap reached; change the action before retrying.';
      if (!reason) {
        if (kind.wait) counters.waits = nextWait;
        if (kind.navigate) { counters.navigations = nextNavigate; counters.target = target; counters.emptyReads = 0; }
      }
    } else {
      const error = event.error || event.response?.error || (event.response?.isError === true ? event.response : null);
      if (error) {
        const value = digest(error);
        const action = digest([tool.action, event.input]);
        counters.errorCount = counters.errorHash === value && counters.failedAction === action ? (counters.errorCount || 0) + 1 : 1;
        counters.errorHash = value;
        counters.failedAction = action;
      } else {
        counters.errorCount = 0;
        if (kind.read) {
          const response = event.response;
          const empty = response == null || response === '' || Array.isArray(response) && response.length === 0 || response?.content === '' || Array.isArray(response?.content) && response.content.length === 0;
          counters.emptyReads = empty ? (counters.emptyReads || 0) + 1 : 0;
          if (!empty) { counters.waits = 0; counters.navigations = 0; }
        }
      }
    }
    return { ...old, hooks: { ...old?.hooks, loops: { ...old?.hooks?.loops, [key]: counters } } };
  });
  return reason ? deny(event, `aun-retry-guard: ${reason}`) : {};
}
