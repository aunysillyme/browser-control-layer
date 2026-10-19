import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { config } from '../src/config.mjs';
import { digest, files, read, generated } from '../src/build/bundle.mjs';
import { normalize } from '../src/build/validate.mjs';
import { stageRoutes } from '../src/build/manifest.mjs';

const root = process.cwd(), args = process.argv.slice(2);
if (args[0] === 'terms') {
  const terms = readFileSync(join(root, 'check/forbidden.local.txt'), 'utf8').split(/\r?\n/).map(normalize).filter(Boolean);
  if (terms.some(t => /\baun-[a-z]/.test(t))) throw Error('Public names cannot be banned');
  writeFileSync(join(root, 'check/terms.private.sha256'), [...new Set(terms.map(digest))].sort().join('\n') + '\n');
} else {
  if (args.length && (args.length!==1 || args[0]!=='--rehash')) throw Error('Usage: build.mjs [--rehash|terms]');
  const { core, manifest } = config(root);
  const reviewPath='docs/evidence/content-review.json';
  const review=existsSync(join(root,reviewPath)) ? JSON.parse(read(root,reviewPath)) : {files:{}};
  for (const [name, body] of Object.entries(generated(root))) {
    const prior=existsSync(join(root,name)) ? read(root,name) : '';
    const entry=review.files[name];
    if ((name==='README.md' || name.startsWith('docs/')) && name.endsWith('.md') && (prior.startsWith('<!-- stub:') || entry?.sha256===digest(prior))) {
      review.files[name]={...entry,sha256:digest(body),disposition:'WAIVED',reason:entry?.disposition==='WAIVED' && entry.reason ? entry.reason : 'Generated from repository sources; independent content review remains a release task.'};
    }
    if (prior!==body) { mkdirSync(dirname(join(root, name)), { recursive: true }); writeFileSync(join(root, name), body); }
  }
  writeFileSync(join(root,reviewPath),JSON.stringify(review,null,2)+'\n');
  if (args[0] === '--rehash') {
    manifest.assets = files(root, core).filter(p => !p.endsWith('/manifest.json')).map(p => ({ path: p.slice(core.length + 1), active: true, sha256: digest(read(root, p)) }));
    if (!read(root, `${core}/SKILL.md`).startsWith('<!-- stub:')) manifest.stageRoutes = stageRoutes(read(root, `${core}/SKILL.md`));
    manifest.claims = [{kind:'runner',path:'agents/aun-runner-browser.md'}, {kind:'hooks',path:'hooks/hooks.json'}];
    writeFileSync(join(root, core, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  }
}
