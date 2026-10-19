import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { config } from '../src/config.mjs';
import { digest, files, read, generated } from '../src/build/bundle.mjs';
import { normalize } from '../src/build/validate.mjs';

const root = process.cwd(), args = process.argv.slice(2);
if (args[0] === 'terms') {
  const terms = readFileSync(join(root, 'check/forbidden.local.txt'), 'utf8').split(/\r?\n/).map(normalize).filter(Boolean);
  if (terms.some(t => /\baun-[a-z]/.test(t))) throw Error('Public names cannot be banned');
  writeFileSync(join(root, 'check/terms.private.sha256'), [...new Set(terms.map(digest))].sort().join('\n') + '\n');
} else {
  const { core, manifest } = config(root);
  if (args[0] === '--rehash') {
    manifest.assets = files(root, core).filter(p => !p.endsWith('/manifest.json')).map(p => ({ path: p.slice(core.length + 1), active: true, sha256: digest(read(root, p)) }));
    writeFileSync(join(root, core, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  } else if (args.length) throw Error('Usage: build.mjs [--rehash|terms]');
  for (const [name, body] of Object.entries(generated(root))) {
    mkdirSync(dirname(join(root, name)), { recursive: true }); writeFileSync(join(root, name), body);
  }
}
