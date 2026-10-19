import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync, cpSync, existsSync, unlinkSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { check, STUB } from '../src/build/validate.mjs';
import { config } from '../src/config.mjs';
import { proofBlock } from '../src/build/pack.mjs';
import { files, digest, generated } from '../src/build/bundle.mjs';

const base=process.cwd();
function fixture() {
  mkdirSync('.test-work',{recursive:true});
  const root=mkdtempSync(resolve('.test-work/gates-'));
  for (const path of files(base)) { mkdirSync(dirname(join(root,path)),{recursive:true}); cpSync(path,join(root,path)); }
  return root;
}
function put(root,path,value) { mkdirSync(dirname(join(root,path)),{recursive:true}); writeFileSync(join(root,path),typeof value==='string' ? value : JSON.stringify(value)); }
function json(root,path) { return JSON.parse(readFileSync(join(root,path),'utf8')); }
function update(root,path,fn) { const value=json(root,path); fn(value); put(root,path,value); }
function finding(root,code) { return check(root,{only:[code]}).issues.some(s=>s.startsWith(code+':')); }

test('repository gates refuse invalid artifacts and accept repaired controls',async t=>{
  const root=fixture(), {core,pkg}=config(root);
  async function pair(code,paths,invalid,valid) {
    await t.test(code,()=>{
      const saved=new Map(paths.map(p=>[p,existsSync(join(root,p)) ? readFileSync(join(root,p)) : null]));
      try {
        invalid(); assert.equal(finding(root,code),true,code+' refusing case');
        valid(); assert.equal(finding(root,code),false,code+' allowed control');
      } finally { for (const [p,bytes] of saved) if (bytes===null) rmSync(join(root,p),{force:true}); else writeFileSync(join(root,p),bytes); }
    });
  }
  try {
    await pair('FLOOR',['LICENSE'],()=>put(root,'LICENSE',''),()=>put(root,'LICENSE','MIT License'));
    await pair('MANIFEST',[`${core}/manifest.json`],()=>update(root,`${core}/manifest.json`,m=>m.schemaVersion=0),()=>update(root,`${core}/manifest.json`,m=>m.schemaVersion=1));
    await pair('SOURCE_HASH',[`${core}/SKILL.md`],()=>put(root,`${core}/SKILL.md`,'changed'),()=>put(root,`${core}/SKILL.md`,readFileSync(join(base,core,'SKILL.md'),'utf8')));
    await pair('PACKAGE_DEPS',['package.json'],()=>update(root,'package.json',p=>p.dependencies={example:'1.0.0'}),()=>update(root,'package.json',p=>delete p.dependencies));
    await pair('PACKAGE_HONESTY',['package.json'],()=>update(root,'package.json',p=>p.scripts.prepare='node example.mjs'),()=>update(root,'package.json',p=>delete p.scripts.prepare));
    await pair('PACKAGE_FILES',['package.json'],()=>update(root,'package.json',p=>p.files.unshift('!src/**')),()=>update(root,'package.json',p=>p.files.shift()));
    await pair('DESCRIPTION_DRIFT',['.claude-plugin/plugin.json'],()=>update(root,'.claude-plugin/plugin.json',p=>p.description='changed'),()=>update(root,'.claude-plugin/plugin.json',p=>p.description=pkg.description));
    await pair('VERSION',['.claude-plugin/plugin.json'],()=>update(root,'.claude-plugin/plugin.json',p=>p.version='0.0.0'),()=>update(root,'.claude-plugin/plugin.json',p=>p.version=pkg.version));
    await pair('TOPICS',['package.json'],()=>update(root,'package.json',p=>p.keywords=['Different']),()=>update(root,'package.json',p=>p.keywords=pkg.keywords));
    await pair('NAME_PARAM',['src/example.mjs'],()=>put(root,'src/example.mjs',`export const name=${JSON.stringify(pkg.name)};`),()=>put(root,'src/example.mjs','export const safe=true;'));
    await pair('SKILL_BUDGET',[`${core}/SKILL.md`],()=>put(root,`${core}/SKILL.md`,'x'.repeat(6145)),()=>put(root,`${core}/SKILL.md`,STUB+'\n'));
    await pair('RUNNER_SIZE',['agents/aun-runner-browser.md'],()=>put(root,'agents/aun-runner-browser.md','x'.repeat(4097)),()=>put(root,'agents/aun-runner-browser.md',STUB+'\n'));
    await pair('INVOCATION_FIRST',[`${core}/SKILL.md`],()=>put(root,`${core}/SKILL.md`,'## Install\nChoose a mode\n'),()=>put(root,`${core}/SKILL.md`,'## When invoked\nRead the task.\n'));
    await pair('LOAD_BUDGET',[`${core}/manifest.json`,`${core}/SKILL.md`],()=>{
      put(root,`${core}/SKILL.md`,'x'.repeat(6000)); update(root,`${core}/manifest.json`,m=>m.stageRoutes=[{id:'large',assets:Array(4).fill('SKILL.md')}]);
    },()=>update(root,`${core}/manifest.json`,m=>m.stageRoutes=[{id:'small',assets:['SKILL.md']}]));
    await pair('CLAIM_RUNNERS',['.claude-plugin/plugin.json'],()=>update(root,'.claude-plugin/plugin.json',p=>p.agents=['agents/absent.md']),()=>update(root,'.claude-plugin/plugin.json',p=>p.agents=['agents/aun-runner-browser.md']));
    await pair('CONCEPT_MAP',['docs/PROVENANCE.md'],()=>put(root,'docs/PROVENANCE.md','| Concept | From | Reference | Usable as |\n| Read | unnamed | `absent.md` | prose |\n'),()=>put(root,'docs/PROVENANCE.md','| Concept | From | Reference | Usable as |\n| Read | aun-read | `SKILL.md` | Runner rule |\n'));
    await pair('DEFAULT_ROW',['src/hygiene/defaults.json'],()=>put(root,'src/hygiene/defaults.json',{idle:{value:300}}),()=>put(root,'src/hygiene/defaults.json',json(base,'src/hygiene/defaults.json')));
    await pair('DEFAULT_ROW',['src/hygiene/defaults.json','proof/results.json','docs/DEFAULTS.md'],()=>{
      put(root,'src/hygiene/defaults.json',{waitCap:{value:4,source:{row:'R4'},date:'2026-01-01'}});
      put(root,'proof/results.json',[{id:'R4',measured_at:'2026-01-01',defaults:{waitCap:3}}]);
      put(root,'docs/DEFAULTS.md','waitCap from R4');
    },()=>update(root,'src/hygiene/defaults.json',data=>data.waitCap.value=3));
    await pair('SET_DRIFT',['.repo-build/set.lock.json','.repo-build/render-set.mjs','.repo-build/set.json'],()=>{
      put(root,'.repo-build/render-set.mjs','process.exitCode=0;');put(root,'.repo-build/set.json',{version:1,rows:[]});
      put(root,'.repo-build/set.lock.json',{renderer_sha256:'a'.repeat(64),vendored_sha256:digest(readFileSync(join(root,'.repo-build/set.json')))});
    },()=>update(root,'.repo-build/set.lock.json',m=>m.renderer_sha256=digest(readFileSync(join(root,'.repo-build/render-set.mjs')))));
    await pair('BUNDLE_DRIFT',[`${core}/manifest.json`,'docs/bundles/sample.md'],()=>{
      update(root,`${core}/manifest.json`,m=>m.bundles={sample:['SKILL.md']}); put(root,'docs/bundles/sample.md','stale');
    },()=>put(root,'docs/bundles/sample.md',generated(root)['docs/bundles/sample.md']));
    await pair('LICENSE_SOURCE',['docs/evidence/sources.json'],()=>put(root,'docs/evidence/sources.json',[{url:'https://example.com/project',kind:'code',license:'AGPL-3.0'}]),()=>put(root,'docs/evidence/sources.json',[{url:'https://example.com/project',kind:'code',license:'MIT'}]));
    await pair('CREDITS',['docs/evidence/sources.json','CREDITS.md','README.md','docs/PROVENANCE.md'],()=>{put(root,'docs/PROVENANCE.md',STUB);put(root,'docs/evidence/sources.json',[{url:'https://example.com/project',kind:'code',license:'MIT'}]);},()=>{
      put(root,'README.md',STUB+'\nCredit: https://example.com/project\n'); put(root,'CREDITS.md','| Project | License |\n| https://example.com/project | MIT |\n');
    });
    await pair('CLAIM_EVIDENCE',['README.md','docs/evidence/content-review.json'],()=>{
      put(root,'README.md','# Read public pages\n'); put(root,'docs/evidence/content-review.json',{files:{'README.md':{sha256:'a'.repeat(64),disposition:'WAIVED'}}});
    },()=>{const ledger=json(base,'docs/evidence/content-review.json'); ledger.files['README.md']={sha256:digest(readFileSync(join(root,'README.md'))),disposition:'WAIVED',reason:'Synthetic gate fixture'};put(root,'docs/evidence/content-review.json',ledger);});
    const raw='{}\n', row={id:'H5',subject:'package',claim:'Measured fixture',unit:'processes',n:1,median:0,p25:0,p75:0,arms:[{name:'baseline',median:0},{name:'package',median:0}],ratio:null,machine:{os:'fixture',cpu:'fixture',ram_gb:1},versions:{node:'22',chrome:'1',driver:'1',harness:null,model_id:null},command:'bench hygiene',raw:{path:'proof/raw.jsonl',sha256:digest(raw)},measured_at:'2026-01-01',expires_at:'2099-01-01'};
    await pair('PROOF_BINDING',['README.md'],()=>put(root,'README.md',STUB+'\n40% fewer tokens\n'),()=>put(root,'README.md',STUB+'\nRead public pages.\n'));
    await pair('PROOF_SCOPE',['README.md','docs/RESULTS.md','llms.txt','proof/results.json','proof/raw.jsonl'],()=>{
      put(root,'proof/raw.jsonl',raw); put(root,'proof/results.json',[{...row,subject:'default'}]); put(root,'README.md',STUB+'\n<!-- proof:start -->\n| H5 | 4 |\n<!-- proof:end -->\n');
      put(root,'docs/RESULTS.md',STUB+'\n'); put(root,'llms.txt',STUB+'\n');
    },()=>put(root,'proof/results.json',[row]));
    await pair('HOOK_LATENCY',['proof/results.json','proof/raw.jsonl'],()=>{put(root,'proof/raw.jsonl',raw);put(root,'proof/results.json',[{...row,hook_p95_ms:151}]);},()=>put(root,'proof/results.json',[{...row,hook_p95_ms:100}]));
    await t.test('expired rendered proof warns without failing checks or release',()=>{
      const paths=['README.md','proof/results.json','proof/raw.jsonl'];
      const saved=new Map(paths.map(p=>[p,existsSync(join(root,p)) ? readFileSync(join(root,p)) : null]));
      try {
        put(root,'proof/raw.jsonl',raw); put(root,'proof/results.json',[{...row,expires_at:'2020-01-01'}]);
        put(root,'README.md',STUB+'\n'+proofBlock([{...row,expires_at:'2020-01-01'}],{now:0})+'\n');
        for (const release of [false,true]) {
          const result=check(root,{release,only:['PROOF_EXPIRY','PROOF_BINDING']});
          assert.deepEqual(result.issues,[]); assert.ok(result.warnings.some(line=>line.startsWith('PROOF_EXPIRY:')));
        }
      } finally { for (const [p,bytes] of saved) if (bytes===null) rmSync(join(root,p),{force:true}); else writeFileSync(join(root,p),bytes); }
    });
    await t.test('selected content gates operate without package metadata and check stays read-only',()=>{
      const before=new Map(files(root).map(p=>[p,digest(readFileSync(join(root,p)))]));
      assert.equal(finding(root,'VOICE'),false);
      assert.deepEqual(new Map(files(root).map(p=>[p,digest(readFileSync(join(root,p)))])),before);
      const bytes=readFileSync(join(root,'package.json')); unlinkSync(join(root,'package.json'));
      try { assert.deepEqual(check(root,{only:['PRIVACY']}).issues,[]); } finally { put(root,'package.json',bytes.toString()); }
    });
    await t.test('stdin and selection flags preserve named failures and usage exits',()=>{
      const invoke=(args,input)=>spawnSync(process.execPath,['scripts/check.mjs',...args],{cwd:root,input,encoding:'utf8'});
      assert.equal(invoke(['--stdin','--only','PRIVACY'],'Auny LLC').status,0);
      assert.equal(invoke(['--stdin','--only','VOICE'],String.fromCharCode(0x2014)).status,1);
      assert.equal(invoke(['--only','UNKNOWN'],'').status,2);
      assert.equal(invoke(['--release'],'').status,0);
      const original=readFileSync(join(root,'docs/RESULTS.md'),'utf8');
      try {
        put(root,'docs/RESULTS.md',STUB+'\n');
        assert.equal(invoke(['--release'],'').status,1);
      } finally { put(root,'docs/RESULTS.md',original); }
    });
  } finally { rmSync(root,{recursive:true,force:true}); }
});
