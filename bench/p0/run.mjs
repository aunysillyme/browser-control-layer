import { readFile, mkdir, appendFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cpus, totalmem, platform, release } from 'node:os';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cases, runP0, summarize, writeArtifacts, REPEATS, IDLE_MS } from './index.mjs';
import { createRuntime, requireCi } from './runtime.mjs';
import { selectVersions, verifyInstalled } from './versions.mjs';

export async function main(args = process.argv.slice(2)) {
  let out = resolve('proof/runs/p0');
  let repeats = REPEATS;
  let versionFile;
  let ci = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--ci') ci = true;
    else if (args[i] === '--out') out = resolve(args[++i]);
    else if (args[i] === '--n') repeats = Number(args[++i]);
    else if (args[i] === '--versions') versionFile = resolve(args[++i]);
    else throw new Error(`P0_ARGUMENT: ${args[i]}`);
  }
  if (!ci) throw new Error('P0_CI_ONLY: pass --ci inside GitHub Actions');
  requireCi();
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const catalog = JSON.parse(await readFile(join(root, 'bench/drivers.json'), 'utf8'));
  const items = cases(catalog, repeats);
  await mkdir(out, { recursive: true, mode: 0o700 });
  await writeFile(join(out, 'partial.jsonl'), '', { mode: 0o600 });
  const observed = [];
  const metadata = {
    schemaVersion: 1, commit: process.env.GITHUB_SHA ?? null, repeats, idle_ms: IDLE_MS,
    variants: [...new Set(items.map(item => item.variant.id))],
    machine: { os: platform(), release: release(), cpu: cpus()[0]?.model, ram_bytes: totalmem() },
    command: `node bench/p0/run.mjs --ci --n ${repeats} --out proof/runs/p0 --versions proof/runs/p0/install-versions.json`,
    ownership_recipes: 'CI_PENDING'
  };
  let verdict = summarize([], items.length);
  try {
    if (!versionFile) throw new Error('P0_VERSIONS: --versions must name the CI exact-version receipt');
    const versionText = await readFile(versionFile, 'utf8');
    const versions = selectVersions(catalog, JSON.parse(versionText));
    metadata.install_versions = versions;
    metadata.install_receipt_sha256 = createHash('sha256').update(versionText).digest('hex');
    const installed = {};
    for (const name of Object.keys(versions)) installed[name] = JSON.parse(await readFile(join(root, 'node_modules', name, 'package.json'), 'utf8')).version;
    verifyInstalled(versions, installed);
    const puppeteer = await import('puppeteer');
    const browserPath = puppeteer.executablePath();
    const chrome = await promisify(execFile)(browserPath, ['--version']);
    metadata.chrome = chrome.stdout.trim();
    const adapter = await createRuntime({ root, versions: { ...versions, chrome: metadata.chrome }, browserPath });
    const rows = await runP0(adapter, catalog, { repeats, onRow: async row => {
      observed.push(row);
      await appendFile(join(out, 'partial.jsonl'), JSON.stringify(row) + '\n', { mode: 0o600 });
    } });
    verdict = summarize(rows, items);
    await writeArtifacts(out, rows, metadata, verdict);
  } catch (error) {
    observed.push({ schemaVersion: 1, suite: 'HARNESS', status: 'failed', error: { name: error.name, message: error.message, stack: error.stack } });
    await writeArtifacts(out, observed, metadata, verdict);
    console.error(error.stack);
  }
  console.log(verdict.line);
  return verdict.status === 'measured' ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(code => { process.exitCode = code; }).catch(error => { console.error(error.stack); process.exitCode = 1; });
}
