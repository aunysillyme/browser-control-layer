import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const IDLE_MS = 600_000;
export const REPEATS = 10;

export function cases(catalog, repeats = REPEATS) {
  if (!Number.isInteger(repeats) || repeats < 1) throw new Error('P0_REPEATS: positive integer required');
  return catalog.drivers.flatMap(driver => driver.variants.flatMap(variant =>
    Array.from({ length: repeats }, (_, repeat) => ({ driver, variant, repeat: repeat + 1 }))));
}

export async function measure(adapter, item, suite, options = {}) {
  const start = adapter.now();
  let handle;
  const row = {
    schemaVersion: 1, suite, subject: 'baseline', arm: 'baseline',
    driver: item.driver.id, variant: item.variant.id, repeat: item.repeat,
    measured_at: new Date(start).toISOString(), status: 'failed'
  };
  try {
    if (!['H1', 'H2'].includes(suite)) throw new Error(`P0_SUITE: unsupported suite ${suite}`);
    handle = await adapter.start(item);
    row.versions = handle.versions;
    const before = await adapter.probe(handle);
    if (!before.browserRoots.length) throw new Error('P0_LAUNCH: browser root was not independently observed');
    row.before = before;
    if (suite === 'H1') {
      await adapter.endOwner(handle);
      await adapter.wait(options.settleMs ?? 3_000);
    } else if (suite === 'H2') {
      const idleStart = adapter.now();
      await adapter.wait(options.idleMs ?? IDLE_MS);
      row.idle_ms = adapter.now() - idleStart;
      if (row.idle_ms < (options.idleMs ?? IDLE_MS)) throw new Error('P0_CLOCK: idle observation ended early');
    } else throw new Error(`P0_SUITE: unsupported suite ${suite}`);
    row.after = await adapter.probe(handle);
    row.leftover_browser_roots = row.after.browserRoots.length;
    row.leftover_processes = row.after.processes.length;
    row.status = 'measured';
  } catch (error) {
    handle ??= error.handle;
    row.error = { name: error.name, message: error.message, stack: error.stack };
  } finally {
    if (handle) {
      try { row.cleanup = await adapter.cleanup(handle); }
      catch (error) {
        row.status = 'failed';
        row.cleanup_error = { name: error.name, message: error.message, stack: error.stack };
      }
      if (row.cleanup?.remaining?.length) {
        row.status = 'failed';
        row.cleanup_error = { name: 'Error', message: 'P0_CLEANUP: observed owned processes remain' };
      }
    }
    row.elapsed_ms = adapter.now() - start;
  }
  return row;
}

export async function runP0(adapter, catalog, options = {}) {
  const items = cases(catalog, options.repeats ?? REPEATS);
  const concurrency = options.concurrency ?? 4;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) throw new Error('P0_CONCURRENCY: choose 1 through 4');
  const rows = [];
  // Different variants run together; a repeat gets its own profile and owner.
  for (const suite of ['H1', 'H2']) {
    const queue = [...items];
    await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      while (queue.length) {
        const row = await measure(adapter, queue.shift(), suite, options);
        rows.push(row);
        await options.onRow?.(row);
      }
    }));
  }
  return rows.sort((a, b) => a.suite.localeCompare(b.suite) || a.variant.localeCompare(b.variant) || a.repeat - b.repeat);
}

export function summarize(rows, expected) {
  const expectedCases = Array.isArray(expected) ? expected.length : expected;
  const complete = Number.isInteger(expectedCases) && expectedCases > 0 && ['H1', 'H2'].every(suite => rows.filter(row => row.suite === suite).length === expectedCases);
  const keys = rows.map(row => `${row.suite}/${row.variant}/${row.repeat}`);
  const expectedKeys = Array.isArray(expected) ? new Set(['H1', 'H2'].flatMap(suite => expected.map(item => `${suite}/${item.variant.id}/${item.repeat}`))) : null;
  const valid = rows.every(row => ['H1', 'H2'].includes(row.suite) && row.status === 'measured' &&
    Number.isInteger(row.leftover_browser_roots) && row.leftover_browser_roots >= 0 &&
    Number.isInteger(row.leftover_processes) && row.leftover_processes >= 0);
  if (!complete || !valid || new Set(keys).size !== keys.length || (expectedKeys && keys.some(key => !expectedKeys.has(key)))) {
    return { status: 'failed', lead: null, line: 'P0 INCONCLUSIVE: complete measured H1 and H2 rows are required' };
  }
  const orphans = rows.filter(row => row.suite === 'H1').some(row => row.leftover_processes > 0);
  return {
    status: 'measured', lead: orphans ? 'hygiene' : 'idle-cost',
    line: orphans ? 'P0: hygiene leads' : 'P0: lead switches to idle + cost'
  };
}

export async function writeArtifacts(out, rows, metadata, verdict) {
  await mkdir(out, { recursive: true, mode: 0o700 });
  const raw = rows.map(row => JSON.stringify(row)).join('\n') + '\n';
  const sha256 = createHash('sha256').update(raw).digest('hex');
  await writeFile(join(out, 'raw.jsonl'), raw, { mode: 0o600 });
  await writeFile(join(out, 'raw.sha256'), `${sha256}  raw.jsonl\n`, { mode: 0o600 });
  await writeFile(join(out, 'metadata.json'), JSON.stringify({ ...metadata, raw: { path: 'raw.jsonl', sha256 } }, null, 2) + '\n', { mode: 0o600 });
  await writeFile(join(out, 'verdict.txt'), `${verdict.line}\n`, { mode: 0o600 });
  return sha256;
}
