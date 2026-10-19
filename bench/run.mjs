import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { cpus, totalmem, platform, tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { config, ROOT } from '../src/config.mjs';
import { processAdapter } from '../src/proc/table.mjs';
import { doctor } from '../src/hygiene/doctor.mjs';
import { createLedger } from '../src/hygiene/ledger.mjs';
import { runHook } from '../src/hooks/cli.mjs';
import { detectDrivers, formatDetection } from './detect.mjs';
import { scenarios, aggregate, quantile, sampleOwnedResources, screenSamples, resourceSamples } from './scenarios.mjs';
import { startFixtureServer } from './server.mjs';
import { requireCi, createRuntime } from './p0/runtime.mjs';
import { measure } from './p0/index.mjs';
import { runE1 } from '../evals/e1/run.mjs';

export function validateRow(row) {
  const errors=[];
  for(const key of ['id','claim','unit','command'])if(typeof row[key]!=='string'||!row[key])errors.push(key);
  if(!['package','default'].includes(row.subject)||(/^R[1-7]/.test(row.id)&&row.subject!=='default'))errors.push('subject');
  if(!Number.isInteger(row.n)||row.n<1)errors.push('n');
  for(const key of ['median','p25','p75'])if(!Number.isFinite(row[key]))errors.push(key);
  if(row.ratio!==null&&!Number.isFinite(row.ratio))errors.push('ratio');
  if(!Array.isArray(row.arms)||!row.arms.length)errors.push('arms');
  for(const key of ['measured_at','expires_at'])if(!Number.isFinite(Date.parse(row[key])))errors.push(key);
  if(!row.machine||!['os','cpu','ram_gb'].every(key=>key in row.machine))errors.push('machine');
  if(!row.versions||!['node','chrome','driver','harness','model_id'].every(key=>key in row.versions))errors.push('versions');
  if(!row.raw?.path||! /^[a-f0-9]{64}$/.test(row.raw?.sha256||''))errors.push('raw');
  return errors;
}
export function normalizeRuntimePaths(text, env = process.env) {
  const aliases = [[ROOT,'$PACKAGE_ROOT'],[env.RUNNER_TEMP,'$RUNNER_TEMP'],[env.HOME,'$RUNNER_HOME']].filter(([path])=>path).sort((a,b)=>b[0].length-a[0].length);
  for(const [path,alias] of aliases)text=text.replaceAll(path,alias);
  return text;
}
export async function writeRows(raw,{out,command,versions,root=ROOT}) {
  await mkdir(out,{recursive:true});
  const text=normalizeRuntimePaths(raw.map(row=>JSON.stringify(row)).join('\n')+'\n'),sha256=createHash('sha256').update(text).digest('hex');
  await writeFile(join(out,'raw.jsonl'),text);await writeFile(join(out,'raw.sha256'),sha256+'\n');
  const measured_at=new Date().toISOString(),expires_at=new Date(Date.now()+60*86400000).toISOString();
  const rows=[];
  for(const scenario of scenarios) {
    const matching=raw.filter(row=>row.id===scenario.id);if(matching.some(row=>row.status==='failed'))continue;
    const samples=matching.filter(row=>Number.isFinite(row.value));if(!samples.length)continue;
    const arms=[...new Set(samples.map(row=>row.arm))].map(arm=>({name:arm,...aggregate(samples.filter(row=>row.arm===arm).map(row=>row.value))}));
    const row={id:scenario.id,subject:scenario.subject,claim:scenario.claim,unit:samples[0].unit,...aggregate(samples.map(row=>row.value)),arms,ratio:arms.length===2&&arms[0].median?arms[1].median/arms[0].median:null,measured_at,expires_at,machine:{os:platform(),cpu:cpus()[0]?.model||'unknown',ram_gb:totalmem()/1024**3},versions,command,raw:{path:relative(root,join(out,'raw.jsonl')).replaceAll('\\','/'),sha256}};
    if(scenario.id==='R4'){const calibrated=samples.filter(item=>item.arm==='loop-refusal'&&item.blocked===true&&Number.isInteger(item.selectedCap));if(calibrated.length)row.defaults={waitCap:Math.max(...calibrated.map(item=>item.selectedCap))};}
    if(scenario.id==='H4')row.wrong_kills=Math.max(...samples.map(item=>item.wrongKills||0));
    if(scenario.id==='H5')row.hook_p95_ms=quantile(samples.filter(item=>item.arm==='browser-hook').map(item=>item.value),.95);
    if(validateRow(row).length)throw new Error('BENCH_ROW_INVALID:'+validateRow(row).join(','));rows.push(row);
  }
  await writeFile(join(out,'results.json'),JSON.stringify(rows,null,2)+'\n');return rows;
}
export async function benchMain(args=[],{stdout=process.stdout,stderr=process.stderr}={}) {
  let suite='all',n=3,out=resolve('proof/runs/hygiene'),dry=false;
  if(args[0]==='hygiene')args=args.slice(1);
  for(let i=0;i<args.length;i++){if(args[i]==='--suite')suite=args[++i];else if(args[i]==='--n')n=Number(args[++i]);else if(args[i]==='--out')out=resolve(args[++i]);else if(args[i]==='--dry-run')dry=true;else if(args[i]!=='--ci')throw new Error('BENCH_ARGUMENT:'+args[i]);}
  if(!['all','H','R','S','E1'].includes(suite)||!Number.isInteger(n)||n<1||n>100)throw new Error('BENCH_ARGUMENT: suite all|H|R|S|E1 and n 1..100');
  const detected=detectDrivers();stdout.write(formatDetection(detected)+'\n');
  if(dry){stdout.write(JSON.stringify({suite,n,scenarios:scenarios.filter(row=>suite==='all'||row.id.startsWith(suite)),e1Runs:suite==='all'||suite==='E1'?41:0,realBrowser:'Explicit benchmark or GitHub Actions; owned synthetic profiles only'})+'\n');return 0;}
  const authorizedBenchmark=!args.includes('--ci');
  requireCi(process.env,{authorizedBenchmark});
  if(detected.some(driver=>!driver.matches))throw new Error('BENCH_DRIVER: install the printed pinned drivers before running');
  const puppeteer=createRequire(detected.find(row=>row.id==='puppeteer').metadata)('puppeteer'),fixture=await startFixtureServer(),raw=[];
  const adapter=processAdapter();
  const sampleResources=browser=>sampleOwnedResources(adapter,browser.process().pid);
  const versions={node:process.version,chrome:null,driver:Object.fromEntries(detected.map(row=>[row.id,row.installedVersion])),harness:'deterministic',model_id:null};
  let failed=false;
  try {
    const browser=await puppeteer.launch({headless:true,args:['--no-sandbox']});try{versions.chrome=await browser.version();}finally{await browser.close();}
    if(suite==='all'||suite==='R')raw.push(...await resourceSamples({puppeteer,url:fixture.url,sampleResources,n}));
    if(suite==='all'||suite==='S') {
      const pages=[];for(const path of ['/injection','/list','/detail?id=1','/form']){const text=await(await fetch(fixture.url+path)).text();pages.push({path,planted:path==='/injection',text,sha256:createHash('sha256').update(text).digest('hex')});}
      const result=screenSamples(pages);raw.push({id:'S1',arm:'recall',value:result.recall,unit:'fraction',...result},{id:'S1',arm:'false-alarm',value:result.falseAlarmRate,unit:'fraction'});
    }
    if(suite==='all'||suite==='H'||suite==='E1') {
      const e1=await runE1({out:join(out,'e1'),puppeteer,fixture,authorizedBenchmark,detected});failed=e1.status!=='passed';raw.push(...e1.rows.map(row=>({...row,caseId:row.id,id:'E1',value:row.ownedProcesses,unit:'processes',suite:'E1'})));
      if(suite!=='E1') {
        const catalog=JSON.parse(await readFile(join(ROOT,'bench/drivers.json'),'utf8')),runtime=await createRuntime({root:ROOT,versions,browserPath:(await puppeteer.executablePath()),authorizedBenchmark,env:{...process.env,RUNNER_TEMP:process.env.RUNNER_TEMP||tmpdir()}});
        catalog.drivers=catalog.drivers.map(driver=>({...driver,executable:detected.find(row=>row.id===driver.id)?.executable}));
        for(const id of ['H1','H2'])for(const driver of catalog.drivers){const baseline=await measure(runtime,{driver,variant:driver.variants[0],repeat:1},id);raw.push({...baseline,id,arm:'baseline',value:baseline.leftover_processes,unit:'processes'});if(baseline.status==='failed')failed=true;}
        const idleItems=[{id:'h2-lease',arm:'leased',ending:'idle',repeat:1},...catalog.drivers.map(driver=>({id:`h2-${driver.id}`,arm:'unleased',driver:driver.id,ending:'idle',repeat:1}))];
        const idle=await runE1({out:join(out,'idle'),puppeteer,fixture,authorizedBenchmark,detected,items:idleItems,scriptedHooks:false,idleObservationMs:600000});if(idle.status!=='passed')failed=true;
        for(const row of idle.rows)raw.push({...row,id:'H2',arm:row.arm==='leased'?'lease-timer':'sweep-timer',value:row.ownedProcesses,unit:'processes',observationMs:600000});
        const baselineBrowser=await puppeteer.launch({headless:true,args:['--no-sandbox']});
        try {const page=await baselineBrowser.newPage();await page.goto(fixture.url+'/list');raw.push({id:'H3',arm:'baseline',value:(await baselineBrowser.pages()).filter(page=>page.url()===fixture.url+'/list').length,unit:'tabs',observedUrls:(await baselineBrowser.pages()).map(page=>page.url())});raw.push({id:'H4',arm:'baseline',value:0,wrongKills:0,unit:'processes',sentinelAlive:Boolean(await adapter.inspect(baselineBrowser.process().pid)),sentinelTabs:(await baselineBrowser.pages()).length});}finally{await baselineBrowser.close();}
        for(const row of e1.rows.filter(row=>row.status==='passed')){if(row.ending!=='idle')raw.push({...row,id:'H1',arm:row.arm==='leased'?'lease':'sweep',value:row.ownedProcesses,unit:'processes'});raw.push({...row,id:'H3',arm:'cleanup',value:row.runTabs,unit:'tabs'});raw.push({...row,id:'H4',arm:'cleanup',value:row.wrongKills,unit:'processes'});}
        const ledger=createLedger({root:join(out,'overhead-state')});
        for(let i=0;i<Math.max(20,n);i++){let start=performance.now();await Promise.resolve();raw.push({id:'H5',arm:'baseline',value:performance.now()-start,unit:'ms'});start=performance.now();await runHook({hook_event_name:'PreToolUse',session_id:'overhead',tool_name:'mcp__playwright__browser_navigate',tool_input:{url:fixture.url+'/list',isolated:true}},{ledger,processAdapter:adapter});raw.push({id:'H5',arm:'browser-hook',value:performance.now()-start,unit:'ms'});start=performance.now();const actual=await adapter.list();const synthetic=Array.from({length:Math.max(0,600-actual.length)},(_,index)=>({pid:1000000+index,ppid:1,executable:'synthetic-chrome',argv:[],readable:true,rssBytes:0,cpuPercent:0}));const inventory=[...actual,...synthetic];await doctor({ledger,processAdapter:{...adapter,list:async()=>inventory}});raw.push({id:'H5',arm:'doctor-600',value:performance.now()-start,unit:'ms',processCount:inventory.length,syntheticCount:synthetic.length});}
      }
    }
  } catch(error){failed=true;raw.push({status:'failed',error:{message:error.message,stack:error.stack}});stderr.write(error.stack+'\n');}
  finally {await fixture.close();await writeRows(raw,{out,command:`npx ${config().name} bench hygiene --suite ${suite} --n ${n}`,versions});}
  return failed?1:0;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))benchMain(process.argv.slice(2)).then(code=>{process.exitCode=code;}).catch(error=>{process.stderr.write(error.stack+'\n');process.exitCode=1;});
