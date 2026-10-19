import { fileURLToPath } from 'node:url';
import { createLedger } from '../hygiene/ledger.mjs';
import { processAdapter } from '../proc/table.mjs';
import { normalizeEvent, browserTool, context, deny } from './_event.mjs';
import { pickCheck } from './pick-check.mjs';
import { loopStop } from './loop-stop.mjs';
import { batchReminder } from './batch-reminder.mjs';
import { stamp } from './stamp.mjs';
import { closeCheck } from './close-check.mjs';
import { sessionSweep, scheduleIdle } from './session-sweep.mjs';
import { idleNotice } from './idle-notice.mjs';

const eventNames = { pre: 'PreToolUse', post: 'PostToolUse', failure: 'PostToolUseFailure', stop: 'Stop', 'subagent-stop': 'SubagentStop', start: 'SessionStart', prompt: 'UserPromptSubmit', end: 'SessionEnd' };

function combine(event, outputs) {
  const blocked = outputs.find(output => output.decision === 'block' || output.hookSpecificOutput?.permissionDecision === 'deny');
  if (blocked) return blocked;
  const messages = outputs.map(output => output.hookSpecificOutput?.additionalContext || output.systemMessage).filter(Boolean);
  return context(event, messages.join('\n'));
}

export async function runHook(payload, options = {}) {
  const event = normalizeEvent(payload, { eventName: options.eventName });
  const tool = browserTool(event, options.drivers);
  if (event.event.includes('ToolUse') && !tool) return {};
  const env = options.env || process.env;
  const local = {
    ...options,
    ledger: options.ledger || createLedger(),
    processAdapter: options.processAdapter || processAdapter(),
    choices: options.choices || (env.AUN_BROWSER_CHOICES ? JSON.parse(env.AUN_BROWSER_CHOICES) : {}),
    hostPid: options.hostPid || (env.AUN_HOST_PID ? Number(env.AUN_HOST_PID) : undefined),
    allowRemote: false
  };
  if (event.event === 'PreToolUse') {
    const pick = await pickCheck(event, tool, local);
    if (!pick.allowed) return pick.output;
    const loop = await loopStop(event, tool, { ...local, limits: options.loopLimits });
    if (loop.hookSpecificOutput?.permissionDecision === 'deny') return loop;
    return idleNotice(event, local);
  }
  if (event.event === 'PostToolUse' || event.event === 'PostToolUseFailure') {
    const activity = await stamp(event, tool, local);
    await loopStop(event, tool, { ...local, limits: options.loopLimits });
    return combine(event, [
      context(event, activity.reason),
      await batchReminder(event, tool, { ...local, limits: options.batchLimits }),
      await idleNotice(event, local)
    ]);
  }
  const swept = await sessionSweep(event, local);
  if (event.event === 'SessionEnd') return {};
  const closed = await closeCheck(event, local);
  await scheduleIdle(event, local);
  return combine(event, [closed, context(event, swept?.line), await idleNotice(event, local)]);
}

export async function hookMain(argv, { input = process.stdin, output = process.stdout, errorOutput = process.stderr, ...options } = {}) {
  const eventName = eventNames[argv[0]];
  if (!eventName) { errorOutput.write('HOOK_USAGE: choose pre, post, failure, stop, subagent-stop, start, prompt or end\n'); return 2; }
  try {
    let text = '';
    for await (const chunk of input) text += chunk;
    const result = await runHook(JSON.parse(text), { ...options, eventName });
    output.write(`${JSON.stringify(result)}\n`);
    return 0;
  } catch (error) {
    // Host payloads and process errors can contain page text or credentials.
    const code = typeof error.code === 'string' && /^[A-Z_]+$/.test(error.code) ? error.code : 'HOOK_INPUT_OR_STATE';
    const message = `aun-cleanup: ${code}; browser hook state is UNVERIFIED.`;
    if (eventName === 'PreToolUse') output.write(`${JSON.stringify(deny({ event: eventName }, message))}\n`);
    else if (eventName === 'SessionEnd') errorOutput.write(`${message}\n`);
    else output.write(`${JSON.stringify(context({ event: eventName }, message))}\n`);
    return 0;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = await hookMain(process.argv.slice(2));
