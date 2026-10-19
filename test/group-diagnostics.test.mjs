import test from 'node:test';
import assert from 'node:assert/strict';
import { darwinAdapter } from '../src/proc/platform/darwin.mjs';
import { verifiedGroup, signalOwned } from '../src/proc/signals.mjs';
import { leasedFixture } from './fixtures/hygiene/fakes.mjs';

const app = '/Applications/Google Chrome for Testing.app/Contents';
const executable = `${app}/MacOS/Google Chrome for Testing`;
const helper = name => `${app}/Frameworks/Google Chrome for Testing Framework.framework/Helpers/Google Chrome for Testing Helper (${name}).app/Contents/MacOS/Google Chrome for Testing Helper (${name})`;
const startTime = 'Mon Oct 19 16:58:09 2026';

// Root, helper names, types and kernel ancestry match the macOS lifecycle dump.
async function fixture({ arrival = false, tokenless = false, mutate = () => {} } = {}) {
  const f = await leasedFixture({ pid: 1481, pgid: 1481, executable, startTime, uid: 501 });
  const rows = new Map([
    [1481, { pid: 1481, ppid: 1450, pgid: 1481, startTime, command: `${executable} --user-data-dir=${f.record.userDataDir} --headless=new` }],
    ...[[1490, 'gpu-process', 'Aperitif'], [1491, 'utility', 'Aperitif'], [1496, 'utility', 'Aperitif'], [1499, 'utility', 'Aperitif Alerts']].map(([pid, type, name]) => [pid, { pid, ppid: 1481, pgid: 1481, startTime, command: `${helper(name)} --type=${type}` }])
  ]);
  const signals = [], calls = [], environments = new Map();
  const lease = `AUN_RUN_TOKEN=${f.record.runToken} AUN_PROFILE_DIR=${f.record.userDataDir}`;
  for (const pid of rows.keys()) if (pid === 1481 || !tokenless) environments.set(pid, lease);
  let lists = 0;
  const line = row => `${row.pid} ${row.ppid} ${row.pgid} ${row.startTime} 501 0.2 1024 ${row.command}`;
  const processAdapter = darwinAdapter({ async run(command, args) {
    calls.push({ command, args });
    if (args[0] === '-Aww') {
      if (++lists === 2 && arrival) rows.set(1500, { pid: 1500, ppid: 1491, pgid: 1481, startTime, command: `${helper('Aperitif')} --type=utility` });
      await mutate({ rows, environments, lists, args });
      return { stdout: [...rows.values()].map(line).join('\n') };
    }
    const pid = Number(args[args.indexOf('-p') + 1]);
    await mutate({ rows, environments, lists, args, pid });
    if (!rows.has(pid)) throw Object.assign(new Error('gone'), { code: 1, stdout: '' });
    if (args[0] === '-Eww') {
      if (!environments.has(pid)) throw Object.assign(new Error('unreadable environment'), { code: 'EPERM' });
      return { stdout: `${pid} ${rows.get(pid).command} ${environments.get(pid)}` };
    }
    return { stdout: line(rows.get(pid)) };
  }, async signal(pid, signal) { signals.push({ pid, signal }); } });
  return { ...f, rows, environments, signals, calls, processAdapter, listCount: () => lists, profileOptions: { home: '/user', env: {}, platform: 'darwin' } };
}

for (const tokenless of [false, true]) test(`GREEN Darwin dump-shaped group verifies ${tokenless ? 'ancestry' : 'tokens'} with per-member reasons`, async () => {
  const f = await fixture({ tokenless });
  const groupDiagnostics = [];
  assert.deepEqual((await verifiedGroup(f.record, { ...f, groupDiagnostics })).map(row => row.pid), [1481, 1490, 1491, 1496, 1499]);
  assert.deepEqual(groupDiagnostics.map(row => row.reason), ['root-token-verified', ...Array(4).fill(tokenless ? 'helper-ancestry-verified' : 'helper-token-verified')]);
  assert.ok(groupDiagnostics.every(row => row.verdict === 'accepted'));
  assert.equal(groupDiagnostics[1].exe, 'Google Chrome for Testing Helper (Aperitif)');
  assert.equal(groupDiagnostics[4].exe, 'Google Chrome for Testing Helper (Aperitif Alerts)');
  assert.equal(groupDiagnostics[1].environ, tokenless ? 'unverified' : 'readable');
  assert.equal(JSON.stringify(groupDiagnostics).includes(f.record.runToken), false);
  assert.equal(JSON.stringify(groupDiagnostics).includes(f.record.userDataDir), false);
  assert.ok(f.calls.every(call => call.command === '/bin/ps'));
});

test('GREEN Darwin dump-shaped helper arriving during verification gets stable ancestry inspection', async () => {
  const f = await fixture({ arrival: true, tokenless: true });
  const groupDiagnostics = [];
  const members = await verifiedGroup(f.record, { ...f, groupDiagnostics });
  assert.ok(members, JSON.stringify(groupDiagnostics));
  assert.deepEqual(members.map(row => row.pid), [1481, 1490, 1491, 1496, 1499, 1500]);
  assert.equal(groupDiagnostics.find(row => row.pid === 1500).reason, 'helper-ancestry-verified');
  assert.equal(f.listCount(), 3);
  const g = await fixture({ arrival: true, tokenless: true });
  assert.equal((await signalOwned(g.record, { ...g, group: true })).sent, true);
  assert.deepEqual(g.signals, [{ pid: -1481, signal: 'SIGTERM' }]);
});

for (const [label, reason, mutate] of [
  ['foreign token', 'foreign-token', ({ environments, lists }) => { if (lists >= 2) environments.set(1500, 'AUN_RUN_TOKEN=ee AUN_PROFILE_DIR=/tmp/other'); }],
  ['changed start time', 'start-time-changed', ({ rows, lists, args, pid }) => { if (lists === 2 && pid === 1500 && args[0] === '-Eww') rows.get(1500).startTime = 'Mon Oct 19 16:58:10 2026'; }],
  ['foreign ancestry', 'ancestry-unverified', ({ rows, lists }) => { if (lists >= 2) rows.get(1500).ppid = 900; }]
]) test(`RED Darwin arriving helper with ${label} refuses with its PID and reason`, async () => {
  const f = await fixture({ arrival: true, tokenless: true, mutate });
  const result = await signalOwned(f.record, { ...f, group: true });
  assert.equal(result.sent, false);
  assert.equal(result.reason, 'group-unverified');
  assert.equal(result.group.find(row => row.pid === 1500).reason, reason);
  assert.equal(result.group.find(row => row.pid === 1500).verdict, 'refused');
  assert.deepEqual(f.signals, []);
});

test('GREEN Darwin arrivals across three snapshots converge before signalling', async () => {
  const f = await fixture({ arrival: true, tokenless: true, mutate({ rows, lists }) {
    if (lists === 3) rows.set(1501, { ...rows.get(1500), pid: 1501 });
  } });
  const result = await signalOwned(f.record, { ...f, group: true });
  assert.equal(result.sent, true);
  assert.equal(f.listCount(), 4);
  assert.deepEqual(f.signals, [{ pid: -1481, signal: 'SIGTERM' }]);
});

for (const [label, reason, mutate] of [
  ['replaced helper identity', 'start-time-changed', ({ rows, lists }) => { if (lists === 2) rows.get(1490).startTime = 'Mon Oct 19 16:58:10 2026'; }],
  ['changed helper executable', 'executable-changed', ({ rows, lists }) => { if (lists === 2) rows.get(1490).command = '/tmp/other --type=gpu-process'; }],
  ['conflicting helper profile', 'inspection-profile-mismatch', ({ rows }) => { rows.get(1490).command = `${helper('Aperitif')} --type=gpu-process --user-data-dir=/tmp/other`; }],
  ['refused final inventory', 'final-list-failed', ({ lists }) => { if (lists === 2) throw Object.assign(new Error('refused'), { code: 'EPERM' }); }]
]) test(`RED Darwin ${label} identifies the failing member and rule`, async () => {
  const f = await fixture({ mutate });
  const result = await signalOwned(f.record, { ...f, group: true });
  assert.equal(result.sent, false);
  assert.equal(result.group.find(row => row.pid === 1490).reason, reason);
  assert.deepEqual(f.signals, []);
});

test('RED Darwin unreadable helper identity retains the adapter reason', async () => {
  const f = await fixture();
  const inspect = f.processAdapter.inspect;
  f.processAdapter.inspect = pid => pid === 1490 ? { pid, readable: false, reason: 'PROCESS_FORMAT' } : inspect(pid);
  const result = await signalOwned(f.record, { ...f, group: true });
  const member = result.group.find(row => row.pid === 1490);
  assert.equal(result.sent, false);
  assert.equal(member.reason, 'identity-unreadable');
  assert.equal(member.phase, 'inspection-to-final');
  assert.equal(member.inspectionReason, 'PROCESS_FORMAT');
  assert.deepEqual(f.signals, []);
});

test('RED Darwin initial inventory failure reports its phase and error', async () => {
  const f = await fixture();
  f.processAdapter.list = async () => { throw Object.assign(new Error('refused'), { code: 'EPERM' }); };
  const result = await signalOwned(f.record, { ...f, group: true });
  assert.equal(result.sent, false);
  assert.equal(result.group[0].reason, 'initial-list-failed');
  assert.equal(result.group[0].error, 'EPERM');
  assert.deepEqual(f.signals, []);
});
