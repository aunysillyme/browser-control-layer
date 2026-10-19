import test from 'node:test';
import assert from 'node:assert/strict';
import { darwinAdapter, parseProcessTable } from '../src/proc/platform/darwin.mjs';
import { owns } from '../src/proc/owns.mjs';
import { signalOwned } from '../src/proc/signals.mjs';
import { refreshLease } from '../src/hygiene/lease.mjs';
import { cleanup } from '../src/hygiene/cleanup.mjs';
import { reap } from '../src/hygiene/reap.mjs';
import { leasedFixture } from './fixtures/hygiene/fakes.mjs';

const app = '/Applications/Google Chrome for Testing.app/Contents';
const executable = `${app}/MacOS/Google Chrome for Testing`;
const helper = `${app}/Frameworks/Google Chrome for Testing Framework.framework/Helpers/Google Chrome for Testing Helper (Aperitif).app/Contents/MacOS/Google Chrome for Testing Helper (Aperitif)`;
const start = 'Mon Oct 19 11:23:44 2026';
const line = (pid, ppid, pgid, command) => `${pid} ${ppid} ${pgid} ${start} 501 0.2 1024 ${command}`;

async function fixture() {
  const f = await leasedFixture({ executable, startTime: start, uid: 501 });
  const userDataDir = `${f.record.userDataDir} with spaces`;
  await f.fs.rename(f.record.userDataDir, userDataDir);
  f.record.userDataDir = userDataDir;
  f.record.argv = [executable, `--user-data-dir=${userDataDir}`];
  await f.ledger.writeOwner(f.record.id, f.record);
  await f.ledger.write(f.record);
  const commands = new Map([
    [100, line(100, 50, 100, `${executable} --user-data-dir=${f.record.userDataDir} --headless=new --no-sandbox --remote-debugging-port=0 about:blank`)],
    [101, line(101, 100, 100, `${helper} --type=gpu-process --user-data-dir=${f.record.userDataDir} --no-sandbox`)],
    [102, line(102, 101, 100, `${helper} --type=utility --service-sandbox-type=utility`)],
    [900, line(900, 50, 900, `${executable} --user-data-dir=/user/Library/Application Support/Google/Chrome --headless=new`)]
  ]);
  const environments = new Map([[100, `AUN_RUN_TOKEN=${f.record.runToken} AUN_PROFILE_DIR=${f.record.userDataDir}`]]);
  const calls = [], signals = [];
  const processAdapter = darwinAdapter({ async run(command, args, options) {
    calls.push({ command, args, options });
    const pid = Number(args[args.indexOf('-p') + 1]);
    if (args[0] === '-Aww') return { stdout: [...commands.values()].join('\n') };
    if (!commands.has(pid)) throw Object.assign(new Error('gone'), { code: 1, stdout: '' });
    if (args.at(-1) === 'pid=,command=') {
      if (!environments.has(pid)) throw Object.assign(new Error('denied'), { code: 'EPERM' });
      const env = args[0] === '-Eww' ? environments.get(pid) : '';
      return { stdout: `${pid} ${parseProcessTable(commands.get(pid))[0].command} ${env}\n` };
    }
    // Model modern ps semantics: e selects processes; E requests environments.
    if (args[0] === 'eww') return { stdout: parseProcessTable(commands.get(pid))[0].command + '\n' };
    return { stdout: commands.get(pid) + '\n' };
  }, async signal(pid, signal) {
    assert.equal(pid, -100, 'only the proven leased group may receive a signal');
    signals.push({ pid, signal });
    for (const [member, text] of commands) if (parseProcessTable(text)[0].pgid === -pid) commands.delete(member);
  } });
  return { ...f, processAdapter, profileOptions: { home: '/user', env: {}, platform: 'darwin' }, commands, environments, calls, signals };
}

test('Darwin requests the environment with explicit -E and binds it to the requested PID', async () => {
  const f = await fixture();
  assert.deepEqual(await f.processAdapter.inspectToken(100), { runToken: f.record.runToken, profilePath: f.record.userDataDir });
  const { command, args, options } = f.calls.at(-1);
  assert.equal(command, '/bin/ps');
  assert.deepEqual(args, ['-Eww', '-p', '100', '-o', 'pid=,command=']);
  assert.equal(options.env.LC_ALL, 'C');
  assert.ok(options.timeout > 0 && options.maxBuffer > 0);
  f.environments.set(100, 'AGENT_BROWSER_SESSION=fixture-session AGENT_BROWSER_SOCKET_DIR=/tmp/socket with spaces');
  assert.deepEqual(await f.processAdapter.inspectEnv(100, ['AGENT_BROWSER_SESSION', 'AGENT_BROWSER_SOCKET_DIR']), { AGENT_BROWSER_SESSION: 'fixture-session', AGENT_BROWSER_SOCKET_DIR: '/tmp/socket with spaces' });
});

test('RED Darwin environment from another PID or multiple rows stays unverified', async () => {
  for (const stdout of ['101 command AUN_RUN_TOKEN=ff AUN_PROFILE_DIR=/tmp/profile\n', '100 command AUN_RUN_TOKEN=ff AUN_PROFILE_DIR=/tmp/profile\n101 command\n', 'command AUN_RUN_TOKEN=ff AUN_PROFILE_DIR=/tmp/profile\n']) {
    const adapter = darwinAdapter({ run: async () => ({ stdout }), signal: () => assert.fail('signal refused') });
    assert.equal(await adapter.inspectToken(100), null);
    assert.equal(await adapter.inspectEnv(100, ['AUN_RUN_TOKEN']), null);
  }
});

for (const mode of ['cleanup', 'idle', 'orphans', 'budget']) test(`GREEN Darwin ${mode} closes the leased root and tokenless helpers with the sentinel alive`, async () => {
  const f = await fixture();
  if (mode === 'budget') { f.record.budgets.rssBytes = 0; await f.ledger.write(f.record); }
  const rows = await f.processAdapter.list();
  assert.equal(rows[0].executable, executable);
  assert.equal(rows[0].startTime, start);
  assert.equal(rows[1].executable, helper);
  assert.equal(rows[2].ppid, 101);
  assert.equal((await owns(f.record, f)).owned, true);
  assert.equal(await refreshLease(f.record, f), true);
  assert.deepEqual((await f.ledger.read(f.record.id)).members.map(row => row.pid), [100, 101, 102]);
  const options = { ...f, mode, idleSeconds: 0, termGraceMs: 0 };
  const result = mode === 'cleanup' ? await cleanup({ ...options, apply: true }) : await reap(options);
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.browsers, { owned: 1, closed: 1 });
  assert.equal(result.remaining, 0);
  assert.equal(result.actions[0].profile.removed, true);
  assert.deepEqual(f.signals, [{ pid: -100, signal: 'SIGTERM' }]);
  assert.deepEqual([...f.commands.keys()], [900]);
});

test('GREEN Darwin changed owner start identity qualifies even with a relative owner command', async () => {
  const f = await fixture();
  f.commands.set(50, line(50, 1, 50, 'node bench/lifecycle/run.mjs --ci'));
  await f.ledger.update(f.record.id, old => ({ ...old, hostStartTime: 'fixture-owner-ended' }));
  const host = await f.processAdapter.inspect(50);
  assert.equal(host.readable, false);
  assert.equal(host.startTime, start);
  const result = await reap({ ...f, mode: 'orphans', termGraceMs: 0 });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.browsers, { owned: 1, closed: 1 });
  assert.equal(result.remaining, 0);
  assert.equal(result.actions[0].profile.removed, true);
  assert.deepEqual(f.signals, [{ pid: -100, signal: 'SIGTERM' }]);
  assert.deepEqual([...f.commands.keys()], [900, 50]);
});

test('GREEN Darwin launchd-reparented leased root closes with its helpers and spaced profile', async () => {
  const f = await fixture();
  f.commands.set(100, f.commands.get(100).replace('100 50 100 ', '100 1 100 '));
  assert.equal((await f.processAdapter.inspect(100)).ppid, 1);
  assert.equal((await owns(f.record, f)).owned, true);
  const result = await reap({ ...f, mode: 'orphans', termGraceMs: 0 });
  assert.equal(result.exitCode, 0);
  assert.equal(result.remaining, 0);
  assert.equal(result.actions[0].profile.removed, true);
  assert.equal(f.fs.entries.has(f.record.userDataDir), false);
  assert.deepEqual(f.signals, [{ pid: -100, signal: 'SIGTERM' }]);
  assert.deepEqual([...f.commands.keys()], [900]);
});

for (const [label, command, savedStart] of [
  ['active relative-command owner', line(50, 1, 50, 'node bench/lifecycle/run.mjs --ci'), start],
  ['missing saved owner start', line(50, 1, 50, 'node bench/lifecycle/run.mjs --ci'), null],
  ['unreadable owner identity', '50 unavailable', 'fixture-owner-ended']
]) test(`RED Darwin ${label} leaves the leased browser alive`, async () => {
  const f = await fixture();
  f.commands.set(50, command);
  await f.ledger.update(f.record.id, old => ({ ...old, hostStartTime: savedStart }));
  const result = await reap({ ...f, mode: 'orphans', termGraceMs: 0 });
  assert.equal(result.exitCode, 3);
  assert.equal(result.actions[0].eligible, false);
  assert.equal(result.remaining, 1);
  assert.deepEqual(f.signals, []);
  assert.ok(f.commands.has(100));
  assert.ok(f.commands.has(900));
  assert.ok(f.fs.entries.has(f.record.userDataDir));
});

test('RED Darwin owner inspection from another PID or multiple rows stays unverified', async () => {
  for (const stdout of [line(51, 1, 51, '/usr/bin/node'), `${line(50, 1, 50, '/usr/bin/node')}\n${line(51, 1, 51, '/usr/bin/node')}`, null]) {
    const f = await fixture();
    const inspect = f.processAdapter.inspect;
    const ownerAdapter = darwinAdapter({ run: async () => {
      if (stdout === null) throw Object.assign(new Error('denied'), { code: 'EPERM' });
      return { stdout };
    }, signal: () => assert.fail('signal refused') });
    f.processAdapter.inspect = pid => pid === 50 ? ownerAdapter.inspect(pid) : inspect(pid);
    await f.ledger.update(f.record.id, old => ({ ...old, hostStartTime: 'fixture-owner-ended' }));
    const result = await reap({ ...f, mode: 'orphans', termGraceMs: 0 });
    assert.equal(result.actions[0].eligible, false);
    assert.deepEqual(f.signals, []);
    assert.ok(f.commands.has(900));
  }
});

test('GREEN Darwin readable helper environments retain the same lease proof', async () => {
  const f = await fixture();
  for (const pid of [101, 102]) f.environments.set(pid, f.environments.get(100));
  assert.equal((await signalOwned(f.record, { ...f, group: true })).sent, true);
  assert.deepEqual(f.signals, [{ pid: -100, signal: 'SIGTERM' }]);
});

test('Darwin preserves padded ps start times and exact profile paths containing spaces', async () => {
  const f = await fixture();
  const command = `${executable} --user-data-dir=/tmp/profile with spaces --headless=new`;
  const [row] = parseProcessTable(line(100, 50, 100, command).replace(start, 'Thu Oct  8 01:02:03 2026'));
  assert.equal(row.startTime, 'Thu Oct  8 01:02:03 2026');
  assert.ok(row.argv.includes('--user-data-dir=/tmp/profile with spaces'));
  f.environments.set(100, `AUN_RUN_TOKEN=${f.record.runToken} AUN_PROFILE_DIR=/tmp/profile with spaces OTHER=value`);
  assert.equal((await f.processAdapter.inspectToken(100)).profilePath, '/tmp/profile with spaces');
});

for (const [label, mutate] of [
  ['unreadable root environment', f => f.environments.delete(100)],
  ['wrong root token', f => f.environments.set(100, `AUN_RUN_TOKEN=ee AUN_PROFILE_DIR=${f.record.userDataDir}`)],
  ['wrong environment profile', f => f.environments.set(100, `AUN_RUN_TOKEN=${f.record.runToken} AUN_PROFILE_DIR=/tmp/other`)],
  ['reused root PID', f => f.commands.set(100, f.commands.get(100).replace(start, 'Mon Oct 19 11:23:45 2026'))],
  ['changed group', f => f.commands.set(100, f.commands.get(100).replace('100 50 100 ', '100 50 900 '))],
  ['changed profile', f => f.commands.set(100, f.commands.get(100).replace(f.record.userDataDir, '/tmp/other'))],
  ['relative root command', f => f.commands.set(100, f.commands.get(100).replace(executable, 'chrome'))],
  ['unreadable process row', f => f.commands.set(100, '100 unavailable')],
  ['missing owner file', f => f.fs.unlink('/state/runs/run1/owner.json')],
  ['unrelated tokenless helper', f => f.commands.set(102, line(102, 900, 100, `${helper} --type=utility`))],
  ['reparented tokenless helper', f => f.commands.set(102, line(102, 1, 100, `${helper} --type=utility`))],
  ['foreign helper token', f => f.environments.set(101, `AUN_RUN_TOKEN=ee AUN_PROFILE_DIR=${f.record.userDataDir}`)]
]) test(`RED Darwin ${label} refuses a group signal`, async () => {
  const f = await fixture();
  await mutate(f);
  assert.equal((await signalOwned(f.record, { ...f, group: true })).sent, false);
  assert.deepEqual(f.signals, []);
  assert.ok(f.commands.has(900));
});
