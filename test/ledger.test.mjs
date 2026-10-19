import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeFs, leasedFixture } from './fixtures/hygiene/fakes.mjs';
import { createLedger, stampActivity, stateRoot } from '../src/hygiene/ledger.mjs';

test('GREEN ledger atomic writes use 0700/0600; RED concurrent lock fails closed', async () => {
  const f = await leasedFixture();
  assert.equal((await f.fs.lstat('/state')).mode, 0o700);
  assert.equal((await f.fs.lstat('/state/records/run1.json')).mode, 0o600);
  await f.ledger.withLock(async () => { await assert.rejects(f.ledger.write(f.record), /LEDGER_LOCKED/); });
  assert.equal((await f.ledger.read('run1')).id, 'run1');
  assert.deepEqual([...f.fs.entries.keys()].filter(path => path.endsWith('.tmp')), []);
});

test('RED ledger symlink, mode, owner and traversal fail; GREEN read-only missing state writes nothing', async () => {
  const fs = fakeFs(); const ledger = createLedger({ root: '/state', fs });
  assert.deepEqual(await ledger.list(), []); assert.equal(fs.writes.length, 0);
  await fs.mkdir('/elsewhere', { mode: 0o700 }); await fs.symlink('/elsewhere', '/state');
  await assert.rejects(ledger.initialize(), /LEDGER_SYMLINK/);
  const f = await leasedFixture();
  await assert.rejects(f.ledger.read('../other'), /LEDGER_ID/);
  f.fs.entries.get('/state/records/run1.json').mode = 0o644;
  await assert.rejects(f.ledger.read('run1'), /LEDGER_MODE/);
  f.fs.entries.get('/state/records/run1.json').mode = 0o600;
  f.fs.entries.get('/state/records/run1.json').uid += 1;
  await assert.rejects(f.ledger.read('run1'), /LEDGER_OWNER/);
});

test('RED stamps for another host leave lease unchanged; GREEN exact host driver renews', async () => {
  const f = await leasedFixture();
  await stampActivity({ ...f, sessionKey: 'session-1', hostPid: 51, hostStartTime: 'start-51', driverId: 'fixture-driver' });
  assert.equal((await f.ledger.read('run1')).lastActivity, 0);
  await stampActivity({ ...f, sessionKey: 'session-1', hostPid: 50, hostStartTime: 'start-50', driverId: 'fixture-driver' });
  assert.equal((await f.ledger.read('run1')).lastActivity, 400000);
  assert.equal((await f.ledger.read('run1')).leaseRenewedAt, 400000);
});

test('ledger roots follow platform state locations and the configured name', () => {
  assert.equal(stateRoot({ platform: 'linux', env: { XDG_STATE_HOME: '/state' }, home: '/user', name: 'pack' }), '/state/pack');
  assert.equal(stateRoot({ platform: 'darwin', env: {}, home: '/user', name: 'pack' }), '/user/Library/Application Support/pack');
});
