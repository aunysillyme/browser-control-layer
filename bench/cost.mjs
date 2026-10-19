import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { stdin,stdout } from 'node:process';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from '../src/config.mjs';
import { tasks,taskPrompt } from '../evals/e2/tasks.mjs';
import { grade,claimEligible } from '../evals/e2/grader.mjs';
import { startFixtureServer,evidence } from './server.mjs';
import { executeHarness,executeCodex,validateResult } from './harness.mjs';
const usage=message=>Object.assign(new Error(message),{code:'USAGE',exitCode:2});
export function planExperiment({suite='e2',harness='codex',n=6,usdPerRun=null}={}) {
  if(!['e2','cost'].includes(suite) || !['codex','claude-code'].includes(harness) || !Number.isSafeInteger(n) || n<1) throw usage('Choose cost|e2, --harness codex|claude-code and a positive integer --n.');
  if(usdPerRun!==null && (!Number.isFinite(usdPerRun)||usdPerRun<0)) throw usage('Estimated USD per run must be nonnegative.');
  const conditions=suite==='e2' ? tasks.map(task=>({task:task.id,scenario:'E2',context_tokens:0})) : [20000,100000,300000].map(context_tokens=>({task:'multi-field',scenario:'C2',context_tokens})).concat({task:'form',scenario:'C3',context_tokens:0});
  const runs=[];
  for(const condition of conditions) for(let repetition=0;repetition<n;repetition++) for(const arm of repetition%2 ? ['package','baseline'] : ['baseline','package']) runs.push({...condition,repetition,arm,id:`${condition.scenario}-${condition.context_tokens}-${condition.task}-${repetition}-${arm}`});
  return {suite,harness,n,runs,planned_runs:runs.length,spend:{estimated_usd:usdPerRun===null?null:Number((runs.length*usdPerRun).toFixed(6)),basis:usdPerRun===null?'UNVERIFIED: supply --estimated-usd-per-run using your own harness pricing.':`User estimate ${usdPerRun} USD per run; actual billing can differ.`}};
}
export function preview(plan) {
  return `${plan.planned_runs} planned runs; harness=${plan.harness}; paired baseline and installed package.\nSpend preview: ${plan.spend.estimated_usd===null?'UNVERIFIED':`${plan.spend.estimated_usd} USD estimated`}. ${plan.spend.basis}\nThe same model and driver are used in each pair. Run logs remain local. Live harness calls consume your own quota.`;
}
async function confirmSpend() {
  if(!stdin.isTTY) throw Object.assign(new Error('Spend confirmation requires an interactive terminal.'),{code:'CONFIRMATION_REQUIRED',exitCode:2});
  const reader=createInterface({input:stdin,output:stdout});
  try{return (await reader.question('Run this benchmark and use your harness quota? [y/N] ')).trim().toLowerCase()==='y';}finally{reader.close();}
}
async function installPackage(cwd,host,root) {
  const {planInstall,applyInstall}=await import('../src/install/index.mjs');
  const plan=await planInstall({root,cwd,host});return applyInstall(plan,cwd);
}
export async function runExperiment(plan,options={},adapters={}) {
  const root=options.root || config().root;
  const output=resolve(options.output || 'proof/runs');
  await mkdir(output,{recursive:true});
  const directory=await mkdtemp(join(output,`${plan.suite}-`));
  const server=await (adapters.startServer || startFixtureServer)();
  const records=[];
  const pairs=new Map();
  try {
    for(const run of plan.runs) {
      const cwd=join(directory,run.id);await mkdir(cwd);
      if(run.arm==='package') await (adapters.install || installPackage)(cwd,plan.harness,root);
      const task=tasks.find(task=>task.id===run.task);
      const strategy=run.scenario==='C2' ? (run.arm==='package'?'Hand this task to the installed fresh small runner.':'Drive this task from the main conversation.') : run.scenario==='C3' ? (run.arm==='package'?'Use the installed package brief to batch the predictable form actions.':'Perform one form action per tool call.') : '';
      const request={protocol:1,...run,harness:plan.harness,harness_version:options.harnessVersion || 'UNVERIFIED',model:options.model,driver:options.driver,cwd,prompt:taskPrompt(task,server.url,run.id)+' '+strategy,
        requirements:{prefill:'Use tokenizer-verified synthetic neutral context; preserve it in the main conversation for both arms.',result:'Return the task result, token and tool counts, loading evidence and process ownership probes. Close resources before responding.'}};
      const execute=adapters.execute || (options.harnessCommand ? req=>executeHarness(options.harnessCommand,req) : executeCodex);
      const response=await execute(request);
      const result=options.harnessCommand || adapters.strict ? validateResult(response.result,request) : response.result;
      const pairKey=`${run.scenario}:${run.context_tokens}:${run.task}:${run.repetition}`;
      const conditions=JSON.stringify(result.versions);
      if(pairs.has(pairKey) && pairs.get(pairKey)!==conditions) throw Object.assign(new Error('Harness versions changed inside a pair.'),{code:'HARNESS_RESULT',exitCode:4});
      pairs.set(pairKey,conditions);
      const rawName=`${run.id}.jsonl`;await writeFile(join(directory,rawName),response.raw,{mode:0o600});
      const log=adapters.evidence ? await adapters.evidence(server,run.id) : evidence(server.state,run.id);
      const record={...run,harness:plan.harness,model_id:options.model,driver:options.driver,versions:result.versions,metrics:result.metrics,grade:grade(task,result.result,log),elapsed_ms:result.elapsed_ms,...(result.ownership?{ownership:result.ownership}:{}),unverified:result.unverified || [],
        raw:{path:rawName,sha256:createHash('sha256').update(response.raw).digest('hex')}};
      records.push(record);await writeFile(join(directory,'runs.jsonl'),records.map(row=>JSON.stringify(row)).join('\n')+'\n',{mode:0o600});
      options.write?.(`${run.id}: ${record.grade.success?'PASS':'FAIL'}; tokens=${record.metrics.tokens}; owned=${record.metrics.owned_processes_left ?? 'UNVERIFIED'}`);
      if(record.metrics.owned_processes_left>0 || record.ownership?.owned_detected>0) throw Object.assign(new Error('Owned resources remain after the run; inspect the saved receipt before continuing.'),{code:'OWNED_LEFTOVERS',exitCode:3});
    }
    const eligible=records.every(record=>record.unverified.length===0) && claimEligible(records);
    const result={kind:'benchmark-run',suite:plan.suite,harness:plan.harness,planned_runs:plan.planned_runs,completed_runs:records.length,claim_eligible:eligible,records,directory};
    await writeFile(join(directory,'summary.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});
    return result;
  } finally {await server.close();}
}
export async function costCommand(args,adapters={}) {
  const write=adapters.write || console.log;
  const options={suite:args[0] || 'e2',harness:'codex',n:6};let dry=false;
  const values={'--harness':'harness','--n':'n','--model':'model','--driver':'driver','--harness-command':'harnessCommand','--output':'output','--estimated-usd-per-run':'usdPerRun'};
  for(let i=1;i<args.length;i++) {
    if(args[i]==='--dry-run') {dry=true;continue;}
    const field=values[args[i]];if(!field || !args[i+1] || args[i+1].startsWith('--')) throw usage(`Unknown or incomplete benchmark option: ${args[i]}`);
    options[field]=['n','usdPerRun'].includes(field)?Number(args[++i]):args[++i];
  }
  const plan=planExperiment(options);write(preview(plan));
  if(dry) return 0;
  if(!options.model || !options.driver) throw usage('Set --model and --driver to keep measurement conditions fixed.');
  if(!options.harnessCommand && (options.suite==='cost' || options.harness==='claude-code') && !adapters.execute) throw Object.assign(new Error('This run requires --harness-command <executable> for exact context instrumentation or the external Claude Code host route. See evals/e2/README.md.'),{code:'HARNESS_REQUIRED',exitCode:2});
  if(!await (adapters.confirm || confirmSpend)(plan)) {write('Benchmark cancelled before any harness call.');return 0;}
  if(!options.harnessCommand && !adapters.execute) options.harnessVersion=(await promisify(execFile)('codex',['--version'])).stdout.trim();
  const result=await runExperiment(plan,{...options,write},adapters);
  write(JSON.stringify({directory:result.directory,completed_runs:result.completed_runs,claim_eligible:result.claim_eligible}));return 0;
}
