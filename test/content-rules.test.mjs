import test from 'node:test';
import assert from 'node:assert/strict';
import { contentIssues, proofIssues } from '../src/build/validate.mjs';
const has=(name,text,code)=>contentIssues(name,text).some(s=>s.startsWith(code+':'));
test('NO_DRIVER refuses page control and permits process inspection',()=>{
  assert.equal(has('src/example.mjs',['Page','navigate'].join('.'),'NO_DRIVER'),true);
  assert.equal(has('src/example.mjs','processTable.list()','NO_DRIVER'),false);
});
test('SCOPE_V1 refuses future route pieces and permits public browser tools',()=>{
  assert.equal(has('hooks/sample.json',['granted','browser'].join('-'),'SCOPE_V1'),true);
  assert.equal(has('hooks/sample.json','mcp__playwright__browser_snapshot','SCOPE_V1'),false);
});
test('NO_THIRD_PARTY_INSTALL refuses executing a vendor install and allows a printed suggestion',()=>{
  assert.equal(has('bench/sample.mjs',"spawn('"+['n','px'].join('')+"', ['vendor'])",'NO_THIRD_PARTY_INSTALL'),true);
  assert.equal(has('bench/sample.mjs',"console.log('See the vendor installation instructions')",'NO_THIRD_PARTY_INSTALL'),false);
  assert.equal(has('bench/sample.mjs',"spawn(executable, args, { stdio: ['pipe', 'pipe', 'pipe'] })",'NO_THIRD_PARTY_INSTALL'),false);
});
test('PROOF_SCOPE requires a known subject and PROOF_BINDING a complete raw receipt',()=>{
  assert.ok(proofIssues([{id:'X',subject:'personal'}]).issues.some(s=>s.startsWith('PROOF_SCOPE:')));
  assert.ok(proofIssues([{id:'X',subject:'package'}]).issues.some(s=>s.startsWith('PROOF_BINDING:')));
  const row={id:'H1',subject:'package',command:'bench hygiene',raw:{path:'proof/raw.jsonl',sha256:'b'.repeat(64)},measured_at:'2026-01-01',expires_at:'2030-01-01'};
  assert.deepEqual(proofIssues([row],Date.parse('2026-02-01')).issues,[]);
});
test('SAFETY_CANARY refuses a wrong kill and permits a zero result',()=>{
  const row={id:'H4',subject:'package',command:'bench hygiene',raw:{path:'proof/raw.jsonl',sha256:'b'.repeat(64)},measured_at:'2026-01-01',expires_at:'2030-01-01',wrong_kills:1};
  assert.ok(proofIssues([row]).issues.some(s=>s.startsWith('SAFETY_CANARY:')));
  assert.deepEqual(proofIssues([{...row,wrong_kills:0}],Date.parse('2026-02-01')).issues,[]);
});
