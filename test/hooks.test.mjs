import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import fixtures from './fixtures/hooks/contracts.json' with { type: 'json' };
import { normalizeEvent, browserTool, commandWords } from '../src/hooks/_event.mjs';
import { pickCheck } from '../src/hooks/pick-check.mjs';
import { loopStop, loopLimits } from '../src/hooks/loop-stop.mjs';
import { batchReminder, batchLimits } from '../src/hooks/batch-reminder.mjs';
import { stamp, hostIdentity } from '../src/hooks/stamp.mjs';
import { closeCheck } from '../src/hooks/close-check.mjs';
import { sessionSweep, scheduleIdle } from '../src/hooks/session-sweep.mjs';
import { idleNotice } from '../src/hooks/idle-notice.mjs';
import { runHook, hookMain } from '../src/hooks/cli.mjs';

const payloads = fixtures.payloads;
const event = (name, changes = {}) => normalizeEvent({ ...structuredClone(payloads[name]), ...changes });
const deny = output => output.hookSpecificOutput?.permissionDecision === 'deny';
const context = output => output.hookSpecificOutput?.additionalContext;

function memoryLedger(records = []) {
  const sessions = new Map();
  return {
    sessions, records,
    async list() { return structuredClone(records); },
    async readSession(key) { return structuredClone(sessions.get(key) || null); },
    async updateSession(key, transform) { const value = await transform(await this.readSession(key)); sessions.set(key, structuredClone(value)); return value; },
    async update(id, transform) { const index = records.findIndex(row => row.id === id); records[index] = await transform(records[index]); return records[index]; }
  };
}
const host = { pid: 42, ppid: 1, startTime: '42-start', executable: '/fixture/claude', uid: 7, readable: true, argv: ['claude'] };
const adapter = { async inspect(pid) { return pid === 42 ? host : null; }, async list() { return [host]; }, async signal() { assert.fail('hook test sent a signal'); } };
const options = ledger => ({ ledger, processAdapter: adapter, env: {}, now: () => 1234 });
const openResult = { remaining: 1, verified: true, tabs: { owned: 1, closed: 0 }, sessions: { owned: 0, closed: 0 }, line: 'cleanup: browsers=0/1 tabs=UNVERIFIED/1 sessions=UNVERIFIED/0 remaining=UNVERIFIED checks=ps' };
const owned = (sessionKey, extra = {}) => ({ id: 'run-one', kind: 'recipe', sessionKey, pid: 88, hostPid: 42, hostStartTime: '42-start', driverId: 'playwright-mcp', lastActivity: 0, tabsCreated: ['tab-1'], ...extra });

test('synthetic hook fixtures declare pending real host capture', () => {
  assert.equal(fixtures.verification, 'HOST_TRIAL_UNVERIFIED');
  assert.match(fixtures.provenance, /^synthetic/);
  for (const payload of Object.values(payloads)) assert.equal(normalizeEvent(payload).host, 'claude-code');
});

test('event adapter RED rejects unknown events and GREEN preserves parent plus agent identity', () => {
  assert.throws(() => normalizeEvent({ hook_event_name: 'Other', session_id: 'x' }), /HOOK_EVENT/);
  assert.throws(() => normalizeEvent({ hook_event_name: 'Stop' }), /HOOK_EVENT/);
  assert.equal(event('subagent').sessionKey, event('subagentParent').sessionKey);
  assert.notEqual(event('subagent').sessionKey, event('stop').sessionKey);
  assert.equal(event('subagent').parentSessionKey, event('stop').sessionKey);
});

test('browser matchers GREEN cover known MCP and direct CLI and RED ignore unrelated tools', () => {
  assert.equal(browserTool(event('pre')).driverId, 'playwright-mcp');
  assert.equal(browserTool(event('bash')).driverId, 'agent-browser');
  assert.equal(browserTool(event('bash', { tool_input: { command: 'agent-browser --session fixture-session snapshot' } })).action, 'snapshot');
  assert.equal(browserTool(event('pre', { tool_name: 'mcp__chrome_devtools__new_page' })).driverId, 'chrome-devtools-mcp');
  for (const tool_name of ['Read', 'mcp__files__browser_read', 'mcp__playwright__server_status']) assert.equal(browserTool(event('pre', { tool_name })), null);
  for (const command of ['printf hello', 'echo agent-browser open', 'env agent-browser open', 'node agent-browser open']) assert.equal(browserTool(event('bash', { tool_input: { command } })), null);
  assert.deepEqual(commandWords('agent-browser --profile "/fixture/profile with spaces" open https://example.com'), ['agent-browser', '--profile', '/fixture/profile with spaces', 'open', 'https://example.com']);
  for (const command of ['agent-browser open x; other', 'agent-browser open $(other)', 'agent-browser open `other`', 'agent-browser open x\nother']) assert.equal(browserTool(event('bash', { tool_input: { command } })).valid, false);
});

test('unrelated tools GREEN return before any state or process access', async () => {
  const fail = () => assert.fail('unrelated tool accessed state');
  const traps = new Proxy({}, { get: fail });
  assert.deepEqual(await runHook(payloads.unrelated, { ledger: traps, processAdapter: traps, env: traps }), {});
});

test('pick guard RED refuses user browser directories on each platform without filesystem access', async () => {
  const cases = [
    ['darwin', '/fixture/account', '/fixture/account/Library/Application Support/Google/Chrome'],
    ['linux', '/fixture/account', '/fixture/account/.config/google-chrome/Default'],
    ['win32', 'C:\\fixture', 'C:\\fixture\\AppData\\Local\\Google\\Chrome\\User Data\\Default']
  ];
  for (const [platform, home, path] of cases) {
    const row = event('pre', { tool_input: { isolated: true, user_data_dir: path } });
    const ledger = memoryLedger();
    const result = await pickCheck(row, browserTool(row), { ledger, profileOptions: { platform, home, env: {} } });
    assert.equal(deny(result.output), true, platform);
    assert.equal(ledger.sessions.size, 0);
    const good = event('pre', { tool_input: { isolated: true } });
    assert.equal((await pickCheck(good, browserTool(good), { ledger, profileOptions: { platform, home, env: {} } })).allowed, true);
  }
});

test('pick guard RED rejects absent, persistent, relative, attached or conflicting profiles; GREEN allows declared throwaway', async () => {
  for (const input of [{}, { profile_class: 'driver-persistent', user_data_dir: '/fixture/profile' }, { profile_class: 'throwaway', user_data_dir: 'relative' }, { isolated: true, cdp: 'ws://example.com' }, { isolated: true, profile: '/fixture/a', user_data_dir: '/fixture/b' }]) {
    const row = event('pre', { tool_input: input });
    assert.equal((await pickCheck(row, browserTool(row), { ledger: memoryLedger() })).allowed, false);
  }
  const row = event('pre', { tool_input: { profile_class: 'throwaway', user_data_dir: '/fixture/run/profile' } });
  assert.equal((await pickCheck(row, browserTool(row), { ledger: memoryLedger() })).allowed, true);
  for (const command of ['agent-browser --cdp 9222 open x', 'agent-browser --isolated open x && printf done']) {
    const bad = event('bash', { tool_input: { command } });
    assert.equal((await pickCheck(bad, browserTool(bad), { ledger: memoryLedger() })).allowed, false);
  }
});

test('pick guard GREEN remembers launch choice and RED rejects browser, profile or driver switch', async () => {
  const ledger = memoryLedger();
  const initial = event('pre');
  assert.equal((await pickCheck(initial, browserTool(initial), { ledger })).allowed, true);
  const follow = event('pre', { tool_input: { url: 'https://example.org' } });
  assert.equal((await pickCheck(follow, browserTool(follow), { ledger })).allowed, true);
  for (const changes of [{ tool_input: { isolated: true, browser: 'firefox' } }, { tool_input: { isolated: true, user_data_dir: '/fixture/another' } }, { tool_name: 'mcp__chrome_devtools__new_page', tool_input: { isolated: true } }]) {
    const row = event('pre', changes);
    assert.equal((await pickCheck(row, browserTool(row), { ledger })).allowed, false);
  }
  assert.equal((await ledger.readSession(initial.sessionKey)).hooks.selection.browser, 'chromium');
});

test('pick guard GREEN accepts configured MCP launch choice and RED keeps explicit unsafe arguments visible', async () => {
  const row = event('pre', { tool_input: { url: 'https://example.org' } });
  const choices = { 'playwright-mcp': { isolated: true } };
  assert.equal((await pickCheck(row, browserTool(row), { ledger: memoryLedger(), choices })).allowed, true);
  const bad = event('pre', { tool_input: { profile: '/fixture/account/.config/google-chrome' } });
  assert.equal((await pickCheck(bad, browserTool(bad), { ledger: memoryLedger(), choices, profileOptions: { platform: 'linux', home: '/fixture/account', env: {} } })).allowed, false);
});

test('CLI pick guard GREEN stores a browser session and RED refuses a session switch', async () => {
  const ledger = memoryLedger();
  const first = event('bash', { tool_input: { command: 'agent-browser --isolated --session first open https://example.com' } });
  assert.equal((await pickCheck(first, browserTool(first), { ledger })).allowed, true);
  const next = event('bash', { tool_input: { command: 'agent-browser --isolated --session second snapshot' } });
  assert.equal((await pickCheck(next, browserTool(next), { ledger })).allowed, false);
});

test('retry caps remain unset until measured rows exist', () => {
  if (loopLimits.waitCap !== null) {
    assert.equal(typeof loopLimits.waitCap, 'number');
    assert.equal(loopLimits.repeatNavigateCap, null);
    assert.equal(loopLimits.emptyReadCap, null);
    assert.equal(loopLimits.identicalErrorCap, null);
  } else {
    assert.ok(Object.values(loopLimits).every(value => value === null));
  }
  assert.equal(batchLimits.streakCap, null);
});

test('wait guard RED blocks over explicit cap and GREEN resets on fresh observation', async () => {
  const ledger = memoryLedger();
  const limits = { waitCap: 1 };
  const wait = event('pre', { tool_name: 'mcp__playwright__browser_wait_for', tool_input: { tab_id: 'a' } });
  assert.deepEqual(await loopStop(wait, browserTool(wait), { ledger, limits }), {});
  assert.equal(deny(await loopStop(wait, browserTool(wait), { ledger, limits })), true);
  const read = event('post', { tool_input: { tab_id: 'a' } });
  await loopStop(read, browserTool(read), { ledger, limits });
  assert.deepEqual(await loopStop(wait, browserTool(wait), { ledger, limits }), {});
  assert.deepEqual(await loopStop({ ...wait, input: { tab_id: 'b' } }, browserTool(wait), { ledger, limits }), {});
});

test('navigation guard RED blocks repeat target and GREEN permits a different target', async () => {
  const ledger = memoryLedger();
  const row = event('pre');
  const limits = { repeatNavigateCap: 1 };
  assert.deepEqual(await loopStop(row, browserTool(row), { ledger, limits }), {});
  assert.equal(deny(await loopStop(row, browserTool(row), { ledger, limits })), true);
  assert.deepEqual(await loopStop({ ...row, input: { url: 'https://example.org' } }, browserTool(row), { ledger, limits }), {});
});

test('empty-read guard RED blocks repeated empty reads and GREEN permits a fresh page', async () => {
  const ledger = memoryLedger();
  const limits = { emptyReadCap: 1 };
  const read = event('post', { tool_response: '' });
  await loopStop(read, browserTool(read), { ledger, limits });
  const pre = { ...read, event: 'PreToolUse' };
  assert.equal(deny(await loopStop(pre, browserTool(pre), { ledger, limits })), true);
  await loopStop(event('pre'), browserTool(event('pre')), { ledger, limits });
  assert.deepEqual(await loopStop(pre, browserTool(pre), { ledger, limits }), {});
});

test('error guard RED blocks identical failing action and GREEN permits changed action', async () => {
  const ledger = memoryLedger();
  const limits = { identicalErrorCap: 1 };
  const failed = event('failure');
  await loopStop(failed, browserTool(failed), { ledger, limits });
  assert.equal(deny(await loopStop({ ...failed, event: 'PreToolUse' }, browserTool(failed), { ledger, limits })), true);
  assert.deepEqual(await loopStop({ ...failed, event: 'PreToolUse', input: { ref: 'button-2' } }, browserTool(failed), { ledger, limits }), {});
  const stored = JSON.stringify(await ledger.readSession(failed.sessionKey));
  assert.equal(stored.includes('synthetic stale reference'), false);
});

test('unset retry limits GREEN collect counters without inventing enforcement', async () => {
  const ledger = memoryLedger();
  const row = event('pre');
  for (let index = 0; index < 5; index++) assert.deepEqual(await loopStop(row, browserTool(row), { ledger }), {});
});

test('batch nudge RED identifies explicit streak and GREEN resets after batched steps', async () => {
  const ledger = memoryLedger();
  const row = event('post');
  const limits = { streakCap: 2 };
  assert.deepEqual(await batchReminder(row, browserTool(row), { ledger, limits }), {});
  assert.match(context(await batchReminder(row, browserTool(row), { ledger, limits })), /aun-batch-nudge/);
  await batchReminder({ ...row, input: { steps: ['a', 'b'] } }, browserTool(row), { ledger, limits });
  assert.deepEqual(await batchReminder(row, browserTool(row), { ledger, limits }), {});
  for (let index = 0; index < 5; index++) assert.deepEqual(await batchReminder(row, browserTool(row), { ledger }), {});
});

test('stamp GREEN keys activity by host and driver and RED leaves another host unchanged', async () => {
  const row = event('post');
  const ledger = memoryLedger([owned(row.sessionKey, { id: 'matching' }), owned(row.sessionKey, { id: 'other', hostPid: 43 })]);
  const result = await stamp(row, browserTool(row), options(ledger));
  assert.equal(result.stamped, true);
  assert.equal(ledger.records[0].lastActivity, 1234);
  assert.equal(ledger.records[1].lastActivity, 0);
  assert.equal((await ledger.readSession(row.sessionKey)).stamps['42:playwright-mcp'].hostStartTime, '42-start');
  assert.equal((await ledger.readSession(row.sessionKey)).hooks.closeBlocked, false);
});

test('stamp RED requires inspectable host identity and GREEN walks a shell ancestor', async () => {
  const row = event('post', { host_pid: undefined });
  const ledger = memoryLedger();
  const refused = { async inspect() { throw Object.assign(new Error('denied'), { code: 'EACCES' }); } };
  assert.equal((await stamp(row, browserTool(row), { ledger, processAdapter: refused, parentPid: 50 })).stamped, false);
  assert.equal(ledger.sessions.size, 0);
  const shell = { ...host, pid: 50, ppid: 42, executable: '/fixture/sh', argv: ['sh'] };
  assert.equal((await hostIdentity(row, { parentPid: 50, processAdapter: { async inspect(pid) { return pid === 50 ? shell : host; } } })).pid, 42);
});

test('post stamp GREEN discovers browser ancestry before launch parents can exit', async () => {
  const row = event('post');
  const ledger = memoryLedger();
  let discovered = false;
  await stamp(row, browserTool(row), {
    ...options(ledger),
    async discoverRuns(input) {
      assert.equal(input.allowRemote, false);
      assert.equal((await ledger.readSession(input.sessionKey)).stamps['42:playwright-mcp'].hostPid, 42);
      discovered = true;
      return { verified: true, discovered: [] };
    }
  });
  assert.equal(discovered, true);
});

test('close check RED blocks once with run resources and GREEN passes next stop', async () => {
  const row = event('stop');
  const ledger = memoryLedger([owned(row.sessionKey)]);
  const opts = { ledger, async cleanup(input) { assert.equal(input.allowRemote, false); assert.equal(input.apply, false); return openResult; } };
  const blocked = await closeCheck(row, opts);
  assert.equal(blocked.decision, 'block');
  assert.match(blocked.reason, /run=run-one browser=88 tabs=tab-1/);
  assert.deepEqual(await closeCheck(row, opts), {});
  const active = memoryLedger([owned(row.sessionKey)]);
  assert.deepEqual(await closeCheck({ ...row, stopHookActive: true }, { ...opts, ledger: active }), {});
});

test('subagent close check RED blocks its own resources and GREEN leaves parent resources alone', async () => {
  const row = event('subagent');
  const ledger = memoryLedger([owned(row.parentSessionKey)]);
  const opts = { ledger, cleanup: async () => openResult };
  assert.deepEqual(await closeCheck(row, opts), {});
  ledger.records.push(owned(row.sessionKey, { id: 'child-run' }));
  assert.equal((await closeCheck(row, opts)).decision, 'block');
});

test('lifecycle hooks GREEN sweep only local records and SessionEnd always passes', async () => {
  const ledger = memoryLedger();
  const calls = [];
  const capture = name => async input => { assert.equal(input.allowRemote, false); calls.push([name, input]); return openResult; };
  const opts = { ...options(ledger), quickSweep: capture('quick'), reap: capture('reap'), cleanup: capture('cleanup'), cancelIdleTimer: capture('cancel') };
  await sessionSweep(event('start'), opts);
  assert.equal(calls[0][0], 'reap');
  assert.equal(calls[0][1].sessionKey, undefined);
  assert.equal(calls[0][1].mode, 'orphans');
  await sessionSweep(event('prompt'), opts);
  assert.deepEqual(calls.at(-1)[1].modes, ['idle']);
  assert.deepEqual(await runHook(payloads.end, opts), {});
  assert.equal(calls.at(-1)[0], 'cleanup');
  assert.equal(calls.at(-1)[1].apply, true);
});

test('idle schedule GREEN starts only for a session with local resources; RED ignores remote and other sessions', async () => {
  const row = event('stop');
  const ledger = memoryLedger([owned('other'), owned(row.sessionKey, { id: 'remote', kind: 'remote' })]);
  let started = 0;
  const opts = { ledger, async startIdleTimer(input) { assert.equal(input.allowRemote, false); started++; return { started: true }; } };
  assert.equal((await scheduleIdle(row, opts)).started, false);
  ledger.records.push(owned(row.sessionKey));
  assert.equal((await scheduleIdle(row, opts)).started, true);
  assert.equal(started, 1);
});

test('idle notice GREEN consumes closure notice once and preserves unknown profile state', async () => {
  const row = event('pre');
  const ledger = memoryLedger();
  await ledger.updateSession(row.sessionKey, () => ({ idleNotice: { idleSeconds: 300, temporaryStateGone: true } }));
  assert.match(context(await idleNotice(row, { ledger })), /Temporary profile state is gone/);
  assert.deepEqual(await idleNotice(row, { ledger }), {});
  await ledger.updateSession(row.sessionKey, () => ({ idleNotice: { temporaryStateGone: false } }));
  assert.doesNotMatch(context(await idleNotice(row, { ledger })), /state is gone/);
});

test('hook entry contract GREEN returns host JSON and RED denies pre-event state errors without echoing payloads', async () => {
  let stdout = '', stderr = '';
  const capture = { output: { write: value => { stdout += value; } }, errorOutput: { write: value => { stderr += value; } } };
  assert.equal(await hookMain(['pre'], { ...capture, ...options(memoryLedger()), input: Readable.from([JSON.stringify(payloads.pre)]) }), 0);
  assert.deepEqual(JSON.parse(stdout), {});
  stdout = '';
  assert.equal(await hookMain(['pre'], { ...capture, input: Readable.from(['invalid raw page content']) }), 0);
  assert.equal(deny(JSON.parse(stdout)), true);
  assert.equal(stdout.includes('raw page content'), false);
  stdout = '';
  assert.equal(await hookMain(['end'], { ...capture, input: Readable.from(['invalid']) }), 0);
  assert.equal(stdout, '');
  assert.match(stderr, /UNVERIFIED/);
});

test('plugin hooks GREEN use plugin-root commands and consistent browser matchers', () => {
  const hookFile = JSON.parse(readFileSync(new URL('../hooks/hooks.json', import.meta.url), 'utf8'));
  for (const [name, entries] of Object.entries(hookFile.hooks)) {
    for (const entry of entries) {
      for (const hook of entry.hooks) assert.match(hook.command, /^node "\$\{CLAUDE_PLUGIN_ROOT\}\/src\/hooks\/cli\.mjs" /);
      if (name.includes('ToolUse')) {
        const matcher = new RegExp(entry.matcher);
        for (const fixture of ['pre', 'bash']) assert.equal(matcher.test(payloads[fixture].tool_name), true);
        assert.equal(matcher.test('Read'), false);
        assert.equal(matcher.test('mcp__files__browser_read'), false);
      }
    }
  }
  assert.match(hookFile.description, /aun-pick-guard.*aun-retry-guard.*aun-batch-nudge.*aun-cleanup/);
});

test('hook modules RED forbid network imports and GREEN delegate local cleanup with allowRemote false', () => {
  for (const file of ['cli', 'stamp', 'pick-check', 'loop-stop', 'batch-reminder', 'close-check', 'session-sweep', 'idle-notice', '_event']) {
    const source = readFileSync(new URL(`../src/hooks/${file}.mjs`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /\bfetch\s*\(|node:(?:https?|net|tls)|from ['"].*remote\.mjs/);
  }
  assert.match(readFileSync(new URL('../src/hooks/session-sweep.mjs', import.meta.url), 'utf8'), /allowRemote: false/);
});
