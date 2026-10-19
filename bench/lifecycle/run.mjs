import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createLedger } from '../../src/hygiene/ledger.mjs';
import { startLease, refreshLease } from '../../src/hygiene/lease.mjs';
import { cleanup } from '../../src/hygiene/cleanup.mjs';
import { processAdapter } from '../../src/proc/table.mjs';
import { reap } from '../../src/hygiene/reap.mjs';

// This file is deliberately outside the default test discovery paths.
if (process.env.CI !== 'true' || !process.argv.includes('--ci')) throw new Error('CI_REQUIRED: real browser lifecycle runs in CI only');
const { default: puppeteer } = await import('puppeteer');
const output = resolve('proof/runs/lifecycle');
await fs.mkdir(output, { recursive: true });
const root = await fs.mkdtemp(join(output, 'run-'));
const ledger = createLedger({ root: join(root, 'state') });
const adapter = processAdapter();
const raw = [];
let sentinel;
const launched = [];
let wrongKills = 0;
const originalSignal = adapter.signal;
adapter.signal = async (target, signal) => {
  const allowed = launched.some(item => target === item.record.pid || target === -item.record.pgid);
  if (!allowed || sentinel && Math.abs(target) === sentinel.process().pid) { wrongKills++; throw new Error('WRONG_KILL: target not launched by this lifecycle fixture'); }
  return originalSignal(target, signal);
};
async function sentinelProof() {
  assert.ok(await adapter.inspect(sentinel.process().pid), 'sentinel process survives');
  const pages = await sentinel.pages();
  assert.equal(pages.length, 2, 'sentinel retains both tabs');
  assert.ok(pages.every(page => page.url() === 'about:blank'));
}
try {
  sentinel = await puppeteer.launch({ headless: true, userDataDir: join(root, 'sentinel'), args: ['--no-sandbox'] });
  await sentinel.newPage();
  await sentinelProof();
  for (const mode of ['cleanup', 'idle', 'orphans', 'budget']) {
    const options = { ledger, processAdapter: adapter, sessionKey: `fixture-${mode}`, driverId: 'aun-lease', termGraceMs: 1000, idleSeconds: 0, budgets: mode === 'budget' ? { rssBytes: 0 } : {} };
    const started = await startLease([puppeteer.executablePath(), '--user-data-dir={profile}', '--headless=new', '--no-sandbox', '--remote-debugging-port=0', 'about:blank'], options);
    assert.equal(started.verified, true, 'launched browser identity verified');
    launched.push(started);
    await new Promise(resolve => setTimeout(resolve, 200));
    await refreshLease(started.record, options);
    if (mode === 'orphans') await ledger.update(started.record.id, old => ({ ...old, hostStartTime: 'fixture-owner-ended' }));
    const result = mode === 'cleanup' ? await cleanup({ ...options, apply: true }) : await reap({ ...options, mode });
    await started.completion;
    await sentinelProof();
    assert.equal(result.remaining, 0, JSON.stringify(result));
    assert.equal((await ledger.read(started.record.id)).profileRemoved, true, 'throwaway profile removed');
    raw.push({ suite: 'H4', mode, subject: 'package', wrongKills, remaining: result.remaining, sentinelTabs: 2, status: 'passed', platform: process.platform, commit: process.env.GITHUB_SHA, at: new Date().toISOString() });
  }
} catch (error) {
  raw.push({ suite: 'H4', status: 'failed', wrongKills, error: { name: error.name, message: error.message, stack: error.stack } });
  process.exitCode = 1;
} finally {
  for (const item of launched) await cleanup({ ledger, processAdapter: adapter, sessionKey: item.record.sessionKey, apply: true, termGraceMs: 1000 }).catch(error => raw.push({ cleanupError: error.message }));
  // The harness owns the sentinel and closes it only after its survival checks.
  if (sentinel) await sentinel.close();
  const text = raw.map(row => JSON.stringify(row)).join('\n') + '\n';
  await fs.writeFile(join(output, 'rows.jsonl'), text);
  await fs.writeFile(join(output, 'rows.sha256'), createHash('sha256').update(text).digest('hex') + '\n');
  process.stdout.write(`H4: wrongKills=${wrongKills} status=${process.exitCode ? 'failed' : 'passed'}\n`);
}
