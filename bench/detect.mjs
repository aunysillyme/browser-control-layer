import { readFileSync, existsSync } from 'node:fs';
import { join, delimiter, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT } from '../src/config.mjs';

export function detectDrivers({ root = ROOT, installRoot = process.cwd(), path = process.env.PATH || '', platform = process.platform, exists = existsSync, read = file => JSON.parse(readFileSync(file, 'utf8')), probe = command => execFileSync(command, ['--version'], { encoding: 'utf8', timeout: 5000, windowsHide: true }) } = {}) {
  const catalog = read(join(root, 'bench/drivers.json'));
  return [...catalog.drivers, { ...catalog.browser, id: 'puppeteer', command: null }].map(driver => {
    const metadata = [installRoot,root].map(base => join(base,'node_modules',...driver.package.split('/'),'package.json')).find(file => exists(file));
    let installedVersion = null, executable = null;
    if (metadata) { installedVersion = read(metadata).version; const base = metadata.slice(0,metadata.indexOf('node_modules')); executable = driver.command ? join(base, 'node_modules', '.bin', driver.command + (platform === 'win32' ? '.cmd' : '')) : metadata; }
    if (!executable && driver.command) for (const dir of path.split(delimiter).filter(Boolean)) {
      const candidate = resolve(dir, driver.command + (platform === 'win32' ? '.cmd' : ''));
      if (!exists(candidate)) continue;
      executable = candidate; try { installedVersion = probe(candidate).match(/\b\d+\.\d+\.\d+(?:-[\w.]+)?\b/)?.[0] || null; } catch { /* An unreadable driver is reported, never installed. */ }
      break;
    }
    return { id: driver.id, package: driver.package, pinnedVersion: driver.version, installedVersion, executable, metadata, installed: Boolean(executable), matches: installedVersion === driver.version, install: driver.install || `npm install --save-dev ${driver.package}@${driver.version}`, source: driver.source };
  });
}
export function formatDetection(rows) { return rows.map(row => row.installed ? `${row.id}: ${row.installedVersion || 'UNVERIFIED'}${row.matches ? '' : ` (pinned version differs; use ${row.install})`}` : `${row.id}: install with ${row.install}`).join('\n'); }
