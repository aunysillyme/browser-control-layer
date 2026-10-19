import test from 'node:test';
import assert from 'node:assert/strict';
import { proofIssues } from '../src/build/validate.mjs';
test('expired rows warn while valid rows stay quiet', () => {
  const row={id:'H1',subject:'package',claim:'Measured fixture',unit:'processes',n:1,median:0,p25:0,p75:0,arms:[{name:'baseline',median:0},{name:'package',median:0}],ratio:null,machine:{os:'fixture',cpu:'fixture',ram_gb:1},versions:{node:'22',chrome:'1',driver:'1',harness:null,model_id:null},command:'bench hygiene',raw:{path:'proof/raw.jsonl',sha256:'a'.repeat(64)},measured_at:'2020-01-01',expires_at:'2020-02-01'};
  const old=proofIssues([row],Date.parse('2021-01-01')); assert.deepEqual(old.issues,[]); assert.equal(old.warnings.length,1);
  assert.deepEqual(proofIssues([{...row,expires_at:'2030-01-01'}],Date.parse('2021-01-01')).warnings,[]);
});
test('proof renderer drops expired rows with a warning and keeps a fresh control',async()=>{
  const {proofBlock}=await import('../src/build/pack.mjs');
  const row={id:'H1',subject:'package',claim:'Fixture',median:0,unit:'processes',command:'bench hygiene',raw:{path:'proof/raw.jsonl',sha256:'a'.repeat(64)},measured_at:'2020-01-01',expires_at:'2020-02-01'};
  const warnings=[];assert.ok(!proofBlock([row],{now:Date.parse('2021-01-01'),warn:s=>warnings.push(s)}).includes('| H1 |'));assert.equal(warnings.length,1);
  assert.ok(proofBlock([{...row,expires_at:'2099-01-01'}],{now:Date.parse('2021-01-01')}).includes('| H1 |'));
});
