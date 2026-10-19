import test from 'node:test';
import assert from 'node:assert/strict';
import { leasedFixture, fakeProcess, processRow } from './fixtures/hygiene/fakes.mjs';
import { owns } from '../src/proc/owns.mjs';
import { signalOwned, signalLeasedSurvivors } from '../src/proc/signals.mjs';
import { attribute, ancestors } from '../src/proc/ancestry.mjs';
import { parseStat } from '../src/proc/platform/linux.mjs';
import { parseProcessTable, darwinAdapter } from '../src/proc/platform/darwin.mjs';
test('macOS preserves an absolute driver script and refuses ambiguous or eval argument paths',()=>{
  const prefix='41 30 41 Mon Oct 19 01:02:03 2026 501 0.1 1024 ';
  const script='/tmp/node_modules/@playwright/mcp/cli.js';
  assert.ok(parseProcessTable(prefix+'/usr/bin/node '+script+' --headless')[0].argv.includes(script));
  assert.equal(parseProcessTable(prefix+'/usr/bin/node --eval '+script)[0].argv.includes(script),false);
  assert.equal(parseProcessTable(prefix+'/usr/bin/node /tmp/a path/cli.js')[0].argv.some(arg=>arg.endsWith('/cli.js')),false);
});
import { profileArgument, isUserProfile, classifyProfile } from '../src/hygiene/profiles.mjs';

for (const [label, mutate] of [
  ['PID reuse', f => { f.processAdapter.state.get(100).startTime = 'reused'; }],
  ['unreadable argv', f => { f.processAdapter.state.get(100).readable = false; }],
  ['changed profile', f => { f.processAdapter.state.get(100).argv = ['/test/chrome', '--user-data-dir=/tmp/other']; }],
  ['changed token', f => { f.processAdapter.tokens.get(100).runToken = 'other'; }],
  ['missing owner file', f => f.fs.unlink('/state/runs/run1/owner.json')],
  ['symlinked profile', async f => { await f.fs.rm(f.record.userDataDir, { recursive: true }); await f.fs.mkdir('/other', { mode: 0o700 }); await f.fs.symlink('/other', f.record.userDataDir); }],
  ['permission denial', f => { f.processAdapter.inspect = async () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); }; }]
]) test(`RED ${label} refuses signals; GREEN exact lease permits TERM`, async () => {
  const green = await leasedFixture();
  assert.equal((await signalOwned(green.record, green)).sent, true);
  const red = await leasedFixture(); await mutate(red);
  assert.equal((await signalOwned(red.record, red)).sent, false);
  assert.equal(red.processAdapter.signals.length, 0);
});

test('RED user Chrome path is refused without filesystem reads; GREEN throwaway path qualifies', async () => {
  const f = await leasedFixture();
  assert.equal((await owns(f.record, f)).owned, true);
  f.record.userDataDir = '/user/.config/google-chrome/Default';
  f.processAdapter.state.get(100).argv = ['/test/chrome', `--user-data-dir=${f.record.userDataDir}`];
  f.ledger.fs.realpath = async () => { throw new Error('user profile was accessed'); };
  assert.equal((await owns(f.record, f)).reason, 'user-profile');
  assert.equal(isUserProfile('/user/Library/Application Support/Google/Chrome/Profile 2', { home: '/user', platform: 'darwin' }), true);
  assert.equal(isUserProfile('C:\\Users\\test\\AppData\\Local\\Google\\Chrome\\User Data', { home: 'C:\\Users\\test', env: {}, platform: 'win32' }), true);
});

test('RED unverified group member refuses group signal; GREEN verified group signals group only', async () => {
  const f = await leasedFixture();
  const child = processRow(101, { ppid: 100, pgid: 100 }); f.processAdapter.state.set(101, child);
  assert.equal((await signalOwned(f.record, { ...f, group: true })).sent, false);
  f.processAdapter.tokens.set(101, { runToken: f.record.runToken, profilePath: f.record.userDataDir });
  assert.equal((await signalOwned(f.record, { ...f, group: true })).target, -100);
});

test('RED zombie group member does not block the group signal; GREEN live unverified member still does', async () => {
  const f = await leasedFixture();
  f.processAdapter.state.set(101, processRow(101, { ppid: 100, pgid: 100, state: 'Z', readable: false }));
  assert.equal((await signalOwned(f.record, { ...f, group: true })).target, -100);
  f.processAdapter.state.set(102, processRow(102, { ppid: 100, pgid: 100 }));
  assert.equal((await signalOwned(f.record, { ...f, group: true })).sent, false);
});

test('RED ownership changes at final read; GREEN stable identity signals', async () => {
  const f = await leasedFixture(); let reads = 0; const original = f.processAdapter.inspect;
  f.processAdapter.inspect = async pid => { const row = await original(pid); if (++reads >= 2 && row) row.startTime = 'reused'; return row; };
  assert.equal((await signalOwned(f.record, f)).sent, false);
  assert.deepEqual(f.processAdapter.signals, []);
});

test('RED unrecorded helper survivor refused; GREEN persisted helper identity closes', async () => {
  const f = await leasedFixture(); f.processAdapter.state.delete(100);
  const helper = processRow(101, { ppid: 1, pgid: 100 }); f.processAdapter.state.set(101, helper);
  f.processAdapter.tokens.set(101, { runToken: f.record.runToken, profilePath: f.record.userDataDir });
  assert.equal((await signalLeasedSurvivors(f.record, f)).sent, false);
  f.record.members.push(helper);
  assert.equal((await signalLeasedSurvivors(f.record, f)).sent, true);
  assert.equal(f.processAdapter.signals[0].pid, 101);
});

test('RED another host stamp cannot attribute; GREEN MCP and Bash ancestry bind exact host and driver', () => {
  const rows = [processRow(10, { executable: '/host', ppid: 1 }), processRow(20, { ppid: 10, executable: '/node', argv: ['/node', '/driver/main.mjs'] }), processRow(30, { ppid: 20 })];
  const recipes = [{ id: 'fixture', version: '1', driverExecutables: ['/node'], driverArg: value => value === '/driver/main.mjs' }];
  const stamp = { hostPid: 10, hostStartTime: 'start-10', driverId: 'fixture', driverVersion: '1' };
  assert.equal(attribute(rows[2], rows, [{ ...stamp, hostPid: 11 }], recipes), null);
  assert.equal(attribute(rows[2], rows, [stamp], recipes).driverPid, 20);
  rows.splice(1, 0, processRow(15, { ppid: 10, executable: '/bin/bash' })); rows[2].ppid = 15;
  assert.equal(attribute(rows[3], rows, [stamp], recipes).driverPid, 20);
  rows[0].ppid = 30; assert.equal(ancestors(30, rows).verified, false);
});

test('platform parsers preserve profile spaces and process start identity', async () => {
  const line = '100 50 100 Sun Oct 18 12:00:00 2026 501 0.2 120 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/tmp/profile with spaces --headless';
  const [row] = parseProcessTable(line);
  assert.equal(profileArgument(row.argv), '/tmp/profile with spaces');
  assert.equal(row.executable, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  const fields = ['S', '50', '100', ...Array(16).fill('0'), '1234', '0', '20'];
  assert.equal(parseStat(`100 (name with ) space) ${fields.join(' ')}`).startTime, '1234');
  const adapter = darwinAdapter({ run: async () => ({ stdout: 'command AUN_RUN_TOKEN=ff AUN_PROFILE_DIR=/tmp/path with spaces OTHER=x' }) });
  assert.deepEqual(await adapter.inspectToken(100), { runToken: 'ff', profilePath: '/tmp/path with spaces' });
});

test('RED ambiguous profile flags refused; GREEN exact argument and profile class accepted', () => {
  assert.equal(profileArgument(['--user-data-dir=/tmp/a', '--user-data-dir=/tmp/b']), null);
  assert.equal(profileArgument(['--user-data-dir', '/tmp/a b']), '/tmp/a b');
  assert.equal(classifyProfile('/tmp/a', { leaseRoot: '/tmp', leaseVerified: true, home: '/user', env: {} }), 'throwaway');
  assert.equal(classifyProfile('/tmp/a', { home: '/user', env: {} }), 'user');
});

test('RED case-varied default profile refused on Darwin; GREEN neighboring directory stays eligible', () => {
  const options = { home: '/User', platform: 'darwin', env: {} };
  assert.equal(isUserProfile('/user/library/application support/google/chrome/Default', options), true);
  assert.equal(isUserProfile('/User/Library/Application Support/Google/Chrome-fixture', options), false);
});

test('Linux CPU percentage uses observed ticks over elapsed time', async () => {
  const { linuxAdapter } = await import('../src/proc/platform/linux.mjs');
  let ticks = 10; let at = 1000;
  const fields = () => ['S', '50', '100', ...Array(8).fill('0'), String(ticks), '0', ...Array(6).fill('0'), '1234', '0', '20'];
  const fs = { async readFile(path) { if (path.endsWith('/stat')) return `100 (chrome) ${fields().join(' ')}`; if (path.endsWith('/cmdline')) return '/test/chrome\0--user-data-dir=/tmp/profile\0'; return 'Uid: 501\nVmRSS: 10 kB\n'; }, async readlink() { return '/test/chrome'; }, async readdir() { return ['100']; } };
  const adapter = linuxAdapter({ fs, run: async () => ({ stdout: '100' }), now: () => at, signal: () => { throw new Error('signal forbidden'); } });
  assert.equal((await adapter.inspect(100)).cpuPercent, null);
  ticks = 60; at = 2000;
  assert.equal((await adapter.inspect(100)).cpuPercent, 50);
});

test('Linux zombie holds no resident memory; a live process without VmRSS stays unmeasured', async () => {
  const { linuxAdapter } = await import('../src/proc/platform/linux.mjs');
  const stat = state => `100 (chrome) ${[state, '50', '100', ...Array(16).fill('0'), '1234', '0', '20'].join(' ')}`;
  const adapter = state => linuxAdapter({ fs: { async readFile(path) { if (path.endsWith('/stat')) return stat(state); if (path.endsWith('/cmdline')) return ''; return 'Uid: 501\n'; }, async readlink() { throw Object.assign(new Error('gone'), { code: 'ENOENT' }); }, async readdir() { return ['100']; } }, run: async () => ({ stdout: '100' }) });
  assert.equal((await adapter('Z').inspect(100)).rssBytes, 0);
  assert.equal((await adapter('S').inspect(100)).rssBytes, null);
});

test('Windows read-only inventory parses spaces and refuses signaling', async () => {
  const { win32Adapter } = await import('../src/proc/platform/win32.mjs');
  const adapter = win32Adapter({ run: async () => ({ stdout: JSON.stringify([{ ProcessId: 10, ParentProcessId: 1, CreationDate: '2026-01-01T00:00:00Z', ExecutablePath: 'C:\\Program Files\\Chrome\\chrome.exe', CommandLine: '"C:\\Program Files\\Chrome\\chrome.exe" --user-data-dir="C:\\Temp\\profile with spaces"', WorkingSetSize: 100 }]) }) });
  const [row] = await adapter.list();
  assert.equal(row.argv[1], '--user-data-dir=C:\\Temp\\profile with spaces');
  assert.equal(row.rssBytes, 100); assert.throws(() => adapter.signal(10, 'SIGTERM'), /PLATFORM_UNVERIFIED/);
});
