import test from 'node:test';
import assert from 'node:assert/strict';
import { leasedFixture, processRow } from './fixtures/hygiene/fakes.mjs';
import { stampActivity } from '../src/hygiene/ledger.mjs';
import { discoverRuns } from '../src/hygiene/sweep.mjs';
import { cleanup } from '../src/hygiene/cleanup.mjs';
import { owns } from '../src/proc/owns.mjs';
import { browserTool } from '../src/hooks/_event.mjs';
import { stamp } from '../src/hooks/stamp.mjs';
import { RECIPES } from '../src/hygiene/recipes.mjs';

const path = '/state/driver-profile';
const recipes = [{ id: 'fx', version: '1', executables: ['chrome'], automationFlags: [], profileClass: 'throwaway', matchesProfile: value => value === path, daemon: { executable: name => name === 'fx-daemon', sessionEnv: 'FX_SESSION', passEnv: ['FX_SOCKET'], closeArgs: session => ['--session', session, 'close'] } }];

// Host 50 (from the fixture), a daemon outside the host's ancestry, and its browser.
async function daemonFixture({ stamped = 's1', daemonSession = 's1' } = {}) {
  const f = await leasedFixture();
  await f.fs.mkdir(path, { mode: 0o700 });
  f.processAdapter.state.set(200, processRow(200, { ppid: 1, executable: '/bin/fx-daemon', argv: ['/bin/fx-daemon'] }));
  f.processAdapter.state.set(300, processRow(300, { ppid: 200, argv: ['/test/chrome', `--user-data-dir=${path}`] }));
  if (daemonSession) f.processAdapter.env.set(200, { FX_SESSION: daemonSession, FX_SOCKET: '/sockets' });
  await stampActivity({ ...f, sessionKey: 'sk', hostPid: 50, hostStartTime: 'start-50', driverId: 'fx', driverVersion: '1', driverSession: stamped });
  const discovery = await discoverRuns({ ...f, sessionKey: 'sk', recipes });
  return { f, discovery, record: discovery.discovered[0] };
}

test('RED foreign or absent session attributes nothing; GREEN the stamped session is attributed to the daemon', async () => {
  const green = await daemonFixture();
  assert.equal(green.discovery.discovered.length, 1);
  assert.deepEqual({ pid: green.record.daemon.pid, session: green.record.daemon.session, host: green.record.hostPid }, { pid: 200, session: 's1', host: 50 });
  assert.equal((await daemonFixture({ stamped: 'other' })).discovery.discovered.length, 0);
  assert.equal((await daemonFixture({ stamped: null })).discovery.discovered.length, 0);
  assert.equal((await daemonFixture({ daemonSession: null })).discovery.discovered.length, 0);
});

test('RED a live host means the daemon browser is not an orphan; GREEN host gone makes it owned', async () => {
  const { f, record } = await daemonFixture();
  const options = { ...f, recipes, mode: 'orphans' };
  assert.equal((await owns(record, options)).reason, 'owner-active');
  f.processAdapter.state.delete(50);
  const proof = await owns(record, options);
  assert.equal(proof.owned, true);
  assert.equal(proof.class, 'daemon-orphan');
});

test('RED a changed session, a missing environment or a replaced daemon refuses ownership', async () => {
  for (const [label, change, reason] of [
    ['foreign session', f => f.processAdapter.env.set(200, { FX_SESSION: 'other' }), 'session-mismatch'],
    ['missing environment', f => f.processAdapter.env.delete(200), 'session-unverified'],
    ['replaced daemon', f => { f.processAdapter.state.get(200).startTime = 'reused'; }, 'parent-unverified']
  ]) {
    const { f, record } = await daemonFixture();
    f.processAdapter.state.delete(50);
    change(f);
    const proof = await owns(record, { ...f, recipes, mode: 'orphans' });
    assert.equal(proof.owned, false, label);
    assert.equal(proof.reason, reason, label);
  }
});

test('cleanup signals the browser root first, then runs the driver close for the stamped session', async () => {
  const { f, record } = await daemonFixture();
  const order = [];
  const original = f.processAdapter.signal;
  f.processAdapter.signal = async (pid, signal) => { order.push(`signal:${pid}:${signal}`); return original(pid, signal); };
  f.processAdapter.state.delete(50);
  const runDriverClose = async (file, args, options) => { order.push(`close:${file}:${args.join(' ')}`); assert.equal(options.env.FX_SESSION, 's1'); assert.equal(options.env.FX_SOCKET, '/sockets'); f.processAdapter.state.delete(200); };
  const result = await cleanup({ ...f, recipes, mode: 'orphans', apply: true, sessionKey: 'sk', termGraceMs: 0, sleep: async () => {}, runDriverClose });
  assert.deepEqual(order, ['signal:300:SIGTERM', 'close:/bin/fx-daemon:--session s1 close']);
  assert.equal(result.actions[0].driverClose.daemonGone, true);
  assert.equal(result.remaining, 0);
});

test('RED a live host or a foreign session gets neither a signal nor a close; GREEN control above', async () => {
  const alive = await daemonFixture();
  let closed = 0;
  const runDriverClose = async () => { closed++; };
  await cleanup({ ...alive.f, recipes, mode: 'orphans', apply: true, sessionKey: 'sk', termGraceMs: 0, sleep: async () => {}, runDriverClose });
  assert.deepEqual([alive.f.processAdapter.signals.length, closed], [0, 0]);
  const foreign = await daemonFixture();
  foreign.f.processAdapter.state.delete(50);
  foreign.f.processAdapter.env.set(200, { FX_SESSION: 'someone-else' });
  await cleanup({ ...foreign.f, recipes, mode: 'orphans', apply: true, sessionKey: 'sk', termGraceMs: 0, sleep: async () => {}, runDriverClose });
  assert.deepEqual([foreign.f.processAdapter.signals.length, closed], [0, 0]);
});

test('hooks record the session from --session, the equals form or the environment, only for daemon drivers', async () => {
  const bash = command => browserTool({ tool: 'Bash', input: { command } });
  assert.equal(bash('agent-browser --session abc open https://example.com').session, 'abc');
  assert.equal(bash('agent-browser --session=xyz open https://example.com').session, 'xyz');
  assert.equal(bash('agent-browser open https://example.com').session, undefined);
  const recorded = async (tool, env) => {
    let value;
    await stamp({ sessionKey: 'event' }, tool, { ...(await leasedFixture()), hostPid: 50, env, stampActivity: async input => { value = input; }, discoverRuns: async () => ({ discovered: [] }) });
    return value.driverSession;
  };
  assert.equal(await recorded({ driverId: 'agent-browser', session: 'cli' }, { AGENT_BROWSER_SESSION: 'env' }), 'cli');
  assert.equal(await recorded({ driverId: 'agent-browser' }, { AGENT_BROWSER_SESSION: 'env' }), 'env');
  assert.equal(await recorded({ driverId: 'agent-browser' }, {}), undefined);
  assert.equal(await recorded({ driverId: 'playwright-mcp', session: 'cli' }, { AGENT_BROWSER_SESSION: 'env' }), undefined);
  assert.ok(RECIPES.find(recipe => recipe.id === 'agent-browser').daemon);
});

test('stamps accumulate the session names a host used', async () => {
  const f = await leasedFixture();
  for (const driverSession of ['a', 'b', 'a', undefined]) await stampActivity({ ...f, sessionKey: 'sk', hostPid: 50, hostStartTime: 'start-50', driverId: 'fx', driverVersion: '1', driverSession });
  assert.deepEqual((await f.ledger.readSession('sk')).stamps['50:fx'].driverSessions, ['a', 'b']);
});
