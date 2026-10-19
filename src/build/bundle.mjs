import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import { resolve, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { config } from '../config.mjs';
import { generatedPack } from './pack.mjs';
import { generateDefaults } from './defaults.mjs';

export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export function owned(root, name) {
  if (typeof name !== 'string' || name.includes('\\') || name.startsWith('/') || /^[A-Za-z]:/.test(name)) throw Error('invalid owned path');
  const base = resolve(root), full = resolve(base, name);
  if (full !== base && !full.startsWith(base + sep)) throw Error('path escapes repository');
  let part = base;
  if (lstatSync(base).isSymbolicLink()) throw Error('symlink root');
  for (const segment of relative(base, full).split(sep).filter(Boolean)) {
    part = resolve(part, segment);
    if (lstatSync(part).isSymbolicLink()) throw Error('symlink path');
  }
  return full;
}
export function files(root, directory = '') {
  const out = [];
  for (const item of readdirSync(owned(root, directory || '.'), { withFileTypes: true }).sort((a,b) => a.name.localeCompare(b.name, 'en'))) {
    if (['.git', 'node_modules', '.venv', 'dist', 'build', '.test-work', '.build-local', '.test-runs'].includes(item.name) && directory !== 'src') continue;
    const name = directory ? `${directory}/${item.name}` : item.name;
    if (name === 'check/forbidden.local.txt') continue;
    if (item.isSymbolicLink()) throw Error(`symlink in public tree: ${name}`);
    if (item.isDirectory()) out.push(...files(root, name));
    else if (item.isFile()) out.push(name);
  }
  return out;
}
export const read = (root, name) => readFileSync(owned(root, name), 'utf8');
export function generated(root) {
  const { core, manifest } = config(root), output = {};
  for (const [name, members] of Object.entries(manifest.bundles || {})) {
    if (!/^[a-z-]+$/.test(name)) throw Error('invalid bundle name');
    output[`docs/bundles/${name}.md`] = members.map(member => {
      if (!manifest.assets.some(a => a.path === member && a.active)) throw Error('inactive bundle member');
      return `<!-- source: ${member} -->\n${read(root, `${core}/${member}`)}`;
    }).join('\n');
  }
  return {...output,...generateDefaults(root),...generateDrivers(root),...generatedPack(root)};
}

export function generateDrivers(root) {
  const { core }=config(root), data=JSON.parse(read(root,'bench/drivers.json'));
  const rows=[...data.drivers,data.browser];
  const cell=value=>String(value).replaceAll('|','&#124;').replace(/[\r\n]/g,' ');
  const body='# Installed browser drivers\n\nGenerated from `bench/drivers.json`. The benchmark detects installed tools and prints vendor install commands. Pins are test conditions; the registry verification label is `'+data.verification+'`.\n\n| Driver | Pin | Source |\n|---|---|---|\n'+rows.map(row=>`| ${cell(row.package)} | ${cell(row.version)} | [Vendor](${cell(row.source)}) |`).join('\n')+'\n';
  return {[`${core}/references/drivers.md`]:body};
}
