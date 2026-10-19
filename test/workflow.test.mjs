import test from 'node:test';
import assert from 'node:assert/strict';
import { workflowIssues } from '../src/build/inherited.mjs';
const valid=()=>({on:{pull_request:{}},permissions:{contents:'read'},concurrency:{group:'test','cancel-in-progress':true},jobs:{check:{'timeout-minutes':2,steps:[{uses:'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',name:'Check out source (checkout v7.0.1)',with:{'persist-credentials':false}}]}}});
const issues=w=>workflowIssues('.github/workflows/check.yml',JSON.stringify(w));
test('workflow security valid control',()=>assert.deepEqual(issues(valid()),[]));
for (const [code,mutate] of [
  ['WORKFLOW_PERMISSIONS',w=>w.permissions={contents:'write'}],
  ['WORKFLOW_CONCURRENCY',w=>w.concurrency['cancel-in-progress']=false],
  ['WORKFLOW_TRIGGER',w=>w.on='pull_request_target'],
  ['WORKFLOW_INJECTION',w=>w.jobs.check.steps.push({run:'echo ${{ github.event.pull_request.title }}'})],
  ['WORKFLOW_CREDENTIALS',w=>w.jobs.check.steps[0].with['persist-credentials']=true],
  ['WORKFLOW_TIMEOUT',w=>delete w.jobs.check['timeout-minutes']],
  ['ACTION_PIN',w=>w.jobs.check.steps[0].uses='actions/checkout@main'],
  ['ACTION_LABEL',w=>w.jobs.check.steps[0].name='Check out source (checkout v1.0.0)'],
]) test(`${code} rejects unsafe mutation with valid control`,()=>{const w=valid();mutate(w);assert.ok(issues(w).some(s=>s.startsWith(code+':')));assert.deepEqual(issues(valid()),[]);});
test('WORKFLOW_FORMAT refuses malformed input',()=>assert.ok(workflowIssues('sample.yml','invalid: [').some(s=>s.startsWith('WORKFLOW_FORMAT:'))));
test('publish permissions are scoped to release publish job',()=>{
  const w=valid();w.jobs.publish=w.jobs.check;delete w.jobs.check;w.jobs.publish.permissions={'id-token':'write',contents:'read'};
  assert.deepEqual(workflowIssues('.github/workflows/release.yml',JSON.stringify(w)),[]);
  assert.ok(issues(w).some(s=>s.startsWith('WORKFLOW_PERMISSIONS:')));
});
