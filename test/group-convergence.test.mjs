import test from 'node:test';
import assert from 'node:assert/strict';
import { GROUP_VERIFY_SNAPSHOTS, signalOwned } from '../src/proc/signals.mjs';
import { cleanup } from '../src/hygiene/cleanup.mjs';
import { leasedFixture, processRow } from './fixtures/hygiene/fakes.mjs';

async function fixture(platform, { start = 1, foreign = false, churn = false, mutate = () => {} } = {}) {
  const f = await leasedFixture({ budgets: { rssBytes: 5 } });
  const adapter = f.processAdapter;
  adapter.platform = platform;
  adapter.state.delete(50);
  const sentinel = processRow(900, { argv: ['/test/chrome', '--user-data-dir=/user/profile'] });
  adapter.state.set(sentinel.pid, sentinel);
  const list = adapter.list;
  let lists = 0;
  adapter.list = async () => {
    const step = ++lists - start + 1;
    if (step > 0 && (churn || step <= 3)) {
      const pid = 100 + step;
      adapter.state.set(pid, processRow(pid, { ppid: step === 1 ? 100 : pid - 1, pgid: 100 }));
      if (foreign && step === 2) adapter.tokens.set(pid, { runToken: 'e'.repeat(48), profilePath: f.record.userDataDir });
      if (foreign && step === 3) { adapter.state.delete(102); adapter.state.get(pid).ppid = 101; }
    }
    await mutate({ adapter, lists, step });
    const rows = await list();
    return lists % 2 ? rows : rows.reverse();
  };
  return { ...f, listCount: () => lists, sleep: async () => {}, sentinel };
}

for (const platform of ['darwin', 'linux']) {
  test(`GREEN ${platform} arrivals across three snapshots then stable signal only the leased group`, async () => {
    const f = await fixture(platform);
    const result = await signalOwned(f.record, { ...f, group: true });
    assert.equal(result.sent, true);
    assert.equal(f.listCount(), 4);
    assert.deepEqual(f.processAdapter.signals, [{ pid: -100, signal: 'SIGTERM' }]);
    assert.deepEqual(f.processAdapter.state.get(900), f.sentinel);
  });

  test(`RED ${platform} foreign-token arrival mid-loop refuses even after departure`, async () => {
    const f = await fixture(platform, { foreign: true });
    const result = await signalOwned(f.record, { ...f, group: true });
    assert.equal(result.sent, false);
    assert.equal(result.reason, 'group-unverified');
    assert.equal(result.group.find(row => row.pid === 102).reason, 'foreign-token');
    assert.equal(result.group.find(row => row.pid === 102).verdict, 'refused');
    assert.equal(f.processAdapter.state.has(102), false);
    assert.deepEqual(f.processAdapter.signals, []);
  });

  test(`RED ${platform} never-stable membership stops at the snapshot bound with members listed`, async () => {
    const f = await fixture(platform, { churn: true });
    const result = await signalOwned(f.record, { ...f, group: true });
    assert.equal(result.sent, false);
    assert.equal(f.listCount(), GROUP_VERIFY_SNAPSHOTS);
    assert.deepEqual(result.group.map(row => row.pid).sort((a, b) => a - b), Array.from({ length: GROUP_VERIFY_SNAPSHOTS + 1 }, (_, i) => 100 + i));
    assert.ok(result.group.every(row => row.verdict === 'refused' && row.reason === 'group-unstable'));
    assert.equal(result.group.find(row => row.pid === 100 + GROUP_VERIFY_SNAPSHOTS).unstable, true);
    assert.deepEqual(f.processAdapter.signals, []);
  });

  test(`RED ${platform} changed start time during convergence retains the first identity`, async () => {
    const f = await fixture(platform, { mutate({ adapter, step }) {
      if (step === 3) adapter.state.get(101).startTime = 'reused';
    } });
    const result = await signalOwned(f.record, { ...f, group: true });
    assert.equal(result.sent, false);
    assert.equal(result.group.find(row => row.pid === 101).reason, 'start-time-changed');
    assert.deepEqual(f.processAdapter.signals, []);
  });

  test(`RED ${platform} configured grace bounds churn before the snapshot cap`, async t => {
    let at = 0;
    t.mock.method(performance, 'now', () => at);
    const f = await fixture(platform, { churn: true, mutate({ lists }) { if (lists === 2) at = 101; } });
    const result = await signalOwned(f.record, { ...f, group: true, termGraceMs: 100 });
    assert.equal(result.sent, false);
    assert.equal(f.listCount(), 2);
    assert.equal(result.group.find(row => row.pid === 102).unstable, true);
    assert.deepEqual(f.processAdapter.signals, []);
  });

  for (const mode of ['cleanup', 'idle', 'orphans', 'budget']) {
    for (const [stage, start] of [['preflight', 2], ['signal', 4]]) {
      test(`GREEN ${platform} ${mode} ${stage} converges after three arriving snapshots`, async () => {
        const f = await fixture(platform, { start });
        const result = await cleanup({ ...f, mode, apply: true, termGraceMs: 1000 });
        assert.equal(result.exitCode, 0, JSON.stringify(result));
        assert.equal(result.browsers.closed, 1);
        assert.equal(result.remaining, 0);
        assert.equal(result.actions[0].profile.removed, true);
        assert.deepEqual(f.processAdapter.signals, [{ pid: -100, signal: 'SIGTERM' }]);
        assert.deepEqual(f.processAdapter.state.get(900), f.sentinel);
      });

      for (const foreign of [true, false]) test(`RED ${platform} ${mode} ${stage} ${foreign ? 'foreign-token arrival' : 'never-stable membership'} refuses all signals`, async () => {
        const f = await fixture(platform, { start, foreign, churn: !foreign });
        const result = await cleanup({ ...f, mode, apply: true, termGraceMs: 1000 });
        assert.equal(result.exitCode, 3);
        assert.equal(result.remaining, 1);
        assert.equal(result.actions[0].signal.sent, false);
        assert.equal(result.actions[0].escalation, undefined);
        const group = result.actions[0].signal.group;
        assert.equal(group.find(row => row.pid === 102).reason, foreign ? 'foreign-token' : 'group-unstable');
        if (!foreign) assert.equal(group.find(row => row.pid === 100 + GROUP_VERIFY_SNAPSHOTS).unstable, true);
        assert.deepEqual(f.processAdapter.signals, []);
        assert.equal(f.fs.entries.has(f.record.userDataDir), true);
        assert.deepEqual(f.processAdapter.state.get(900), f.sentinel);
      });
    }
  }
}
