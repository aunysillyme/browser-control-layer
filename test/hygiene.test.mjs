import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { leasedFixture, processRow, fakeFs } from './fixtures/hygiene/fakes.mjs';
import { cleanup, cleanupLine, removeThrowaway } from '../src/hygiene/cleanup.mjs';
import { reap } from '../src/hygiene/reap.mjs';
import { doctor } from '../src/hygiene/doctor.mjs';
import { top } from '../src/hygiene/top.mjs';
import { budgetStatus } from '../src/hygiene/budget.mjs';
import { headroom } from '../src/hygiene/headroom.mjs';
import { hygieneCommand } from '../src/hygiene/cli.mjs';
import { remoteDoctor, closeRemote } from '../src/hygiene/remote.mjs';
import { startLease } from '../src/hygiene/lease.mjs';
import { discoverRuns } from '../src/hygiene/sweep.mjs';
import { stampActivity } from '../src/hygiene/ledger.mjs';

const sample = () => ({ freeBytes: 100, totalBytes: 1000, load: 1, cores: 4 });

test('RED dry cleanup and doctor never mutate; GREEN apply closes owned group and deletes throwaway', async () => {
  const f = await leasedFixture(); const before = f.fs.writes.length;
  const dry = await cleanup(f); await doctor({ ...f, headroomOptions: { sample } }); await top(f);
  assert.equal(dry.apply, false); assert.equal(f.fs.writes.length, before); assert.equal(f.processAdapter.signals.length, 0);
  const applied = await cleanup({ ...f, apply: true });
  assert.equal(applied.browsers.closed, 1); assert.equal(applied.remaining, 0);
  assert.equal(applied.actions[0].profile.removed, true); assert.equal(f.fs.entries.has(f.record.userDataDir), false);
  assert.equal(f.processAdapter.state.has(50), true);
});

test('RED user sentinel survives all cleanup modes; GREEN owned lease is selected only when eligible', async () => {
  for (const mode of ['cleanup', 'idle', 'orphans', 'budget']) {
    const f = await leasedFixture({ budgets: { rssBytes: 5 } });
    const sentinel = processRow(900, { executable: '/test/chrome', pgid: 900, argv: ['/test/chrome', '--user-data-dir=/user/.config/google-chrome'] });
    f.processAdapter.state.set(900, sentinel); f.processAdapter.state.delete(50);
    await cleanup({ ...f, mode, apply: true });
    assert.equal(f.processAdapter.state.has(900), true, mode);
    assert.equal(f.processAdapter.signals.some(row => Math.abs(row.pid) === 900), false);
  }
  const active = await leasedFixture({ lastActivity: 399999, leaseRenewedAt: 399999 });
  await reap({ ...active, mode: 'idle' }); assert.equal(active.processAdapter.signals.length, 0);
});

test('RED persistent recipe rejects escalation and deletion; GREEN pinned orphan receives root TERM', async () => {
  const f = await leasedFixture();
  const record = { ...f.record, kind: 'recipe', driverId: 'fixture', driverVersion: '1', parentPid: 50, parentStartTime: 'start-50', profileClass: 'driver-persistent' };
  await f.ledger.write(record); f.processAdapter.state.delete(50); f.processAdapter.state.get(100).ppid = 1;
  const recipe = { id: 'fixture', version: '1', executables: ['chrome'], automationFlags: [], matchesProfile: path => path === record.userDataDir, profileClass: 'driver-persistent' };
  f.processAdapter.keepAlive = true;
  const alive = await cleanup({ ...f, recipes: [recipe], versions: { fixture: '1' }, apply: true, termGraceMs: 0 });
  assert.equal(alive.exitCode, 3); assert.deepEqual(f.processAdapter.signals, [{ pid: 100, signal: 'SIGTERM' }]);
  f.processAdapter.keepAlive = false;
  await cleanup({ ...f, recipes: [recipe], versions: { fixture: '1' }, apply: true });
  assert.equal(f.fs.entries.has(record.userDataDir), true);
  assert.equal((await removeThrowaway(record, f)).reason, 'profile-kept');
});

test('RED unknown recipe is report-only; GREEN exact receipt enables the recipe', async () => {
  const f = await leasedFixture(); await f.ledger.write({ ...f.record, kind: 'recipe', driverId: 'fixture', driverVersion: '1' });
  await cleanup({ ...f, apply: true }); assert.deepEqual(f.processAdapter.signals, []);
});

test('RED absent grace leaves live group reported; GREEN explicit grace allows leased escalation', async () => {
  const f = await leasedFixture(); f.processAdapter.keepAlive = true;
  const unset = await cleanup({ ...f, apply: true });
  assert.equal(unset.exitCode, 3); assert.deepEqual(f.processAdapter.signals.map(row => row.signal), ['SIGTERM']);
  f.processAdapter.signals.length = 0;
  await cleanup({ ...f, apply: true, termGraceMs: 0 });
  assert.deepEqual(f.processAdapter.signals.map(row => row.signal), ['SIGTERM', 'SIGKILL']);
});

test('RED missing probes print UNVERIFIED; GREEN tab probe verifies recorded tabs', async () => {
  const f = await leasedFixture({ tabsCreated: ['tab-1'] });
  const missing = await cleanup(f);
  assert.match(missing.line, /tabs=UNVERIFIED\/1/); assert.match(missing.line, /remaining=UNVERIFIED/);
  const checked = await cleanup({ ...f, apply: true, probeTabs: async () => ({ verified: true, remaining: 0 }) });
  assert.match(checked.line, /tabs=1\/1/); assert.equal(checked.exitCode, 0);
  assert.match(cleanupLine({ ...checked, checks: { ps: false, tabs: false, api: false }, verified: false }), /checks=UNVERIFIED/);
});

test('RED profile identity changes during removal; GREEN unchanged inode is removed', async () => {
  const f = await leasedFixture(); f.processAdapter.state.delete(100);
  f.fs.removals.length = 0;
  const rename = f.fs.rename;
  f.fs.rename = async (a, b) => { await rename(a, b); f.fs.entries.get(b).ino += 1000; };
  const result = await removeThrowaway(f.record, f);
  assert.equal(result.removed, false); assert.equal(result.reason, 'profile-changed'); assert.deepEqual(f.fs.removals, []);
});

test('RED unstated resource caps remain unset; GREEN explicit RSS and sustained CPU policies detect excess', () => {
  const rows = [processRow(1, { rssBytes: 100, cpuPercent: 80 })];
  assert.equal(budgetStatus(rows).exceeded, false);
  assert.equal(budgetStatus(rows, { rssBytes: 50 }).exceeded, true);
  assert.equal(budgetStatus(rows, { sustainedCpuPercent: 70 }).exceeded, false);
  assert.equal(budgetStatus(rows, { sustainedCpuPercent: 70, cpuWindowMs: 100 }, [{ at: 900, cpuPercent: 80 }, { at: 1000, cpuPercent: 90 }], 1000).exceeded, true);
  assert.equal(headroom({ sample }).allowed, true);
  assert.equal(headroom({ sample, minimumFreeBytes: 200 }).allowed, false);
});

test('RED remote credentials absent and unrecorded ids never close; GREEN recorded id closes and verifies', async () => {
  const f = await leasedFixture(); const remote = { id: 'remote1', kind: 'remote', sessionKey: 'session-1', lastActivity: 0, remoteSessionIds: ['owned'] }; await f.ledger.write(remote);
  const calls = []; let live = [{ id: 'owned' }, { id: 'foreign' }];
  const fetch = async (url, options) => { calls.push({ url, method: options.method }); if (options.method === 'DELETE') live = live.filter(row => row.id !== 'owned'); return { ok: true, status: 200, json: async () => ({ success: true, result: live }) }; };
  assert.equal((await remoteDoctor({ ledger: f.ledger, env: {}, fetch })).status, 'UNVERIFIED'); assert.equal(calls.length, 0);
  const options = { ledger: f.ledger, env: { CLOUDFLARE_ACCOUNT_ID: 'fixture', CLOUDFLARE_API_TOKEN: 'fixture-value' }, fetch, endpoint: 'https://fixture.invalid/sessions' };
  const listed = await remoteDoctor(options); assert.equal(listed.sessions.find(row => row.id === 'foreign').owned, false);
  const result = await closeRemote({ ...remote, remoteSessionIds: ['owned', 'foreign'] }, options);
  assert.deepEqual(result.closed, ['owned']); assert.equal(calls.filter(row => row.method === 'DELETE').length, 1); assert.equal(live[0].id, 'foreign');
});

test('remote requests abort on deadline and return UNVERIFIED', async () => {
  const f = await leasedFixture();
  const fetch = async (_url, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('timed out'), { code: 'ABORT_ERR' }))));
  const result = await remoteDoctor({ ledger: f.ledger, env: { CLOUDFLARE_ACCOUNT_ID: 'fixture', CLOUDFLARE_API_TOKEN: 'fixture-value' }, fetch, timeoutMs: 1 });
  assert.equal(result.verified, false); assert.equal(result.reason, 'ABORT_ERR');
});

test('RED invalid CLI flags rejected; GREEN doctor summary bounded and json complete', async () => {
  const f = await leasedFixture();
  assert.equal((await hygieneCommand(['cleanup', '--session'], f)).exitCode, 2);
  assert.equal((await hygieneCommand(['doctor', '--unknown'], f)).exitCode, 2);
  for (let pid = 200; pid < 230; pid++) f.processAdapter.state.set(pid, processRow(pid));
  const concise = await hygieneCommand(['doctor'], { ...f, headroomOptions: { sample } });
  const detailed = await hygieneCommand(['doctor', '--json'], { ...f, headroomOptions: { sample } });
  assert.ok(concise.output.split('\n').length <= 16); assert.equal(JSON.parse(detailed.output).rows.length, 31); assert.ok(concise.output.length < detailed.output.length);
});

test('RED lease with unproven profile refuses launch; GREEN exact placeholder records its group', async () => {
  const f = await leasedFixture(); let launches = 0;
  const spawn = (command, args, options) => { launches++; const child = new EventEmitter(); child.pid = 200; child.unref = () => {}; f.processAdapter.state.set(200, processRow(200, { executable: command, argv: [command, ...args] })); f.processAdapter.tokens.set(200, { runToken: options.env.AUN_RUN_TOKEN, profilePath: options.env.AUN_PROFILE_DIR }); return child; };
  await assert.rejects(startLease(['/test/chrome'], { ...f, sessionKey: 'new', spawn, headroomOptions: { sample } }), /LEASE_PROFILE/);
  assert.equal(launches, 0);
  const started = await startLease(['/test/chrome', '--user-data-dir={profile}'], { ...f, sessionKey: 'new', spawn, headroomOptions: { sample } });
  assert.equal(started.verified, true); assert.equal((await f.ledger.read(started.record.id)).pgid, 200);
});

test('RED launch inspection failure preserves provisional recovery evidence', async () => {
  const f = await leasedFixture();
  const spawn = () => { const child = new EventEmitter(); child.pid = 200; return child; };
  const started = await startLease(['/test/chrome', '--user-data-dir={profile}'], { ...f, sessionKey: 'new', spawn, headroomOptions: { sample } });
  assert.equal(started.verified, false); const record = await f.ledger.read(started.id);
  assert.equal(record.status, 'UNVERIFIED'); assert.equal(record.pid, 200); assert.equal((await f.ledger.readOwner(started.id)).runToken, record.runToken); assert.equal(f.processAdapter.signals.length, 0);
});

test('GREEN discovery binds pinned driver ancestry; RED another host gets no record', async () => {
  const f = await leasedFixture();
  const profile = '/tmp/fixture-profile'; await f.fs.mkdir('/tmp', { mode: 0o700 }); await f.fs.mkdir(profile, { mode: 0o700 });
  f.processAdapter.state.set(200, processRow(200, { ppid: 50, executable: '/node', argv: ['/node', '/driver/main.mjs'] }));
  f.processAdapter.state.set(300, processRow(300, { ppid: 200, argv: ['/test/chrome', `--user-data-dir=${profile}`] }));
  const recipe = { id: 'fixture', version: '1', executables: ['chrome'], automationFlags: [], matchesProfile: value => value === profile, profileClass: 'throwaway', driverExecutables: ['/node'], driverArg: value => value === '/driver/main.mjs' };
  await stampActivity({ ...f, sessionKey: 'discovery', hostPid: 51, hostStartTime: 'start-51', driverId: 'fixture', driverVersion: '1' });
  assert.equal((await discoverRuns({ ...f, sessionKey: 'discovery', recipes: [recipe], versions: { fixture: '1' } })).discovered.length, 0);
  await stampActivity({ ...f, sessionKey: 'discovery', hostPid: 50, hostStartTime: 'start-50', driverId: 'fixture', driverVersion: '1' });
  assert.equal((await discoverRuns({ ...f, sessionKey: 'discovery', recipes: [recipe], versions: { fixture: '1' } })).discovered.length, 1);
});

test('sustained CPU accepts irregular samples bracketing the complete window', () => {
  assert.equal(budgetStatus([processRow(1, { cpuPercent: 80 })], { sustainedCpuPercent: 70, cpuWindowMs: 100 }, [{ at: 890, cpuPercent: 80 }, { at: 930, cpuPercent: 90 }], 1000).exceeded, true);
  assert.equal(budgetStatus([processRow(1, { cpuPercent: 80 })], { sustainedCpuPercent: 70, cpuWindowMs: 100 }, [{ at: 930, cpuPercent: 90 }], 1000).exceeded, false);
});

test('RED metadata without explicit session stays report-only; GREEN verified env host renews exact driver', async () => {
  const { cliSweep } = await import('../src/hygiene/sweep.mjs');
  const f = await leasedFixture(); const before = f.fs.writes.length;
  assert.equal((await cliSweep({ ...f, env: {} })).reportOnly, true); assert.equal(f.fs.writes.length, before);
  await cliSweep({ ...f, modes: [], env: { AUN_SESSION_KEY: 'session-1', AUN_HOST_PID: '50', AUN_DRIVER_ID: 'fixture-driver' } });
  assert.equal((await f.ledger.read('run1')).lastActivity, 400000);
});
