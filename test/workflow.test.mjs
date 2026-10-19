import test from 'node:test';
import assert from 'node:assert/strict';
import { workflowIssues } from '../src/build/inherited.mjs';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { selectVersions } from '../bench/p0/versions.mjs';
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
test('browser workflow wires required suites and restricts private macOS jobs',()=>{
  const workflow=JSON.parse(readFileSync('.github/workflows/browser.yml','utf8'));
  for (const name of ['p0-linux','p0-macos','lifecycle-linux','h4-linux','h4-macos','read-loopback-linux','e1-linux','e1-macos']) assert.ok(workflow.jobs[name],name);
  for (const [name,job] of Object.entries(workflow.jobs)) if (name.endsWith('-macos')) {
    assert.match(job.if,/workflow_dispatch/); assert.match(job.if,/private == false/);
  }
  assert.ok(workflow.on.pull_request);
  for (const name of ['e1-linux','e1-macos']) {
    assert.ok(workflow.jobs[name].steps.some(step=>/evals\/e1\/run\.mjs/.test(step.run || '')));
    assert.ok(workflow.jobs[name].steps.every(step=>!/Implementation pending|next dispatch/.test(step.run || '')));
  }
  assert.ok(workflow.on.workflow_dispatch.inputs.p0_versions);
  assert.ok(workflow.on.workflow_dispatch.inputs.puppeteer_version);
  assert.deepEqual(workflowIssues('.github/workflows/browser.yml',JSON.stringify(workflow)),[]);
});
test('proof refresh write permissions stay scoped to the refresh job',()=>{
  const w=valid();w.jobs.refresh=w.jobs.check;delete w.jobs.check;
  w.jobs.refresh.permissions={contents:'write','pull-requests':'write'};
  assert.deepEqual(workflowIssues('.github/workflows/proof.yml',JSON.stringify(w)),[]);
  assert.ok(issues(w).some(s=>s.startsWith('WORKFLOW_PERMISSIONS:')));
  w.permissions={contents:'write'};
  assert.ok(workflowIssues('.github/workflows/proof.yml',JSON.stringify(w)).some(s=>s.startsWith('WORKFLOW_PERMISSIONS:')));
});
test('every real-browser job installs catalog pins without repository variables',async()=>{
  const catalog=JSON.parse(readFileSync('bench/drivers.json','utf8'));
  const versions=selectVersions(catalog);
  assert.deepEqual(Object.keys(versions).sort(),['@playwright/mcp','agent-browser','chrome-devtools-mcp','playwright','puppeteer','typescript']);
  const pkg=JSON.parse(readFileSync('package.json','utf8'));
  assert.equal(pkg.devDependencies.typescript,versions.typescript);
  const workflow=JSON.parse(readFileSync('.github/workflows/browser.yml','utf8'));
  for (const suite of ['p0','lifecycle','h4','e1','h-rows','r-rows']) for (const os of ['linux','macos']) assert.ok(workflow.jobs[`${suite}-${os}`]);
  for (const path of ['.github/workflows/browser.yml','.github/workflows/proof.yml','bench/p0/workflow-jobs.json','bench/lifecycle/workflow-jobs.json']) {
    const {jobs}=JSON.parse(readFileSync(path,'utf8'));
    for (const [name,job] of Object.entries(jobs)) {
      if (name==='read-loopback-linux') continue;
      const installs=job.steps.filter(step=>step.run?.includes('"install"'));
      assert.equal(installs.length,1,`${path}: ${name}`);
      const script=installs[0].run.match(/^node --input-type=module -e '([\s\S]+)'$/)?.[1];
      assert.ok(script,`${path}: ${name}`);
      const calls=[];
      await runInNewContext(`(async()=>{${script.replace(/import \{[^}]+\} from "[^"]+";\s*/g,'')}})()`,{
        readFileSync,selectVersions,process:{env:{}},mkdirSync(){},writeFileSync(){},
        execFileSync(command,args){calls.push({command,args});},
        writeArtifacts(){assert.fail('valid catalog reached setup failure');},summarize(){}
      });
      assert.equal(calls.length,1,`${path}: ${name}`);
      assert.equal(calls[0].command,'npm');
      assert.deepEqual(Array.from(calls[0].args),['install','--save-dev','--package-lock=false','--no-audit','--no-fund',...Object.entries(versions).map(([name,version])=>`${name}@${version}`)]);
    }
  }
});
