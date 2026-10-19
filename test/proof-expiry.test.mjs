import test from 'node:test';
import assert from 'node:assert/strict';
import { proofIssues } from '../src/build/validate.mjs';
test('expired rows warn while valid rows stay quiet', () => {
  const row={id:'H1',subject:'package',command:'bench hygiene',raw:{path:'proof/raw.jsonl',sha256:'a'.repeat(64)},measured_at:'2020-01-01',expires_at:'2020-02-01'};
  const old=proofIssues([row],Date.parse('2021-01-01')); assert.deepEqual(old.issues,[]); assert.equal(old.warnings.length,1);
  assert.deepEqual(proofIssues([{...row,expires_at:'2030-01-01'}],Date.parse('2021-01-01')).warnings,[]);
});
test.todo('Generated proof renderer omits expired rows in the next implementation');
