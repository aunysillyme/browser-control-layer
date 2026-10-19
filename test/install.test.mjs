import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync,mkdtempSync,readFileSync,writeFileSync,rmSync,existsSync,symlinkSync,linkSync } from 'node:fs';
import { resolve,join } from 'node:path';
import { planInstall,applyInstall,installCommand,uninstallCommand,safePath } from '../src/install/index.mjs';
import { config } from '../src/config.mjs';
const root=process.cwd(), cfg=config();
function project(t) { mkdirSync('.test-work',{recursive:true}); const path=mkdtempSync(resolve('.test-work/install-')); t.after(()=>rmSync(path,{recursive:true,force:true})); return path; }
test('catalog paths and dry-run exactly match the confirmed writes for each host',async t=>{
  for(const host of ['claude-code','codex','gemini-cli','cursor','agents-md']) {
    const cwd=project(t), output=[];
    await installCommand(['--host',host,'--dry-run'],{cwd,write:s=>output.push(s)});
    assert.equal(existsSync(join(cwd,`.${cfg.skillName}`)),false);
    const preview=JSON.parse(output[0]); let confirms=0;
    assert.ok(output.some(line=>line.includes(`opt-in; configure your own scheduler): npx ${cfg.name} reap --idle`)));
    assert.ok(!preview.files.some(file=>/cron|launchagents|systemd/i.test(file.path)));
    await installCommand(['--host',host],{cwd,write:()=>{},prompt:async()=>{confirms++;return 'y';}});
    const receipt=JSON.parse(readFileSync(join(cwd,preview.receipt),'utf8'));
    assert.equal(confirms,1);
    assert.deepEqual(receipt.files.map(({path,sha256,action})=>({path,sha256,action})),preview.files);
    assert.ok(preview.companions.some(item=>item.name==='rtk-ai/rtk'));
    for(const file of receipt.files) assert.ok(existsSync(join(cwd,file.path)));
    await uninstallCommand([],{cwd,write:()=>{}});
    assert.equal(existsSync(join(cwd,preview.receipt)),false);
    for(const file of receipt.files) assert.equal(existsSync(join(cwd,file.path)),false,file.path);
  }
});
test('one edit screen changes host before confirmation; cancellation writes nothing',async t=>{
  const cwd=project(t), answers=['edit cursor','y'], previews=[];
  await installCommand([],{cwd,prompt:async()=>answers.shift(),write:value=>previews.push(value)});
  assert.ok(existsSync(join(cwd,`.cursor/rules/${cfg.skillName}.mdc`)));
  assert.equal(existsSync(join(cwd,'.claude/settings.json')),false);
  const cancelled=project(t); await installCommand([],{cwd:cancelled,prompt:async()=> 'n',write:()=>{}});
  assert.equal(existsSync(join(cancelled,`.${cfg.skillName}`)),false);
});
test('hooks merge with a backup and uninstall restores original bytes',async t=>{
  const cwd=project(t); mkdirSync(join(cwd,'.claude'));
  const original='{"theme":"light","hooks":{"Stop":[{"hooks":[{"type":"command","command":"echo existing"}]}]}}\n';
  writeFileSync(join(cwd,'.claude/settings.json'),original);
  const plan=planInstall({cwd}); applyInstall(plan,cwd);
  const settings=JSON.parse(readFileSync(join(cwd,'.claude/settings.json'),'utf8'));
  assert.equal(settings.theme,'light'); assert.equal(settings.hooks.Stop.length,2);
  const replaced=plan.entries.find(item=>item.path==='.claude/settings.json');
  assert.equal(readFileSync(join(cwd,replaced.backup),'utf8'),original);
  assert.ok(settings.hooks.Stop[1].hooks[0].command.includes(`.${cfg.skillName}/runtime/src/hooks/cli.mjs`));
  await uninstallCommand([],{cwd,write:()=>{}});
  assert.equal(readFileSync(join(cwd,'.claude/settings.json'),'utf8'),original);
});
test('edited files and their backups survive uninstall; unchanged control is removed',async t=>{
  const cwd=project(t); writeFileSync(join(cwd,'AGENTS.md'),'Existing instructions\n');
  const plan=planInstall({cwd,host:'agents-md'}); applyInstall(plan,cwd);
  writeFileSync(join(cwd,'AGENTS.md'),'User revised integration\n');
  const skill=plan.entries.find(item=>item.path.endsWith('/SKILL.md')).path;
  await uninstallCommand([],{cwd,write:()=>{}});
  assert.equal(readFileSync(join(cwd,'AGENTS.md'),'utf8'),'User revised integration\n');
  assert.equal(existsSync(join(cwd,skill)),false);
  const backup=plan.entries.find(item=>item.path==='AGENTS.md').backup;
  assert.equal(readFileSync(join(cwd,backup),'utf8'),'Existing instructions\n');
  assert.ok(existsSync(join(cwd,plan.receiptPath)));
});
test('identical preexisting file remains unowned and survives uninstall',async t=>{
  const cwd=project(t), destination=join(cwd,'skills',cfg.skillName); mkdirSync(destination,{recursive:true});
  writeFileSync(join(destination,'SKILL.md'),readFileSync(join(root,cfg.core,'SKILL.md')));
  const plan=planInstall({cwd,host:'agents-md'}); applyInstall(plan,cwd); await uninstallCommand([],{cwd,write:()=>{}});
  assert.ok(existsSync(join(destination,'SKILL.md')));
});
test('traversal, symlinks, hardlinks, file conflicts and changed previews refuse before overwrite',t=>{
  const cwd=project(t);
  assert.throws(()=>safePath(cwd,'../escape'),/Invalid/);
  assert.throws(()=>safePath(cwd,'C:\\escape'),/Invalid/);
  assert.ok(safePath(cwd,'safe/file').startsWith(cwd));
  mkdirSync(join(cwd,'real')); symlinkSync(join(cwd,'real'),join(cwd,'.agents'),'dir');
  assert.throws(()=>planInstall({cwd,host:'codex'}),/Symlink/);
  const other=project(t); mkdirSync(join(other,'skills',cfg.skillName),{recursive:true});
  writeFileSync(join(other,'skills',cfg.skillName,'SKILL.md'),'mine');
  assert.throws(()=>planInstall({cwd:other,host:'agents-md'}),/conflict/);
  const race=project(t), plan=planInstall({cwd:race,host:'agents-md'}); writeFileSync(join(race,'AGENTS.md'),'changed');
  assert.throws(()=>applyInstall(plan,race),/Changed/);
  assert.equal(existsSync(join(race,plan.receiptPath)),false);
  const hard=project(t); writeFileSync(join(hard,'source'),'text'); linkSync(join(hard,'source'),join(hard,'AGENTS.md'));
  assert.throws(()=>planInstall({cwd:hard,host:'agents-md'}),/single-link/);
});
test('dry uninstall changes nothing and malformed receipts refuse outside paths',async t=>{
  const cwd=project(t),plan=planInstall({cwd,host:'codex'});applyInstall(plan,cwd);
  await uninstallCommand(['--dry-run'],{cwd,write:()=>{}});
  assert.ok(existsSync(join(cwd,plan.receiptPath)));
  writeFileSync(join(cwd,plan.receiptPath),JSON.stringify({schemaVersion:1,files:[{path:'../escape',action:'create',sha256:'a'.repeat(64)}]}));
  await assert.rejects(uninstallCommand([],{cwd,write:()=>{}}),/Invalid/);
});
test('user-selected root alias is canonicalized while target links stay refused',async t=>{
  const cwd=project(t),parent=project(t),alias=join(parent,'project');symlinkSync(cwd,alias,'dir');
  const plan=planInstall({cwd:alias,host:'codex'});applyInstall(plan,alias);
  assert.ok(existsSync(join(cwd,plan.receiptPath)));
  await uninstallCommand([],{cwd:alias,write:()=>{}});
  assert.equal(await uninstallCommand([],{cwd:alias,write:()=>{}}),2);
});
