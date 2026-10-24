import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile, writeFile, mkdtemp, mkdir, chmod, symlink, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cases, measure, runP0, summarize, writeArtifacts, IDLE_MS } from '../bench/p0/index.mjs';
import { parseTable, profileFrom, ownedRoots, sameIdentity, descendants, requireCi, signalChecked, validateRun } from '../bench/p0/runtime.mjs';
import { McpClient } from '../bench/p0/protocol.mjs';
import { selectVersions, verifyInstalled } from '../bench/p0/versions.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const catalog = JSON.parse(await readFile(join(root, 'bench/drivers.json'), 'utf8'));
const item = cases(catalog, 1)[0];

function fakeAdapter({ leftovers = true, failStart = false, failProbe = false, failCleanup = false } = {}) {
  let clock = 0;
  const actions = [];
  const adapter = {
    actions, now: () => clock,
    wait: async ms => { actions.push(['wait', ms]); clock += ms; },
    start: async spec => {
      actions.push(['start', spec.variant.id]);
      if (failStart) throw new Error('driver failed\ncomplete diagnostic');
      return { ended: false, probed: false, versions: { driver: 'test-version' } };
    },
    probe: async handle => {
      if (failProbe) throw new Error('probe refused');
      const remaining = !handle.probed || leftovers;
      handle.probed = true;
      return { browserRoots: remaining ? [{ pid: 11 }] : [], processes: remaining ? [{ pid: 11 }] : [] };
    },
    endOwner: async handle => { actions.push(['endOwner']); handle.ended = true; },
    cleanup: async () => {
      actions.push(['cleanup']);
      if (failCleanup) throw new Error('cleanup refused');
      return { remaining: [] };
    }
  };
  return adapter;
}

test('P0 covers four variants with ten independent H1 and H2 observations each', async () => {
  const adapter = fakeAdapter();
  const rows = await runP0(adapter, catalog);
  assert.equal(rows.length, 80);
  for (const variant of ['playwright-default', 'playwright-isolated', 'chrome-devtools', 'agent-browser']) {
    for (const suite of ['H1', 'H2']) {
      const found = rows.filter(row => row.suite === suite && row.variant === variant);
      assert.equal(found.length, 10);
      assert.equal(new Set(found.map(row => row.repeat)).size, 10);
      assert.ok(found.every(row => row.status === 'measured'));
    }
  }
  assert.equal(adapter.actions.filter(action => action[0] === 'endOwner').length, 40);
  assert.equal(adapter.actions.filter(action => action[0] === 'wait' && action[1] === IDLE_MS).length, 40);
  assert.ok(rows.filter(row => row.suite === 'H2').every(row => row.idle_ms >= 600_000));
});

test('P0 verdict changes only after complete conclusive baseline rows', async () => {
  const rows = await runP0(fakeAdapter(), catalog, { repeats: 1 });
  assert.equal(summarize(rows, 4).line, 'P0: hygiene leads');
  const clean = await runP0(fakeAdapter({ leftovers: false }), catalog, { repeats: 1 });
  assert.equal(summarize(clean, 4).line, 'P0: lead switches to idle + cost');
  assert.equal(summarize(rows.slice(1), 4).status, 'failed');
  rows[0].status = 'failed';
  assert.equal(summarize(rows, 4).status, 'failed');
});

test('P0 rejects duplicate, unexpected, and malformed observations; helpers count as leftovers', async () => {
  const expected = cases(catalog, 1);
  const rows = await runP0(fakeAdapter({ leftovers: false }), catalog, { repeats: 1 });
  assert.equal(summarize(rows, expected).status, 'measured');
  assert.equal(summarize([], []).status, 'failed');
  assert.equal(summarize([rows[1], ...rows.slice(1)], expected).status, 'failed');
  assert.equal(summarize(rows.map((row, i) => i ? row : { ...row, variant: 'unknown' }), expected).status, 'failed');
  assert.equal(summarize(rows.map((row, i) => i ? row : { ...row, leftover_processes: null }), expected).status, 'failed');
  rows[0].leftover_processes = 1;
  assert.equal(summarize(rows, expected).line, 'P0: hygiene leads');
});

test('P0 retries a failed row once, keeps both attempts, and counts the retry', async () => {
  const adapter = fakeAdapter({ leftovers: false });
  const cleanup = adapter.cleanup;
  let refused = 0;
  adapter.cleanup = async handle => {
    if (!refused++) throw new Error('P0_IDENTITY_CHANGED: 51273');
    return cleanup(handle);
  };
  const seen = [];
  const rows = await runP0(adapter, catalog, { repeats: 1, concurrency: 1, onRow: row => { seen.push(row); } });
  assert.equal(rows.length, 9);
  assert.equal(seen.length, 9);
  const failed = rows.filter(row => row.status === 'failed');
  assert.equal(failed.length, 1);
  assert.equal(failed[0].attempt, 1);
  assert.match(failed[0].cleanup_error.message, /P0_IDENTITY_CHANGED/);
  const retry = rows.find(row => row.attempt === 2);
  assert.equal(retry.status, 'measured');
  assert.equal(retry.suite, failed[0].suite);
  assert.equal(retry.variant, failed[0].variant);
  assert.equal(summarize(rows, cases(catalog, 1)).status, 'measured');
});

test('P0 stays inconclusive when the retry fails too, and never retries twice', async () => {
  const adapter = fakeAdapter({ leftovers: false, failCleanup: true });
  const rows = await runP0(adapter, catalog, { repeats: 1, concurrency: 1 });
  assert.equal(rows.length, 16);
  assert.ok(rows.every(row => row.status === 'failed' && [1, 2].includes(row.attempt)));
  assert.equal(summarize(rows, cases(catalog, 1)).status, 'failed');
});

test('P0 summary rejects a third attempt, a measured row followed by a retry, and a missing first attempt', async () => {
  const expected = cases(catalog, 1);
  const rows = await runP0(fakeAdapter({ leftovers: false }), catalog, { repeats: 1 });
  const failedFirst = { ...rows[0], status: 'failed', attempt: 1 };
  const retried = { ...rows[0], attempt: 2 };
  assert.equal(summarize([failedFirst, retried, ...rows.slice(1)], expected).status, 'measured');
  assert.equal(summarize([{ ...rows[0], attempt: 1 }, retried, ...rows.slice(1)], expected).status, 'failed');
  assert.equal(summarize([failedFirst, retried, { ...rows[0], attempt: 3 }, ...rows.slice(1)], expected).status, 'failed');
  assert.equal(summarize([retried, ...rows.slice(1)], expected).status, 'failed');
});

test('P0 keeps complete driver errors and always cleans a launched case', async () => {
  const startFailed = await measure(fakeAdapter({ failStart: true }), item, 'H1');
  assert.equal(startFailed.status, 'failed');
  assert.match(startFailed.error.stack, /driver failed\ncomplete diagnostic/);
  const adapter = fakeAdapter({ failProbe: true });
  const probeFailed = await measure(adapter, item, 'H1');
  assert.equal(probeFailed.status, 'failed');
  assert.deepEqual(adapter.actions.at(-1), ['cleanup']);
  const cleanupFailed = await measure(fakeAdapter({ failCleanup: true }), item, 'H2');
  assert.equal(cleanupFailed.status, 'failed');
  assert.match(cleanupFailed.cleanup_error.message, /cleanup refused/);
});

test('P0 refuses missing browser proof, shortened clocks, and unsupported suites', async () => {
  const missing = fakeAdapter();
  missing.probe = async () => ({ browserRoots: [], processes: [] });
  assert.match((await measure(missing, item, 'H1')).error.message, /P0_LAUNCH/);
  const early = fakeAdapter();
  early.wait = async () => {};
  assert.match((await measure(early, item, 'H2')).error.message, /P0_CLOCK/);
  assert.match((await measure(fakeAdapter(), item, 'OTHER')).error.message, /P0_SUITE/);
  assert.throws(() => cases(catalog, 0), /P0_REPEATS/);
  await assert.rejects(runP0(fakeAdapter(), catalog, { concurrency: 5 }), /P0_CONCURRENCY/);
});

test('P0 process ownership refuses external paths and reused identities', () => {
  const text = [
    ' 10 1 Mon Oct 19 01:00:00 2026 chrome --user-data-dir=/ci/run/profile --headless',
    ' 11 10 Mon Oct 19 01:00:01 2026 chrome --type=renderer',
    ' 12 1 Mon Oct 19 01:00:02 2026 chrome --user-data-dir=/ci/run-other/profile --headless',
    ' 13 1 Mon Oct 19 01:00:03 2026 chrome --user-data-dir=/user/profile --headless'
  ].join('\n');
  const table = parseTable(text);
  const roots = ownedRoots(table, '/ci/run');
  assert.deepEqual(roots.map(proc => proc.pid), [10]);
  assert.deepEqual(descendants(table, roots).map(proc => proc.pid), [10, 11]);
  assert.equal(sameIdentity(roots[0], { ...roots[0] }), true);
  assert.equal(sameIdentity(roots[0], { ...roots[0], start: 'new start' }), false);
  assert.equal(sameIdentity(roots[0], { ...roots[0], argv: 'other executable' }), false);
  assert.equal(sameIdentity(roots[0], null), false);
  assert.equal(profileFrom('chrome --headless'), null);
  assert.equal(profileFrom('chrome --user-data-dir="/ci/run with spaces/profile" --headless'), '/ci/run with spaces/profile');
  assert.throws(() => parseTable('unreadable process line'), /P0_PS_FORMAT/);
  assert.deepEqual(ownedRoots(table, '/ci/run', '/different/chrome'), []);
  assert.deepEqual(ownedRoots(table, '/ci/run', 'chrome').map(proc => proc.pid), [10]);
});

test('P0 signal check refuses uncertain ownership and rechecks identity immediately before sending', async () => {
  const expected = { pid: 77, start: 'start', argv: 'chrome --user-data-dir=/fixture/profile' };
  const events = [];
  const control = {
    validate: async () => events.push('validate'),
    table: async () => { events.push('table'); return [expected]; },
    send: (pid, signal) => events.push([pid, signal])
  };
  assert.equal(await signalChecked(expected, 'SIGTERM', control), true);
  assert.deepEqual(events, ['validate', 'table', [77, 'SIGTERM']]);
  for (const changed of [{ ...expected, start: 'reused' }, { ...expected, argv: '' }]) {
    events.length = 0;
    await assert.rejects(signalChecked(expected, 'SIGTERM', { ...control, table: async () => [changed] }), /P0_IDENTITY_CHANGED/);
    assert.ok(events.every(event => !Array.isArray(event)));
  }
  events.length = 0;
  await assert.rejects(signalChecked(expected, 'SIGTERM', { ...control, table: async () => { throw new Error('permission denied'); } }), /permission denied/);
  await assert.rejects(signalChecked(expected, 'SIGTERM', { ...control, validate: async () => { throw new Error('profile escaped'); } }), /profile escaped/);
  await assert.rejects(signalChecked(null, 'SIGTERM', control), /P0_IDENTITY_MISSING/);
  assert.equal(await signalChecked(expected, 'SIGTERM', { ...control, table: async () => [] }), false);
  assert.ok(events.every(event => !Array.isArray(event)));
});

test('P0 owner marker rejects symlinks, mismatched tokens and permissive modes', async () => {
  await mkdir(join(root, '.test-work'), { recursive: true });
  const dir = await mkdtemp(join(root, '.test-work/p0-marker-'));
  const handle = { runDir: dir, token: 'fixture-token' };
  try {
    await chmod(dir, 0o700);
    await writeFile(join(dir, '.owner'), handle.token, { mode: 0o600 });
    await validateRun(handle);
    await assert.rejects(validateRun({ ...handle, token: 'other' }), /P0_OWNER_MARKER/);
    await chmod(join(dir, '.owner'), 0o644);
    await assert.rejects(validateRun(handle), /P0_OWNER_MARKER/);
    await chmod(join(dir, '.owner'), 0o600);
    await writeFile(join(dir, 'target'), handle.token, { mode: 0o600 });
    await rm(join(dir, '.owner'));
    await symlink(join(dir, 'target'), join(dir, '.owner'));
    await assert.rejects(validateRun(handle), /P0_OWNER_MARKER/);
  } finally { await rm(dir, { recursive: true }); }
});

test('P0 real adapter is CI-only; explicit runner control passes', () => {
  assert.throws(() => requireCi({}), /P0_CI_ONLY/);
  assert.throws(() => requireCi({ CI: 'true', GITHUB_ACTIONS: 'false', RUNNER_TEMP: '/ci' }), /P0_CI_ONLY/);
  assert.doesNotThrow(() => requireCi({ CI: 'true', GITHUB_ACTIONS: 'true', RUNNER_TEMP: '/ci' }));
});

test('P0 artifacts bind complete raw JSONL to SHA-256 and preserve failure rows', async () => {
  await mkdir(join(root, '.test-work'), { recursive: true });
  const dir = await mkdtemp(join(root, '.test-work/p0-'));
  try {
    const rows = [{ status: 'failed', error: { message: 'complete\nerror' } }];
    const verdict = summarize(rows, 4);
    const digest = await writeArtifacts(dir, rows, { versions: { driver: 'test-version' } }, verdict);
    const raw = await readFile(join(dir, 'raw.jsonl'));
    assert.equal(createHash('sha256').update(raw).digest('hex'), digest);
    assert.equal(JSON.parse(raw.toString()).error.message, 'complete\nerror');
    assert.equal((await readFile(join(dir, 'raw.sha256'), 'utf8')).trim(), `${digest}  raw.jsonl`);
    assert.equal(JSON.parse(await readFile(join(dir, 'metadata.json'), 'utf8')).raw.sha256, digest);
    assert.match(await readFile(join(dir, 'verdict.txt'), 'utf8'), /INCONCLUSIVE/);
  } finally { await rm(dir, { recursive: true }); }
});

function fakeChild(tools, toolError = false) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter(); child.stdout.setEncoding = () => {};
  child.stderr = new EventEmitter(); child.stderr.setEncoding = () => {};
  child.stdin = { write(line, callback) {
    const request = JSON.parse(line);
    if (request.id) queueMicrotask(() => child.stdout.emit('data', JSON.stringify({ jsonrpc: '2.0', id: request.id, result:
      request.method === 'tools/list' ? { tools: tools.map(name => ({ name })) } :
        request.method === 'tools/call' ? { isError: toolError, content: [{ type: 'text', text: 'fixture' }] } : {}
    }) + '\n'));
    callback?.();
  } };
  return child;
}

test('P0 MCP checks actual tool support and refuses a driver tool error', async () => {
  const client = new McpClient(fakeChild(['browser_navigate']));
  assert.equal((await client.open('data:text/html,fixture')).tool, 'browser_navigate');
  await assert.rejects(new McpClient(fakeChild(['unrelated'])).open('data:text/html,fixture'), /P0_UNSUPPORTED_TOOLS/);
  await assert.rejects(new McpClient(fakeChild(['new_page'], true)).open('data:text/html,fixture'), /P0_TOOL_ERROR/);
});

test('P0 MCP keeps transport failures and refuses requests after driver exit', async () => {
  const child = fakeChild(['browser_navigate']);
  const client = new McpClient(child);
  child.stderr.emit('data', 'full driver diagnostic\n');
  child.emit('exit', 2, null);
  await assert.rejects(client.request('tools/list'), /P0_DRIVER_EXIT.*\nfull driver diagnostic/);
  const errorChild = fakeChild([]);
  errorChild.stdin.write = (_line, callback) => callback(new Error('write refused'));
  await assert.rejects(new McpClient(errorChild).request('initialize'), /write refused/);
});

test('P0 exact versions fail closed until pins or reviewed inputs are provided', () => {
  const versions = Object.fromEntries([...catalog.drivers, catalog.browser, ...catalog.tools].map(row => row.package).map(name => [name, '1.2.3']));
  const unpinned={...catalog,drivers:catalog.drivers.map(driver=>({...driver,version:null})),browser:{...catalog.browser,version:null}};
  assert.throws(() => selectVersions(unpinned), /P0_VERSION_UNVERIFIED/);
  assert.ok(Object.values(selectVersions(catalog)).every(value=>/^\d+\.\d+\.\d+$/.test(value)));
  assert.deepEqual(selectVersions(catalog, versions), versions);
  for (const version of ['latest', '^1.2.3', '1.2', 'file:fixture', '1.2.3 && ignored']) {
    assert.throws(() => selectVersions(catalog, { ...versions, puppeteer: version }), /P0_VERSION_UNVERIFIED/);
  }
  assert.throws(() => selectVersions(catalog, { ...versions, unknown: '1.2.3' }), /P0_VERSION_PACKAGE/);
  assert.doesNotThrow(() => verifyInstalled(versions, { ...versions }));
  assert.throws(() => verifyInstalled(versions, { ...versions, puppeteer: '1.2.4' }), /P0_VERSION_DRIFT/);
});

test('P0 workflow retains artifacts on failure and gates private macOS runs', async () => {
  const jobs = JSON.parse(await readFile(join(root, 'bench/p0/workflow-jobs.json'), 'utf8')).jobs;
  assert.deepEqual(Object.keys(jobs), ['p0-linux', 'p0-macos']);
  assert.match(jobs['p0-macos'].if, /workflow_dispatch/);
  assert.match(jobs['p0-macos'].if, /private == false/);
  for (const job of Object.values(jobs)) {
    assert.ok(job['timeout-minutes'] >= 120);
    assert.ok(job.steps.some(step => step.run?.includes('--ci --n 10')));
    assert.ok(job.steps.some(step => step.if === 'always()' && step.uses?.startsWith('actions/upload-artifact@')));
    assert.ok(job.steps.filter(step => step.uses).every(step => /@[a-f0-9]{40}$/.test(step.uses)));
    assert.ok(job.steps.some(step => step.run?.includes('--save-dev')));
    assert.ok(job.steps.some(step => step.env?.AUN_P0_VERSIONS?.includes('inputs.p0_versions')));
    assert.ok(job.steps.filter(step => step.run).every(step => !step.run.includes('"view"')));
  }
  assert.ok(catalog.drivers.every(driver => /^\d+\.\d+\.\d+$/.test(driver.version) && driver.recipeOwnership === false));
});
