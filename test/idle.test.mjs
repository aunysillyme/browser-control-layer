import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { leasedFixture, processRow } from './fixtures/hygiene/fakes.mjs';
import { startIdleTimer, cancelIdleTimer, runIdleTimer } from '../src/hygiene/idle-timer.mjs';
import { stampActivity } from '../src/hygiene/ledger.mjs';
import { consumeIdleNotice } from '../src/hygiene/idle.mjs';

const script = fileURLToPath(new URL('../src/hygiene/idle-timer.mjs', import.meta.url));
function spawner(f) {
  let count = 0;
  return { get count() { return count; }, spawn(command, args) { count++; const child = new EventEmitter(); child.pid = 200; child.unref = () => { child.unreferenced = true; }; f.processAdapter.state.set(200, processRow(200, { executable: command, argv: [command, ...args] })); return child; } };
}

test('RED duplicate timer refused; GREEN one timer per session and stamp cancels verified identity', async () => {
  const f = await leasedFixture(); const mock = spawner(f);
  const options = { ...f, sessionKey: 'session-1', spawn: mock.spawn };
  assert.equal((await startIdleTimer(options)).started, true);
  assert.equal((await startIdleTimer(options)).started, false); assert.equal(mock.count, 1);
  await stampActivity({ ...f, sessionKey: 'session-1', hostPid: 50, hostStartTime: 'start-50', driverId: 'fixture-driver' });
  assert.deepEqual(f.processAdapter.signals, [{ pid: 200, signal: 'SIGTERM' }]);
  assert.equal((await f.ledger.readSession('session-1')).timer, null);
});

test('RED reused timer pid refuses signal; GREEN old timer clears itself without clearing a replacement', async () => {
  const f = await leasedFixture(); const mock = spawner(f);
  const started = await startIdleTimer({ ...f, sessionKey: 'session-1', spawn: mock.spawn });
  f.processAdapter.state.get(200).startTime = 'reused';
  assert.equal((await cancelIdleTimer({ ...f, sessionKey: 'session-1' })).cancelled, false); assert.deepEqual(f.processAdapter.signals, []);
  await f.ledger.updateSession('session-1', old => ({ ...old, generation: 2, timer: { token: 'replacement' } }));
  const result = await runIdleTimer({ ...f, sessionKey: 'session-1', token: started.token, generation: 0, deadline: 0, wait: async () => {} });
  assert.equal(result.fired, false); assert.equal((await f.ledger.readSession('session-1')).timer.token, 'replacement');
});

test('GREEN idle timer fires once and clears itself; RED newer generation prevents reap', async () => {
  const f = await leasedFixture(); let calls = 0;
  await f.ledger.updateSession('session-1', () => ({ generation: 0, timer: { token: 'timer' }, lastActivity: 0 }));
  const options = { ...f, sessionKey: 'session-1', token: 'timer', generation: 0, deadline: 1, wait: async () => {}, reapFn: async () => { calls++; return {}; } };
  assert.equal((await runIdleTimer(options)).fired, true); assert.equal(calls, 1); assert.equal((await f.ledger.readSession('session-1')).timer, null);
  await f.ledger.updateSession('session-1', () => ({ generation: 1, timer: { token: 'timer' }, lastActivity: 0 }));
  assert.equal((await runIdleTimer(options)).fired, false); assert.equal(calls, 1);
});

test('RED timer inspection failure unrefs child and preserves bounded reservation', async () => {
  const f = await leasedFixture(); let unreferenced = false;
  const spawn = () => { const child = new EventEmitter(); child.pid = 200; child.unref = () => { unreferenced = true; }; return child; };
  const started = await startIdleTimer({ ...f, sessionKey: 'session-1', spawn });
  assert.equal(started.started, false); assert.equal(unreferenced, true);
  const timer = (await f.ledger.readSession('session-1')).timer;
  assert.equal(timer.pid, 200); assert.equal(timer.deadline, 700000);
});

test('idle notices are returned once with temporary-state status', async () => {
  const f = await leasedFixture(); const notice = { closedAt: 1, idleSeconds: 300, temporaryStateGone: true };
  await f.ledger.updateSession('session-1', () => ({ idleNotice: notice }));
  assert.deepEqual(await consumeIdleNotice({ ...f, sessionKey: 'session-1' }), notice);
  assert.equal(await consumeIdleNotice({ ...f, sessionKey: 'session-1' }), null);
});

test('RED pending reservation cannot be cleared or duplicated; GREEN finalization cancels after renewed stamp', async () => {
  const f = await leasedFixture();
  await f.ledger.updateSession('session-1', () => ({ sessionKey: 'session-1', generation: 0, lastActivity: 0, timer: { pending: true, token: 'pending', deadline: 900000 } }));
  assert.equal((await cancelIdleTimer({ ...f, sessionKey: 'session-1' })).reason, 'timer-starting');
  const mock = spawner(f);
  assert.equal((await startIdleTimer({ ...f, sessionKey: 'session-1', spawn: mock.spawn })).started, false); assert.equal(mock.count, 0);
  assert.equal((await f.ledger.readSession('session-1')).timer.token, 'pending');
});

test('timer propagates the explicit idle duration to its reap and handles session state without activity', async () => {
  const f = await leasedFixture();
  await f.ledger.updateSession('session-1', () => ({ hooks: {} }));
  const mock = spawner(f);
  const started = await startIdleTimer({ ...f, sessionKey: 'session-1', spawn: mock.spawn, idleSeconds: 2 });
  const state = await f.ledger.readSession('session-1');
  assert.equal(state.timer.deadline, 402000);
  let seen;
  await runIdleTimer({ ...f, sessionKey: 'session-1', token: started.token, generation: 0, deadline: 402000, idleSeconds: 2, wait: async () => {}, reapFn: async options => { seen = options.idleSeconds; } });
  assert.equal(seen, 2);
});
