import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir,mkdtemp,rm,readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { planExperiment,costCommand,runExperiment } from '../bench/cost.mjs';
import { validateResult,parseCodexEvents,executeCodex,executeHarness } from '../bench/harness.mjs';
import { fixtureData } from '../bench/server.mjs';
const request={harness:'codex',model:'test-model',driver:'test-driver@1',arm:'package',context_tokens:20000};
const measured=()=>({protocol:1,harness:'codex',result:{items:fixtureData.items},metrics:{tokens:60,tool_calls:3,owned_processes_left:0,ownership_verified:true,prefill_tokens:20000,reread_share:0.5},versions:{harness:'test-host@1',model_id:'test-model',driver:'test-driver@1'},loaded:['skill','hooks','runner'],elapsed_ms:12});
async function scratch(t){await mkdir('.test-work',{recursive:true});const dir=await mkdtemp(resolve('.test-work/cost-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir;}
test('E2 plans 72 paired runs; cost plans exact C2 context points and C3 pairs',()=>{
 const e2=planExperiment();assert.equal(e2.planned_runs,72);assert.equal(e2.runs.filter(row=>row.arm==='package').length,36);
 const cost=planExperiment({suite:'cost',usdPerRun:0.25});assert.equal(cost.planned_runs,48);assert.equal(cost.spend.estimated_usd,12);
 assert.deepEqual([...new Set(cost.runs.filter(row=>row.scenario==='C2').map(row=>row.context_tokens))],[20000,100000,300000]);assert.equal(cost.runs.filter(row=>row.scenario==='C3').length,12);
 assert.throws(()=>planExperiment({n:0}),/positive integer/);
});
test('dry-run prints count and spend without confirmation or harness; refusal cancels before work',async()=>{
 const output=[];const fail=()=>{throw Error('must not run');};
 assert.equal(await costCommand(['e2','--dry-run'],{write:line=>output.push(line),confirm:fail,execute:fail}),0);assert.match(output[0],/72 planned runs/);assert.match(output[0],/Spend preview/);
 assert.equal(await costCommand(['e2','--model','m','--driver','d'],{write:()=>{},confirm:async()=>false,execute:fail}),0);
 await assert.rejects(costCommand(['cost','--model','m','--driver','d'],{write:()=>{},confirm:fail}),e=>e.code==='HARNESS_REQUIRED');
});
test('instrumentation refuses truncated context, baseline contamination and unknown cleanup but preserves valid metrics',()=>{
 assert.equal(validateResult(measured(),request).metrics.prefill_tokens,20000);
 const bad=measured();bad.metrics.prefill_tokens=19999;assert.throws(()=>validateResult(bad,request),/exact measured context/);
 assert.throws(()=>validateResult(measured(),{...request,arm:'baseline'}),/baseline/);
 const incomplete=measured();incomplete.loaded=['skill'];assert.throws(()=>validateResult(incomplete,request),/loading evidence/);
 const unknown=measured();unknown.metrics.ownership_verified=false;assert.equal(validateResult(unknown,request).metrics.ownership_verified,false);
});
test('native Codex parser gets usage and structured result without inventing ownership',()=>{
 const raw=[{type:'item.completed',item:{id:'tool-1',type:'mcp_tool_call'}},{type:'item.completed',item:{id:'answer',type:'agent_message',text:'{"value":42}'}},{type:'turn.completed',usage:{input_tokens:100,output_tokens:20,cached_input_tokens:80}}].map(JSON.stringify).join('\n');
 const result=parseCodexEvents(raw);assert.deepEqual(result.result,{value:42});assert.equal(result.metrics.tokens,120);assert.equal(result.metrics.tool_calls,1);assert.equal(result.metrics.reread_share,0.8);assert.equal(result.metrics.owned_processes_left,null);
 assert.throws(()=>parseCodexEvents('{"type":"turn.completed"}'),/usage/);
});
test('native host receives prompt on stdin and uses no shell or permission bypass',async()=>{
 let seen;const raw=[{type:'item.completed',item:{type:'agent_message',text:'{"value":42}'}},{type:'turn.completed',usage:{input_tokens:5,output_tokens:2}}].map(JSON.stringify).join('\n');
 function spawnProcess(command,args,options){seen={command,args,options};const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();child.stdin.on('finish',()=>{child.stdout.end(raw);child.emit('close',0);});return child;}
 const response=await executeCodex({...request,context_tokens:0,cwd:process.cwd(),prompt:'Read public fixture.'},{spawnProcess,inspectOwnership:async()=>({probe_verified:true,ledger_records:0,owned_detected:0})});assert.equal(seen.command,'codex');assert.ok(seen.args.includes('--json'));assert.equal(seen.options.shell,undefined);assert.equal(response.result.metrics.ownership_verified,false);
 assert.throws(()=>executeCodex(request,{spawnProcess}),/exact context/);
});
test('external harness invokes only supplied executable and validates returned measurement',async()=>{
 let name;function spawnProcess(command){name=command;const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();child.stdin.on('finish',()=>{child.stdout.end(JSON.stringify(measured()));child.emit('close',0);});return child;}
 assert.equal((await executeHarness('/test/adapter',request,{spawnProcess})).result.metrics.tokens,60);assert.equal(name,'/test/adapter');
});
test('experiment saves raw hashes, installs package arm and closes server on failure',async t=>{
 const output=await scratch(t);let closed=0,installed=0;
 const server={url:'http://127.0.0.1:9999',close:async()=>closed++};
 const plan=planExperiment({suite:'cost',n:1});plan.runs=plan.runs.slice(0,2);plan.planned_runs=2;
 const adapters={startServer:async()=>server,install:async()=>installed++,strict:true,execute:async req=>{const result=measured();result.loaded=req.arm==='package'?result.loaded:[];result.metrics.tokens=req.arm==='package'?30:60;return {result,raw:JSON.stringify(result)};},evidence:async()=>({requests:[{method:'GET',path:'/list'},...fixtureData.items.map(item=>({method:'GET',path:'/detail',query:{id:item.id}}))],submissions:[],beacons:[],confirmations:[]})};
 const result=await runExperiment(plan,{output,model:request.model,driver:request.driver},adapters);assert.equal(closed,1);assert.equal(installed,1);assert.equal(result.claim_eligible,true);assert.match(result.records[0].raw.sha256,/^[0-9a-f]{64}$/);assert.equal(JSON.parse(await readFile(result.directory+'/summary.json','utf8')).completed_runs,2);
 await assert.rejects(runExperiment(plan,{output}, {...adapters,execute:async()=>{throw Error('failed host');}}),/failed host/);assert.equal(closed,2);
 const leftover={...adapters,execute:async req=>{const response=await adapters.execute(req);response.result.metrics.owned_processes_left=1;return response;}};
 await assert.rejects(runExperiment(plan,{output,model:request.model,driver:request.driver},leftover),error=>error.code==='OWNED_LEFTOVERS');assert.equal(closed,3);
 const changed={...adapters,execute:async req=>{const response=await adapters.execute(req);if(req.arm==='package')response.result.versions.harness='changed-host';return response;}};
 await assert.rejects(runExperiment(plan,{output,model:request.model,driver:request.driver},changed),/versions changed/);assert.equal(closed,4);
});
