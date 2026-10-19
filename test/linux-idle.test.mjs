import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createLedger, stampActivity } from '../src/hygiene/ledger.mjs';
import { RECIPES } from '../src/hygiene/recipes.mjs';
import { discoverRuns } from '../src/hygiene/sweep.mjs';
import { reap } from '../src/hygiene/reap.mjs';
import { startIdleTimer, runIdleTimer } from '../src/hygiene/idle-timer.mjs';
import { outcomeIssues } from '../evals/e1/matrix.mjs';
import { fakeFs, fakeProcess, processRow } from './fixtures/hygiene/fakes.mjs';

async function fixture() {
  const fs = fakeFs(), ledger = createLedger({ root: '/state', fs });
  const recipe = RECIPES.find(row => row.id === 'chrome-devtools-mcp');
  const profile = '/fixture/test-home/.cache/chrome-devtools-mcp/chrome-profile';
  await ledger.initialize();
  await fs.mkdir(profile, { recursive: true, mode: 0o700 });
  const processAdapter = fakeProcess([
    processRow(50, { ppid: 1, executable: process.execPath, argv: [process.execPath, '/fixture/worker.mjs'] }),
    processRow(200, { executable: process.execPath, argv: ['chrome-devtools-mcp'] }),
    processRow(300, { ppid: 200, argv: ['/test/chrome', '--remote-debugging-pipe', `--user-data-dir=${profile}`] }),
    processRow(900, { ppid: 1, argv: ['/test/chrome', '--user-data-dir=/user/.config/google-chrome'] })
  ]);
  const options = { ledger, processAdapter, sessionKey: 'linux-idle', now: () => 400000, profileOptions: { platform: 'linux', home: '/user', env: {} }, termGraceMs: 0, sleep: async () => {} };
  await stampActivity({ ...options, now: () => 0, hostPid: 50, hostStartTime: 'start-50', driverId: recipe.id, driverVersion: recipe.version });
  return { ...options, fs, profile };
}

// E1-36 discovered its Linux browser, then failed at "idle timer started".
// Let the overdue child run between the parent's PID write and identity read.
test('GREEN Linux E1-36 registers an overdue timer before it reaps and exits', async () => {
  const f = await fixture();
  const discovery = await discoverRuns(f);
  assert.equal(discovery.discovered.length, 1);
  let registered, running, registrationObserved = false, reapedBeforeRegistration = false;
  const ready = new Promise(resolve => { registered = resolve; });
  const updateSession = f.ledger.updateSession;
  f.ledger.updateSession = async (...args) => {
    const session = await updateSession(...args);
    if (!registrationObserved && session.timer?.pending && session.timer.pid) {
      registrationObserved = true;
      await new Promise(resolve => setImmediate(resolve));
      reapedBeforeRegistration = f.processAdapter.signals.length > 0;
      if (reapedBeforeRegistration) await running;
    }
    if (session.timer?.pending === false) registered();
    return session;
  };
  const timer = await startIdleTimer({ ...f, spawn(command, args) {
    const child = new EventEmitter(); child.pid = 400; child.unref = () => {};
    f.processAdapter.state.set(400, processRow(400, { executable: command, argv: [command, ...args] }));
    running = runIdleTimer({ ...f, token: args[4], generation: Number(args[5]), deadline: Number(args[6]), wait: async ms => { if (ms > 0) await ready; }, reapFn: options => reap({ ...f, ...options }) }).finally(() => f.processAdapter.state.delete(400));
    return child;
  } });
  assert.equal(timer.started, true, 'idle timer started');
  const fired = await running;
  assert.equal(reapedBeforeRegistration, false);
  assert.equal(fired.fired, true);
  assert.equal(fired.result.exitCode, 0);
  assert.deepEqual(f.processAdapter.signals, [{ pid: 300, signal: 'SIGTERM' }]);
  assert.equal((await f.ledger.readSession(f.sessionKey)).timer, null);
  const rows = await f.processAdapter.list();
  const owned = rows.filter(row => [300, 400].includes(row.pid));
  assert.deepEqual(outcomeIssues({ ending: 'idle', ownedProcesses: owned.length, ownedRssBytes: owned.reduce((sum, row) => sum + row.rssBytes, 0), throwawayDirectories: 0, persistentDirectoriesKept: f.fs.entries.has(f.profile), runTabs: owned.length ? null : 0, sentinelAlive: f.processAdapter.state.has(900), sentinelTabs: f.processAdapter.state.has(900) ? 2 : 0, wrongKills: 0, idleClosed: !owned.length, timerExited: !f.processAdapter.state.has(400) }), []);
});

test('RED Linux pending timer exits after bounded waits without reaping', async () => {
  const f = await fixture();
  await f.ledger.updateSession(f.sessionKey, old => ({ ...old, timer: { pending: true, token: 'fixture' } }));
  let reaps = 0;
  const waits = [];
  const result = await runIdleTimer({ ...f, token: 'fixture', generation: 1, deadline: 0, wait: async ms => { waits.push(ms); }, reapFn: async () => { reaps++; } });
  assert.deepEqual(result, { fired: false, reason: 'timer-identity-unverified' });
  assert.equal(reaps, 0);
  assert.ok(waits.length > 1 && waits.length <= 41);
  assert.ok(waits.slice(1).every(ms => ms > 0));
  assert.equal((await f.ledger.readSession(f.sessionKey)).timer, null);
  assert.deepEqual(f.processAdapter.signals, []);
});

for (const change of ['generation', 'token']) test(`RED Linux ${change} changes during timer registration prevent reap`, async () => {
  const f = await fixture();
  await f.ledger.updateSession(f.sessionKey, old => ({ ...old, timer: { pending: true, token: 'fixture' } }));
  let reaps = 0;
  const result = await runIdleTimer({ ...f, token: 'fixture', generation: 1, deadline: 0, wait: async ms => {
    if (ms > 0) await f.ledger.updateSession(f.sessionKey, old => change === 'generation' ? { ...old, generation: 2 } : { ...old, timer: { token: 'replacement' } });
  }, reapFn: async () => { reaps++; } });
  assert.deepEqual(result, { fired: false, reason: 'activity-renewed' });
  assert.equal(reaps, 0);
  assert.equal((await f.ledger.readSession(f.sessionKey)).timer?.token ?? null, change === 'token' ? 'replacement' : null);
  assert.deepEqual(f.processAdapter.signals, []);
});
