import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanup } from '../src/hygiene/cleanup.mjs';
import { darwinAdapter, parseProcessTable } from '../src/proc/platform/darwin.mjs';
import { signalOwned } from '../src/proc/signals.mjs';
import { leasedFixture, processRow } from './fixtures/hygiene/fakes.mjs';

const start = 'Mon Oct 19 17:36:22 2026';
const executable = '/fixture/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const line = (state, command) => `2005 1666 2005 ${start} 501 12.6 211264 ${state} ${command}`;

test('GREEN Darwin records kernel zombie state; RED a live unreadable helper still refuses the group', async () => {
  const [zombie] = parseProcessTable(line('Z', '(Google Chrome)'));
  assert.equal(zombie.state, 'Z');
  assert.equal(zombie.readable, false);
  const calls = [];
  const adapter = darwinAdapter({ run: async (_command, args) => { calls.push(args); return { stdout: line('S+', `${executable} --headless=new`) }; }, signal: () => assert.fail('real signal') });
  assert.equal((await adapter.list())[0].state, 'S');
  assert.equal((await adapter.inspect(2005)).state, 'S');
  assert.ok(calls.every(args => args.at(-1).includes('state=')));
  for (const state of ['Z', 'S']) {
    const f = await leasedFixture();
    f.processAdapter.platform = 'darwin';
    f.processAdapter.state.set(101, processRow(101, { ppid: 100, pgid: 100, state, readable: false }));
    assert.equal((await signalOwned(f.record, { ...f, group: true })).sent, state === 'Z');
  }
});

async function fixture({ platform = 'darwin', termExit = Infinity, killExit = Infinity, helperExit = Infinity } = {}) {
  const f = await leasedFixture();
  const adapter = f.processAdapter;
  adapter.platform = platform;
  adapter.state.delete(50);
  adapter.state.set(101, processRow(101, { ppid: 100, pgid: 100 }));
  adapter.state.set(900, processRow(900, { argv: ['/test/chrome', '--user-data-dir=/user/Library/Application Support/Google/Chrome'] }));
  let elapsed = 0, killedAt = Infinity;
  const waits = [];
  adapter.signal = async (pid, signal) => {
    assert.equal(pid, -100);
    adapter.signals.push({ pid, signal });
    if (signal === 'SIGKILL') killedAt = elapsed;
  };
  const sleep = async ms => {
    waits.push(ms); elapsed += ms;
    if (elapsed >= termExit || elapsed - killedAt >= killExit) adapter.state.delete(100);
    if (elapsed >= helperExit || elapsed - killedAt >= killExit) adapter.state.delete(101);
  };
  return { ...f, sleep, waits, termGraceMs: 1000 };
}

test('GREEN Darwin observes the entire group exit within the TERM grace without escalation', async () => {
  const f = await fixture({ termExit: 200, helperExit: 400 });
  const result = await cleanup({ ...f, apply: true });
  assert.equal(result.exitCode, 0);
  assert.equal(result.actions[0].profile.removed, true);
  assert.ok(f.waits.length > 1);
  assert.deepEqual(f.processAdapter.signals, [{ pid: -100, signal: 'SIGTERM' }]);
  assert.deepEqual([...f.processAdapter.state.keys()], [900]);
});

test('GREEN Darwin H4 waits for asynchronous SIGKILL exit after the configured TERM grace', async () => {
  const f = await fixture({ killExit: 200 });
  const result = await cleanup({ ...f, apply: true });
  assert.equal(result.exitCode, 0);
  assert.equal(result.remaining, 0);
  assert.equal(result.actions[0].profile.removed, true);
  assert.deepEqual(f.processAdapter.signals, [{ pid: -100, signal: 'SIGTERM' }, { pid: -100, signal: 'SIGKILL' }]);
  assert.deepEqual([...f.processAdapter.state.keys()], [900]);
});

test('RED Darwin never reports a departed root with a live or zombie group member as closed', async () => {
  for (const state of ['S', 'Z']) {
    const f = await fixture({ termExit: 200 });
    f.processAdapter.state.get(101).state = state;
    const result = await cleanup({ ...f, apply: true });
    assert.equal(result.exitCode, 3);
    assert.equal(result.actions[0].reason, 'process-remains');
    assert.equal(f.fs.entries.has(f.record.userDataDir), true);
    assert.deepEqual(f.processAdapter.signals, [{ pid: -100, signal: 'SIGTERM' }]);
  }
});

test('RED Darwin replacement during the grace receives no escalation', async () => {
  const f = await fixture();
  f.sleep = async () => { f.processAdapter.state.get(100).startTime = 'reused'; };
  const result = await cleanup({ ...f, apply: true });
  assert.equal(result.exitCode, 3);
  assert.equal(result.actions[0].escalation.sent, false);
  assert.deepEqual(f.processAdapter.signals, [{ pid: -100, signal: 'SIGTERM' }]);
  assert.equal(f.fs.entries.has(f.record.userDataDir), true);
});

test('RED Darwin absent grace leaves asynchronous exit unverified without a force signal', async () => {
  const f = await fixture({ killExit: 200 });
  const result = await cleanup({ ...f, apply: true, termGraceMs: undefined });
  assert.equal(result.exitCode, 3);
  assert.deepEqual(f.waits, []);
  assert.deepEqual(f.processAdapter.signals, [{ pid: -100, signal: 'SIGTERM' }]);
});

test('GREEN Darwin repeated cleanup explains absent profile and lease proof after a completed close', async () => {
  const f = await leasedFixture();
  f.processAdapter.platform = 'darwin';
  const first = await cleanup({ ...f, apply: true, termGraceMs: 0 });
  assert.equal(first.actions[0].profile.removed, true);
  const second = await cleanup({ ...f, apply: true, termGraceMs: 0 });
  assert.equal(second.exitCode, 0);
  assert.equal(second.actions[0].survivors.reason, 'lease-proof-unverified');
  assert.equal(second.actions[0].profile.reason, 'profile-unverified');
  assert.deepEqual(f.processAdapter.signals, [{ pid: -100, signal: 'SIGTERM' }]);
});

test('RED Darwin a refused TERM never skips straight to KILL when the group later verifies', async () => {
  const f = await fixture();
  const list = f.processAdapter.list;
  let lists = 0;
  f.processAdapter.list = async () => {
    lists++;
    if (lists === 4) f.processAdapter.state.set(102, processRow(102, { ppid: 900, pgid: 100 }));
    if (lists === 6) f.processAdapter.state.delete(102);
    return list();
  };
  const result = await cleanup({ ...f, apply: true });
  assert.equal(result.exitCode, 3);
  assert.equal(result.actions[0].signal.sent, false);
  assert.equal(result.actions[0].signal.reason, 'group-unverified');
  assert.equal(result.actions[0].escalation, undefined);
  assert.deepEqual(f.processAdapter.signals, []);
  assert.equal(f.fs.entries.has(f.record.userDataDir), true);
});

test('Linux retains its existing single grace wait and immediate post-escalation result', async () => {
  const f = await fixture({ platform: 'linux', killExit: 200 });
  const result = await cleanup({ ...f, apply: true });
  assert.equal(result.exitCode, 3);
  assert.deepEqual(f.waits, [1000]);
  assert.deepEqual(f.processAdapter.signals, [{ pid: -100, signal: 'SIGTERM' }, { pid: -100, signal: 'SIGKILL' }]);
});
