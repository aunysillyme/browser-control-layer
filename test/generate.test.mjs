import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { config } from '../src/config.mjs';
import { catalog,renderRunner } from '../src/install/catalog.mjs';
import { proofBlock,generatedPack } from '../src/build/pack.mjs';
import { generateDrivers } from '../src/build/drivers.mjs';
const cfg=config(), template=readFileSync(`${cfg.core}/runners/aun-runner-browser.template.md`,'utf8');
test('all host runners replace exactly supported fields and fit budget',()=>{
  for(const host of catalog(cfg)) {
    const result=renderRunner(template,host,'renamed-tool');
    assert.ok(Buffer.byteLength(result)<=4096); assert.ok(!result.includes('{{'));
    assert.ok(result.includes('renamed-tool read')); assert.ok(result.includes(host.name));
  }
  assert.throws(()=>renderRunner(template+' {{OTHER}}',catalog(cfg)[0],'x'),/four/);
  assert.throws(()=>renderRunner(template,catalog(cfg)[0],'x'.repeat(5000)),/RUNNER_SIZE/);
});
const row={id:'H1',subject:'package',claim:'Owned processes remaining',median:0,unit:'processes',command:'tool bench hygiene',measured_at:'2026-01-01',expires_at:'2027-01-01',raw:{path:'proof/raw.jsonl',sha256:'a'.repeat(64)}};
test('proof renders only package rows, drops expired rows, limits rows and binds date and command',()=>{
  const warnings=[]; const result=proofBlock([{...row,subject:'default',id:'R1'}, {...row,expires_at:'2020-01-01'},row,{...row,id:'H2'},{...row,id:'H3'},{...row,id:'H4'}],{now:Date.parse('2026-02-01'),warn:s=>warnings.push(s)});
  assert.ok(!result.includes('R1')); assert.ok(!result.includes('H4')); assert.equal(warnings.length,1);
  assert.ok(result.includes(row.measured_at)); assert.ok(result.includes(row.command));
  assert.throws(()=>proofBlock([{...row,raw:{}}],{now:0}),/PROOF_BINDING/);
  assert.ok(!proofBlock([{...row,id:'E2'}],{now:0}).includes('| E2 |'));
  assert.ok(proofBlock([{...row,id:'E2',claim_eligible:true}],{now:0}).includes('| E2 |'));
});
test('generated surfaces preserve README prose and produce plugin runner and llms index',()=>{
  const out=generatedPack(process.cwd());
  assert.ok(out['README.md'].includes('<!-- credits:start -->'));
  assert.ok(out['README.md'].includes('<!-- proof:start'));
  assert.ok(out['llms.txt'].includes(`${cfg.core}/SKILL.md`));
  assert.ok(out['agents/aun-runner-browser.md'].includes('Claude Code'));
});
test('renamed package drives catalog, commands, links and runner generation',async t=>{
  const fs=await import('node:fs'), path=await import('node:path');
  fs.mkdirSync('.test-work',{recursive:true}); const root=fs.mkdtempSync(path.resolve('.test-work/generate-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.cpSync(cfg.core,path.join(root,'skills','renamed-pack'),{recursive:true});
  fs.mkdirSync(path.join(root,'proof'));fs.mkdirSync(path.join(root,'docs'));
  fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({...cfg.pkg,name:'renamed-pack'}));
  fs.writeFileSync(path.join(root,'proof/results.json'),'[]');
  fs.writeFileSync(path.join(root,'README.md'),'# Renamed\n');fs.writeFileSync(path.join(root,'docs/RESULTS.md'),'');fs.writeFileSync(path.join(root,'docs/INSTALLER.md'),'');
  const out=generatedPack(root);
  assert.ok(out['agents/aun-runner-browser.md'].includes('npx renamed-pack read'));
  assert.ok(out['llms.txt'].includes('skills/renamed-pack/SKILL.md'));
  assert.equal(catalog(config(root))[0].skill,'.claude/skills/renamed-pack');
});
test('vendored set bytes bind both lock hashes and pending renderer is explicit',async()=>{
  const {createHash}=await import('node:crypto'), bytes=readFileSync('.repo-build/set.json');
  const lock=JSON.parse(readFileSync('.repo-build/set.lock.json','utf8'));
  const hash=createHash('sha256').update(bytes).digest('hex');
  assert.equal(lock.sha256,hash); assert.equal(lock.vendored_sha256,hash);
  assert.equal(lock.renderer_sha256,null);
  assert.equal(lock.source,JSON.parse(readFileSync('.repo-build/config.json','utf8')).set.source);
  assert.notEqual(createHash('sha256').update(Buffer.concat([bytes,Buffer.from(' ')] )).digest('hex'),lock.sha256);
});

test('driver reference pins and sources derive from the driver registry',()=>{
  const data=JSON.parse(readFileSync('bench/drivers.json','utf8'));
  const body=generateDrivers(process.cwd())[`${cfg.core}/references/drivers.md`];
  for(const row of [...data.drivers,data.browser]) assert.ok(body.includes(`| ${row.package} | ${row.version} | [Vendor](${row.source}) |`));
});
