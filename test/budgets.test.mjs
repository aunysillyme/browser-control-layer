import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/config.mjs';
import { check } from '../src/build/validate.mjs';
import { files, read } from '../src/build/bundle.mjs';
test('runtime dependencies and lifecycle scripts stay empty', () => {
  const { pkg }=config(); assert.deepEqual(pkg.dependencies || {},{});
  assert.deepEqual(Object.keys(pkg.devDependencies),['typescript']);
  for (const hook of ['preinstall','install','postinstall','prepare','prepack','postpack','prepublishOnly','publish','postpublish']) assert.equal(pkg.scripts[hook],undefined);
});
test('skill, route and runner byte budgets pass on current assets', () => {
  assert.deepEqual(check(process.cwd()).issues.filter(s=>/^(?:SKILL_BUDGET|LOAD_BUDGET|RUNNER_SIZE):/.test(s)),[]);
});
test('allowlisted source stays within tarball file and byte budgets', () => {
  const { pkg }=config();
  const included=files(process.cwd()).filter(name=>pkg.files.filter(p=>!p.startsWith('!')).some(p=>name===p || name.startsWith(p.replace(/\/$/,'')+'/')) && !/^docs\/[^/]+\.gif$/.test(name));
  for(const exclusion of pkg.files.filter(p=>p.startsWith('!') && p!=='!docs/*.gif')) {
    const path=exclusion.slice(1).replace(/\/\*\*$/,'');
    for(let i=included.length-1;i>=0;i--) if(included[i]===path || included[i].startsWith(path+'/')) included.splice(i,1);
  }
  if(!included.includes('package.json')) included.push('package.json');
  assert.ok(included.length<=150,`allowlisted files: ${included.length}`);
  const bytes=included.reduce((sum,path)=>sum+Buffer.byteLength(read(process.cwd(),path)),0);
  assert.ok(bytes<=502000,`allowlisted bytes: ${bytes}`);
});
