import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import { resolve, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { config } from '../config.mjs';
import { generatedPack } from './pack.mjs';
import { generateDefaults } from './defaults.mjs';
import { generateDrivers } from './drivers.mjs';

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
    if (name === 'check/forbidden.local.txt' || name.startsWith('proof/runs/')) continue;
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
