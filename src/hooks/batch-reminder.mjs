import { context } from './_event.mjs';
import defaults from '../hygiene/defaults.json' with { type: 'json' };

export const batchLimits = Object.freeze({ streakCap: defaults.batchStreakCap.value, needs: defaults.batchStreakCap.needs });

export async function batchReminder(event, tool, { ledger, limits = batchLimits }) {
  if (!tool) return {};
  const batched = /batch|run_steps/.test(tool.action) || Array.isArray(event.input.steps) && event.input.steps.length > 1;
  let remind = false;
  await ledger.updateSession(event.sessionKey, old => {
    const streak = batched ? 0 : (old?.hooks?.streak || 0) + 1;
    const cap = limits.streakCap;
    remind = Number.isInteger(cap) && cap > 0 && streak === cap;
    return { ...old, hooks: { ...old?.hooks, streak } };
  });
  return context(event, remind ? 'aun-batch-nudge: Put the next predictable browser steps in one batch and return the requested fields together.' : '');
}
