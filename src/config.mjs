import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export function config(root = ROOT) {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const skillName = pkg.name.split('/').at(-1);
  const core = `skills/${skillName}`;
  const manifest = JSON.parse(readFileSync(join(root, core, 'manifest.json'), 'utf8'));
  return { root: resolve(root), pkg, core, manifest, name: pkg.name, skillName };
}
