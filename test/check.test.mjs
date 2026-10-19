import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { check, contentIssues, normalize, termMatches } from '../src/build/validate.mjs';
import { digest, files } from '../src/build/bundle.mjs';
import { spawnSync } from 'node:child_process';
import { linkIssues } from '../src/build/inherited.mjs';
test('private hash detector refuses whole terms and phrases, allows substrings and public names', () => {
  const hashes=new Set([digest(normalize('example-private')),digest(normalize('sample command'))]);
  assert.equal(termMatches('EXAMPLE-private',hashes).length,1);
  assert.equal(termMatches('sample\ncommand',hashes).length,1);
  assert.equal(termMatches('prefixexample-private',hashes).length,0);
  assert.equal(termMatches('aun-example-private',hashes).length,0);
});
test('privacy and voice have refusing and valid controls', () => {
  assert.ok(contentIssues('note.md',['/','Users','/','fixture','/','private'].join('')).some(s=>s.startsWith('PRIVACY:')));
  assert.ok(contentIssues('note.md',String.fromCharCode(0x2014)).some(s=>s.startsWith('VOICE:')));
  assert.deepEqual(contentIssues('note.md','Auny LLC, AunySillyMe and Claude Code'),[]);
  const ticket=['A','UN','-','123'].join('');
  assert.ok(contentIssues(`docs/${ticket}.png`,'').some(s=>s.startsWith('PRIVACY_NAME:')));
  assert.deepEqual(contentIssues('docs/public-brand.png',''),[]);
});
test('renamed tree passes NAME_PARAM and all current checks without local private sources', () => {
  mkdirSync('.test-work',{recursive:true});
  const root=mkdtempSync(resolve('.test-work/rename-'));
  try {
    for (const name of files(process.cwd())) { mkdirSync(join(root,name,'..'),{recursive:true}); cpSync(name,join(root,name)); }
    const p=JSON.parse(readFileSync(join(root,'package.json'),'utf8')), old=p.name;
    p.name='example-browser-pack'; p.bin={[p.name]:Object.values(p.bin)[0]}; writeFileSync(join(root,'package.json'),JSON.stringify(p));
    renameSync(join(root,'skills',old),join(root,'skills',p.name));
    const path=join(root,'skills',p.name,'manifest.json'), m=JSON.parse(readFileSync(path,'utf8')); m.skillName=p.name; writeFileSync(path,JSON.stringify(m));
    const pp=join(root,'.claude-plugin/plugin.json'), plugin=JSON.parse(readFileSync(pp,'utf8')); plugin.name=p.name; writeFileSync(pp,JSON.stringify(plugin));
    for (const name of files(root).filter(n=>n.endsWith('.md') || n==='llms.txt')) writeFileSync(join(root,name),readFileSync(join(root,name),'utf8').replaceAll(old,p.name));
    const ledgerPath=join(root,'docs/evidence/content-review.json'), ledger=JSON.parse(readFileSync(ledgerPath,'utf8'));
    for (const [name,entry] of Object.entries(ledger.files)) entry.sha256=digest(readFileSync(join(root,name)));
    writeFileSync(ledgerPath,JSON.stringify(ledger));
    assert.equal(spawnSync(process.execPath,['scripts/build.mjs','--rehash'],{cwd:root,encoding:'utf8'}).status,0);
    assert.deepEqual(check(root).issues,[]);
    const built=spawnSync(process.execPath,['scripts/build.mjs'],{cwd:root,encoding:'utf8'});
    assert.equal(built.status,0,built.stderr);
    assert.ok(check(root,{release:true}).issues.some(s=>s.includes('stub remains')));
  } finally { rmSync(root,{recursive:true,force:true}); }
});
test('LINK validates local files and headings with a refusing case',()=>{
  assert.deepEqual(linkIssues(process.cwd(),'README.md','[Build](AGENTS.md#build-steps)'),[]);
  assert.ok(linkIssues(process.cwd(),'README.md','[Build](AGENTS.md#absent-heading)').some(s=>s.startsWith('LINK:')));
  assert.ok(linkIssues(process.cwd(),'README.md','[Build](absent-file.md)').some(s=>s.startsWith('LINK:')));
});
test('private hash matches remain correct when the caller updates its set',()=>{
  const hashes=new Set([digest(normalize('example-private'))]);
  assert.equal(termMatches('second-private',hashes).length,0);
  hashes.add(digest(normalize('second-private')));
  assert.equal(termMatches('second-private',hashes).length,1);
});
