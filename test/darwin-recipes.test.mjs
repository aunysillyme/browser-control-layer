import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { darwinAdapter, parseProcessTable } from '../src/proc/platform/darwin.mjs';
import { RECIPES, matchRecipe } from '../src/hygiene/recipes.mjs';
import { createLedger, stampActivity } from '../src/hygiene/ledger.mjs';
import { discoverRuns } from '../src/hygiene/sweep.mjs';
import { reap } from '../src/hygiene/reap.mjs';
import { startIdleTimer, cancelIdleTimer, runIdleTimer } from '../src/hygiene/idle-timer.mjs';
import { crashMatrix, outcomeIssues } from '../evals/e1/matrix.mjs';
import { fakeFs } from './fixtures/hygiene/fakes.mjs';

const start = 'Mon Oct 19 17:20:12 2026';
const executable = '/fixture/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const line = (pid, ppid, command) => `${pid} ${ppid} ${pid} ${start} ${process.getuid?.() ?? 0} 0.2 1024 ${command}`;
const timerScript = fileURLToPath(new URL('../src/hygiene/idle-timer.mjs', import.meta.url));
const profiles = {
  'playwright-mcp': '/fixture/test-home/Library/Caches/ms-playwright-mcp/mcp-chrome-cdf5bb4',
  'chrome-devtools-mcp': '/fixture/test-home/.cache/chrome-devtools-mcp/chrome-profile',
  'agent-browser': '/fixture/tmp/agent-browser-chrome-209b57e6-b7b3-486e-ab22-c2cc752d64d5'
};

// The CI dumps show a short Node command, a worker with a JSON browser path,
// and a launchd-owned native daemon. All process and filesystem effects are fake.
async function fixture(id) {
  const recipe = RECIPES.find(row => row.id === id), profile = profiles[id];
  const fs = fakeFs(), ledger = createLedger({ root: '/state', fs });
  await ledger.initialize();
  await fs.mkdir(profile, { recursive: true, mode: 0o700 });
  const driver = id === 'agent-browser' ? '/fixture/agent-browser-darwin-arm64' : `node /fixture/node_modules/.bin/${id} --headless`;
  const commands = new Map([
    [50, line(50, 1, `/fixture/node /fixture/worker.mjs ${JSON.stringify({ browserPath: executable })}`)],
    [200, line(200, id === 'agent-browser' ? 1 : 50, driver)],
    [300, line(300, 200, `${executable} ${recipe.automationFlags[0]} --user-data-dir=${profile}`)],
    [301, line(301, 300, `${executable} Helper --type=renderer --user-data-dir=${profile}`)],
    [900, line(900, 1, `${executable} --remote-debugging-port=0 --user-data-dir=/user/Library/Application Support/Google/Chrome`)]
  ]);
  const env = new Map([[200, 'AGENT_BROWSER_SESSION=fixture-session AGENT_BROWSER_SOCKET_DIR=/fixture/state']]);
  const signals = [], closes = [];
  const processAdapter = darwinAdapter({ async run(command, args) {
    const pid = Number(args[args.indexOf('-p') + 1]);
    if (args[0] === '-Aww') return { stdout: [...commands.values()].join('\n') };
    if (!commands.has(pid)) throw Object.assign(new Error('gone'), { code: 1, stdout: '' });
    if (args[0] === '-Eww') return { stdout: `${pid} command ${env.get(pid) || ''}` };
    return { stdout: commands.get(pid) };
  }, async signal(pid, signal) {
    assert.ok(pid === 300 || pid === 400, 'only the recorded browser root or timer may receive a signal');
    assert.equal(signal, 'SIGTERM');
    signals.push({ pid, signal });
    commands.delete(pid);
    if (pid === 300) commands.delete(301);
  } });
  const options = { ledger, processAdapter, sessionKey: 'fixture', profileOptions: { platform: 'darwin', home: '/user', env: {} }, termGraceMs: 0, sleep: async () => {},
    runDriverClose: async (file, args, options) => {
      assert.equal(file, '/fixture/agent-browser-darwin-arm64');
      assert.deepEqual(args, ['--session', 'fixture-session', 'close']);
      assert.equal(options.env.AGENT_BROWSER_SOCKET_DIR, '/fixture/state');
      closes.push(args); commands.delete(200);
    } };
  await stampActivity({ ...options, hostPid: 50, hostStartTime: start, driverId: id, driverVersion: recipe.version, driverSession: 'fixture-session' });
  return { ...options, fs, commands, env, signals, closes, recipe, profile };
}

test('GREEN Darwin Node entry scripts and worker JSON keep their command boundaries', () => {
  for (const entry of ['/fixture/node_modules/.bin/playwright-mcp', '/fixture/node_modules/@playwright/mcp/cli.js', '/fixture/node_modules/chrome-devtools-mcp/build/src/index.js']) {
    const [row] = parseProcessTable(line(200, 50, `node ${entry} --headless`));
    assert.equal(row.executable, 'node');
    assert.equal(row.readable, true);
    assert.ok(row.argv.includes(entry));
  }
  const [worker] = parseProcessTable(line(50, 1, `/fixture/node /fixture/worker.mjs ${JSON.stringify({ browserPath: executable })}`));
  assert.equal(worker.executable, '/fixture/node');
  assert.deepEqual(worker.argv, ['/fixture/node', '/fixture/worker.mjs']);
});

for (const item of crashMatrix({ drivers: RECIPES }).filter(row => row.arm === 'unleased')) test(`GREEN Darwin ${item.id} ${item.driver} ${item.ending} meets the E1 pass line`, async () => {
  const f = await fixture(item.driver);
  const discovery = await discoverRuns(f);
  assert.equal(discovery.discovered.length, 1);
  const record = discovery.discovered[0];
  if (item.ending === 'idle') {
    await f.ledger.update(record.id, old => ({ ...old, lastActivity: 0 }));
    await f.ledger.updateSession(f.sessionKey, old => ({ ...old, lastActivity: 0 }));
    const timer = await startIdleTimer({ ...f, spawn(command, args) {
      const child = new EventEmitter(); child.pid = 400; child.unref = () => {};
      f.commands.set(400, line(400, 1, [command, ...args].join(' ')));
      return child;
    } });
    assert.equal(timer.started, true);
    const fired = await runIdleTimer({ ...f, token: timer.token, generation: (await f.ledger.readSession(f.sessionKey)).generation, deadline: 0, wait: async () => {}, reapFn: options => reap({ ...f, ...options }) });
    assert.equal(fired.fired, true);
    assert.equal(fired.result.exitCode, 0);
    f.commands.delete(400); // The timer process exits when runIdleTimer returns.
    assert.equal((await f.ledger.readSession(f.sessionKey)).timer, null);
  } else {
    f.commands.delete(50);
    if (item.driver !== 'agent-browser') { f.commands.delete(200); f.commands.set(300, f.commands.get(300).replace('300 200 ', '300 1 ')); }
    assert.equal((await reap({ ...f, mode: 'orphans' })).exitCode, 0);
  }
  const table = await f.processAdapter.list();
  const owned = table.filter(row => [300, 301, 400].includes(row.pid) || item.driver === 'agent-browser' && row.pid === 200);
  const profilePresent = f.fs.entries.has(f.profile);
  assert.deepEqual(outcomeIssues({ ...item, ownedProcesses: owned.length, ownedRssBytes: owned.reduce((sum, row) => sum + row.rssBytes, 0), throwawayDirectories: record.profileClass === 'throwaway' && profilePresent ? 1 : 0, persistentDirectoriesKept: record.profileClass !== 'driver-persistent' || profilePresent, runTabs: owned.length ? null : 0, sentinelAlive: f.commands.has(900), sentinelTabs: f.commands.has(900) ? 2 : 0, wrongKills: f.signals.filter(row => row.pid !== 300).length, idleClosed: !owned.length, timerExited: !f.commands.has(400) }), []);
  assert.deepEqual(f.signals, [{ pid: 300, signal: 'SIGTERM' }]);
  assert.equal(f.closes.length, item.driver === 'agent-browser' ? 1 : 0);
});

for (const id of Object.keys(profiles)) for (const [label, mutate] of [
  ['version drift', f => f.ledger.updateSession(f.sessionKey, old => ({ ...old, stamps: Object.fromEntries(Object.entries(old.stamps).map(([key, stamp]) => [key, { ...stamp, driverVersion: '0.0.0' }])) }))],
  ['neighbor profile', f => f.commands.set(300, f.commands.get(300).replace(f.profile, f.profile + '/neighbor'))],
  ['helper process', f => f.commands.set(300, f.commands.get(300).replace(executable, executable + ' Helper'))],
  ['missing automation flag', f => f.commands.set(300, f.commands.get(300).replace(f.recipe.automationFlags[0], ''))]
]) test(`RED Darwin ${id} ${label} stays unattributed and signal-free`, async () => {
  const f = await fixture(id); await mutate(f);
  assert.equal((await discoverRuns(f)).discovered.length, 0);
  assert.equal((await reap({ ...f, mode: 'idle' })).exitCode, 0);
  assert.deepEqual(f.signals, []); assert.deepEqual(f.closes, []);
  assert.ok(f.commands.has(900)); assert.ok(f.fs.entries.has(f.profile));
});

for (const [label, mutate] of [
  ['foreign host', f => f.commands.set(50, line(51, 1, '/fixture/node'))],
  ['reused host', f => f.commands.set(50, f.commands.get(50).replace(start, 'Mon Oct 19 17:20:13 2026'))],
  ['eval argument', f => f.commands.set(200, line(200, 50, 'node --eval /fixture/node_modules/.bin/playwright-mcp'))],
  ['ambiguous entry path', f => f.commands.set(200, line(200, 50, 'node /fixture/a path/node_modules/.bin/playwright-mcp --headless'))]
]) test(`RED Darwin MCP ${label} refuses attribution`, async () => {
  const f = await fixture('playwright-mcp'); await mutate(f);
  assert.equal((await discoverRuns(f)).discovered.length, 0); assert.deepEqual(f.signals, []);
});

for (const [label, value] of [['foreign session', 'AGENT_BROWSER_SESSION=other'], ['unreadable session', '']]) test(`RED Darwin daemon ${label} refuses attribution`, async () => {
  const f = await fixture('agent-browser'); f.env.set(200, value);
  assert.equal((await discoverRuns(f)).discovered.length, 0); assert.deepEqual(f.signals, []); assert.deepEqual(f.closes, []);
});

test('RED Darwin-only executable stays outside the Linux recipe set', () => {
  const [row] = parseProcessTable(line(300, 200, `${executable} --remote-debugging-pipe --user-data-dir=${profiles['playwright-mcp']}`));
  const recipe = RECIPES.find(row => row.id === 'playwright-mcp');
  assert.equal(matchRecipe(row, { platform: 'darwin', versions: { [recipe.id]: recipe.version } })?.id, recipe.id);
  assert.equal(matchRecipe(row, { platform: 'linux', versions: { [recipe.id]: recipe.version } }), null);
});

test('GREEN Darwin timer with spaced state and session arguments cancels only its saved identity', async () => {
  const f = await fixture('playwright-mcp');
  const timer = { ...parseProcessTable(line(400, 1, `${process.execPath} ${timerScript} --run /fixture/Library/Application Support/state session key token 1 0`))[0], token: 'token' };
  f.commands.set(400, line(400, 1, timer.command));
  await f.ledger.updateSession(f.sessionKey, old => ({ ...old, timer }));
  assert.equal((await cancelIdleTimer(f)).cancelled, true);
  assert.deepEqual(f.signals, [{ pid: 400, signal: 'SIGTERM' }]);
  assert.equal((await f.ledger.readSession(f.sessionKey)).timer, null);
});
