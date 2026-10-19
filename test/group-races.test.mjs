import test from 'node:test';
import assert from 'node:assert/strict';
import { darwinAdapter } from '../src/proc/platform/darwin.mjs';
import { linuxAdapter } from '../src/proc/platform/linux.mjs';
import { verifiedGroup, signalOwned, signalLeasedSurvivors } from '../src/proc/signals.mjs';
import { cleanup } from '../src/hygiene/cleanup.mjs';
import { leasedFixture, processRow } from './fixtures/hygiene/fakes.mjs';

async function fixture(platform, race, { survivors = false, late = false } = {}) {
  const startTime = platform === 'darwin' ? 'Mon Oct 19 11:23:44 2026' : '1234';
  const f = await leasedFixture({ startTime, uid: 501 });
  const rows = new Map([
    [100, processRow(100, f.record)],
    [101, processRow(101, { startTime, uid: 501, ppid: 100, pgid: 100 })],
    [102, processRow(102, { startTime, uid: 501, ppid: 100, pgid: 100 })],
    [900, processRow(900, { startTime, uid: 501 })]
  ]);
  f.record.members = [...rows.values()].filter(row => row.pgid === 100);
  if (survivors) rows.delete(100);
  let lists = 0, helperReads = 0, changed = false;
  const signals = [];
  const failure = code => Object.assign(new Error('fixture inspection refused'), { code, stdout: '' });
  function change() {
    if (changed) return;
    changed = true;
    if (race.startsWith('exit')) rows.delete(101);
    if (race.startsWith('reuse')) rows.set(101, { ...rows.get(101), startTime: platform === 'darwin' ? 'Mon Oct 19 11:23:45 2026' : '1235', pgid: race === 'reuse-outside' ? 900 : 100 });
    if (race === 'reparent') rows.set(101, { ...rows.get(101), ppid: 900 });
    if (race === 'arrival' || race === 'arrival-owned') rows.set(103, processRow(103, { startTime, uid: 501, pgid: 100, ppid: race === 'arrival-owned' ? 100 : 900 }));
  }
  function inventory() {
    lists++;
    if (lists === 2 && race === 'list-refused') throw failure('EPERM');
    const snapshot = [...rows.values()].map(row => ({ ...row }));
    if (platform === 'darwin' && lists === 1 && race === 'exit-before-inspect') change();
    return snapshot;
  }
  function environment(pid) {
    if (pid === 101 && ++helperReads === (late ? 2 : 1)) change();
    if (!rows.has(pid)) throw failure('ENOENT');
    if (pid === 101 && race === 'foreign') return `AUN_RUN_TOKEN=ee AUN_PROFILE_DIR=${f.record.userDataDir}`;
    if (pid !== 100 && !survivors) throw failure('EPERM');
    return `AUN_RUN_TOKEN=${f.record.runToken} AUN_PROFILE_DIR=${f.record.userDataDir}`;
  }
  async function signal(pid, signal) {
    signals.push({ pid, signal });
    if (pid < 0) { for (const row of rows.values()) if (row.pgid === -pid) rows.delete(row.pid); }
    else rows.delete(pid);
  }
  const command = row => `${row.executable} ${row.argv.slice(1).join(' ')}`.trim();
  const line = row => `${row.pid} ${row.ppid} ${row.pgid} ${row.startTime} ${row.uid} 0.2 1024 ${command(row)}`;
  const processAdapter = platform === 'darwin' ? darwinAdapter({ signal, async run(command, args) {
    if (args[0] === '-Aww') return { stdout: inventory().map(line).join('\n') };
    const pid = Number(args[args.indexOf('-p') + 1]);
    if (args[0] === '-Eww') {
      try { const env = environment(pid); return { stdout: `${pid} ${env}` }; }
      catch (error) { if (error.code === 'ENOENT') throw failure(1); throw error; }
    }
    if (!rows.has(pid)) throw failure(1);
    return { stdout: line(rows.get(pid)) };
  } }) : linuxAdapter({ signal, run: async () => ({ stdout: '100' }), fs: {
    async readdir() { return inventory().map(row => String(row.pid)); },
    async readlink(path) { const row = rows.get(Number(path.split('/')[2])); if (!row) throw failure('ENOENT'); return row.executable; },
    async readFile(path) {
      const pid = Number(path.split('/')[2]);
      if (path.endsWith('/environ')) return environment(pid).replaceAll(' ', '\0') + '\0';
      const row = rows.get(pid);
      if (!row) throw failure('ENOENT');
      if (path.endsWith('/stat')) return `${pid} (chrome) ${['S', row.ppid, row.pgid, ...Array(16).fill('0'), row.startTime, '0', '20'].join(' ')}`;
      if (path.endsWith('/cmdline')) return row.argv.join('\0') + '\0';
      if (path.endsWith('/status')) return `Uid: ${row.uid}\nVmRSS: 10 kB\n`;
      throw failure('ENOENT');
    }
  } });
  // Exit after the Linux inventory's per-PID stat reads finish.
  if (platform === 'linux' && race === 'exit-before-inspect') {
    const list = processAdapter.list;
    processAdapter.list = async () => {
      const result = await list();
      if (lists === 1) change();
      return result;
    };
  }
  return { ...f, processAdapter, rows, signals, listCount: () => lists, profileOptions: { home: '/user', env: {}, platform } };
}

for (const platform of ['darwin', 'linux']) {
  test(`GREEN ${platform} owned arrival converges with ancestry proof`, async () => {
    const f = await fixture(platform, 'arrival-owned');
    const groupDiagnostics = [];
    const members = await verifiedGroup(f.record, { ...f, groupDiagnostics });
    assert.deepEqual(members.map(row => row.pid), [100, 101, 102, 103]);
    assert.equal(groupDiagnostics.find(row => row.pid === 103).reason, 'helper-ancestry-verified');
    assert.equal(f.listCount(), 3);
  });

  for (const race of ['exit-before-inspect', 'exit-environment', 'reuse-outside']) test(`GREEN ${platform} ${race} drops the old helper and signals the owned group`, async () => {
    const f = await fixture(platform, race);
    assert.deepEqual((await verifiedGroup(f.record, f))?.map(row => row.pid).sort(), [100, 102]);
    assert.equal(f.listCount(), 3);
    const g = await fixture(platform, race);
    assert.equal((await signalOwned(g.record, { ...g, group: true })).sent, true);
    assert.deepEqual(g.signals, [{ pid: -100, signal: 'SIGTERM' }]);
    assert.ok(g.rows.has(900));
    if (race === 'reuse-outside') assert.ok(g.rows.has(101), 'replacement stays alive');
  });

  for (const race of ['reuse-inside', 'foreign', 'reparent', 'arrival', 'list-refused']) test(`RED ${platform} ${race} refuses the entire group`, async () => {
    const f = await fixture(platform, race);
    assert.equal((await signalOwned(f.record, { ...f, group: true })).sent, false);
    assert.deepEqual(f.signals, []);
    assert.ok(f.rows.has(100));
    assert.ok(f.rows.has(101));
    assert.ok(f.rows.has(900));
  });

  test(`GREEN ${platform} unreadable live helpers retain stable ancestry proof`, async () => {
    const f = await fixture(platform, 'stable');
    assert.equal((await signalOwned(f.record, { ...f, group: true })).sent, true);
    assert.deepEqual(f.signals, [{ pid: -100, signal: 'SIGTERM' }]);
    assert.equal(f.listCount(), 2);
    assert.ok(f.rows.has(900));
  });

  test(`GREEN ${platform} cleanup completes after a helper exits during its environment read`, async () => {
    const f = await fixture(platform, 'exit-environment');
    const result = await cleanup({ ...f, apply: true, termGraceMs: 0 });
    assert.equal(result.exitCode, 0);
    assert.deepEqual(result.browsers, { owned: 1, closed: 1 });
    assert.equal(result.remaining, 0);
    assert.equal(result.actions[0].profile.removed, true);
    assert.deepEqual(f.signals, [{ pid: -100, signal: 'SIGTERM' }]);
    assert.deepEqual([...f.rows.keys()], [900]);
  });

  for (const race of ['exit-before-inspect', 'exit-environment', 'reuse-outside']) test(`GREEN ${platform} survivor ${race} omits the old helper`, async () => {
    const f = await fixture(platform, race, { survivors: true });
    assert.deepEqual(await signalLeasedSurvivors(f.record, f), { sent: true, targets: [102] });
    assert.deepEqual(f.signals, [{ pid: 102, signal: 'SIGTERM' }]);
    assert.ok(f.rows.has(900));
    if (race === 'reuse-outside') assert.ok(f.rows.has(101));
  });

  for (const race of ['reuse-inside', 'foreign']) test(`RED ${platform} survivor ${race} sends no signal`, async () => {
    const f = await fixture(platform, race, { survivors: true });
    assert.equal((await signalLeasedSurvivors(f.record, f)).sent, false);
    assert.deepEqual(f.signals, []);
    assert.ok(f.rows.has(101));
    assert.ok(f.rows.has(102));
    assert.ok(f.rows.has(900));
  });

  for (const race of ['exit-environment', 'reuse-inside', 'reuse-outside']) test(`GREEN ${platform} late survivor ${race} signals only the unchanged helper`, async () => {
    const f = await fixture(platform, race, { survivors: true, late: true });
    assert.deepEqual(await signalLeasedSurvivors(f.record, f), { sent: true, targets: [102] });
    assert.deepEqual(f.signals, [{ pid: 102, signal: 'SIGTERM' }]);
    assert.ok(f.rows.has(900));
    if (race.startsWith('reuse')) assert.ok(f.rows.has(101), 'replacement stays alive');
  });
}
