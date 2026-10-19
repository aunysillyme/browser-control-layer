import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { fork, spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, access, cp } from 'node:fs/promises';
import { join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { config, ROOT } from '../../src/config.mjs';
import { createLedger, stampActivity, stateRoot } from '../../src/hygiene/ledger.mjs';
import { processAdapter } from '../../src/proc/table.mjs';
import { reap } from '../../src/hygiene/reap.mjs';
import { cleanup } from '../../src/hygiene/cleanup.mjs';
import { discoverRuns } from '../../src/hygiene/sweep.mjs';
import { startIdleTimer } from '../../src/hygiene/idle-timer.mjs';
import { runHook } from '../../src/hooks/cli.mjs';
import { createRuntime, requireCi, wait } from '../../bench/p0/runtime.mjs';
import { startFixtureServer } from '../../bench/server.mjs';
import { resourceTotals } from '../../bench/scenarios.mjs';
import { crashMatrix, executeMatrix } from './matrix.mjs';

async function executeE1({out=resolve('proof/runs/e1'),puppeteer:provided,fixture:providedFixture,authorizedBenchmark=false,detected=[],items,scriptedHooks=true,idleObservationMs=0}={}) {
  requireCi(process.env,{authorizedBenchmark});
  const runtimeEnv={...process.env,RUNNER_TEMP:process.env.RUNNER_TEMP||tmpdir()};
  const puppeteer=provided||(await import('puppeteer')).default;
  const catalog=JSON.parse(await readFile(join(ROOT,'bench/drivers.json'),'utf8'));
  catalog.drivers=catalog.drivers.map(driver=>({...driver,executable:detected.find(row=>row.id===driver.id)?.executable}));
  const fixture=providedFixture||await startFixtureServer();
  await mkdir(out,{recursive:true});
  const root=await mkdtemp(join(runtimeEnv.RUNNER_TEMP,'aun-e1-'));
  const hookEnv={...process.env,HOME:join(root,'home'),XDG_STATE_HOME:join(root,'xdg')};
  const ledger=createLedger({root:stateRoot({home:hookEnv.HOME,env:hookEnv})}), adapter=processAdapter();
  const plugin=join(root,'plugin');
  for(const path of ['src','hooks','skills','package.json','bench/drivers.json'])await cp(join(ROOT,path),join(plugin,path),{recursive:true});
  const fixtureDefaults=JSON.parse(await readFile(join(plugin,'src/hygiene/defaults.json'),'utf8'));
  fixtureDefaults.termGraceMs.value=1000;fixtureDefaults.localIdleSeconds.value=1;
  await writeFile(join(plugin,'src/hygiene/defaults.json'),JSON.stringify(fixtureDefaults));
  const hookManifest=JSON.parse(await readFile(join(plugin,'hooks/hooks.json'),'utf8'));
  async function installedHook(event,handle) {
    const command=hookManifest.hooks[event][0].hooks[0].command;
    const match=/^node "\$\{CLAUDE_PLUGIN_ROOT\}\/src\/hooks\/cli\.mjs" ([a-z-]+)$/.exec(command);
    assert.ok(match,'installed hook command matches declared plugin entry');
    const child=spawn(process.execPath,[join(plugin,'src/hooks/cli.mjs'),match[1]],{env:{...hookEnv,AUN_HOST_PID:String(handle?.child?.pid||process.pid)},stdio:['pipe','pipe','pipe']});
    let stdout='',stderr='';child.stdout.on('data',part=>{stdout+=part;});child.stderr.on('data',part=>{stderr+=part;});
    child.stdin.end(JSON.stringify({hook_event_name:event,session_id:handle.sessionId,tool_name:'mcp__playwright__browser_navigate',tool_input:{url:fixture.url+'/list',isolated:true}}));
    const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});assert.equal(code,0,stderr);return JSON.parse(stdout||'{}');
  }
  let sentinel;
  const originalSignal=adapter.signal, permitted=new Map();let wrongKills=0;
  adapter.signal=async(target,signal)=>{
    const ids=target<0?(await adapter.list()).filter(row=>row.pgid===-target).map(row=>row.pid):[target];
    for(const pid of ids){const saved=permitted.get(pid),current=await adapter.inspect(pid);if(!saved||!current||current.startTime!==saved.startTime||pid===sentinel.process().pid){wrongKills++;throw new Error('E1_WRONG_KILL: identity outside this test');}}
    return originalSignal(target,signal);
  };
  const register=async()=>{for(const row of await adapter.list()){if(row.argv?.some(arg=>arg.includes(root))&&row.pid!==sentinel.process().pid&&!row.argv.some(arg=>arg.includes(join(root,'sentinel'))))permitted.set(row.pid,row);}};
  const versions=Object.fromEntries(catalog.drivers.map(driver=>[driver.id,driver.version]));
  const runtime=await createRuntime({root:ROOT,versions,browserPath:puppeteer.executablePath(),env:runtimeEnv,authorizedBenchmark});
  const handles=[];
  const base={ledger,processAdapter:adapter,termGraceMs:1000,versions};
  async function allowedHandle(handle) {
    if(handle.p0){const probe=await runtime.probe(handle.p0);for(const row of probe.processes){const current=await adapter.inspect(row.pid);if(current)permitted.set(row.pid,current);}}
    await register();
  }
  async function start(item) {
    const sessionId=`case-${item.id}`,session=`claude-code:${JSON.stringify([sessionId,null])}`,handle={session,sessionId,item};handles.push(handle);
    try {
      if(item.arm==='leased') {
        const child=fork(fileURLToPath(new URL('./worker.mjs',import.meta.url)),[JSON.stringify({state:ledger.root,session,authorizedBenchmark,executable:puppeteer.executablePath(),url:fixture.url+(item.ending==='budget'?'/memory':'/list'),budget:item.ending==='budget'})],{stdio:['ignore','pipe','pipe','ipc']});
        handle.child=child;handle.exited=new Promise(resolve=>child.once('exit',resolve));
        const ready=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('E1_OWNER_TIMEOUT')),30000);child.once('message',message=>{clearTimeout(timer);message.type==='ready'?resolve(message):reject(new Error(message.error));});child.once('error',reject);child.once('exit',code=>{clearTimeout(timer);reject(new Error(`E1_OWNER_EXIT:${code}`));});});
        handle.record=await ledger.read(ready.id);handle.owner=await adapter.inspect(child.pid);
      } else {
        const driver=catalog.drivers.find(row=>row.id===item.driver),variant=driver.variants[0];
        try {handle.p0=await runtime.start({driver,variant,repeat:item.repeat,url:fixture.url+'/list'});} catch(error) {handle.p0=error.handle;throw error;}
        const owner=await adapter.inspect(handle.p0.owner.pid);
        await stampActivity({...base,sessionKey:session,hostPid:owner.pid,hostStartTime:owner.startTime,driverId:driver.id,driverVersion:driver.version});
        const discovery=await discoverRuns({...base,sessionKey:session});
        assert.equal(discovery.discovered.length,1,`E1_RECIPE: expected one attributed ${driver.id} browser`);
        handle.record=discovery.discovered[0];
      }
      await allowedHandle(handle);
      assert.ok(await adapter.inspect(handle.record.pid),'browser exists before ending');
      return handle;
    } catch(error){error.handle=handle;throw error;}
  }
  async function end(handle,item) {
    const options={...base,sessionKey:handle.session};
    if(item.ending==='idle') {
      const now=idleObservationMs?Date.now():Date.now()-301000;
      await ledger.update(handle.record.id,row=>({...row,lastActivity:now,leaseRenewedAt:now}));
      await ledger.updateSession(handle.session,row=>({...row,lastActivity:now,generation:row?.generation||0}));
      const timer=await startIdleTimer({...options,idleSeconds:300});handle.timer=timer;
      assert.equal(timer.started,true,'idle timer started');
      if(idleObservationMs)await wait(idleObservationMs);
      for(let i=0;i<100;i++){if((await ledger.readSession(handle.session))?.timer===null)break;await wait(100);}
      handle.result={remaining:(await adapter.inspect(handle.record.pid))?1:0};
    } else if(item.ending==='budget') {handle.result=await reap({...options,mode:'budget'});handle.warning=handle.result.warnings?.some(message=>message.includes('Resource budget exceeded'));}
    else {
      if(handle.p0)await runtime.endOwner(handle.p0,item.ending);
      else if(['normal','error'].includes(item.ending))handle.child.send({type:'end',ending:item.ending});
      else {const fresh=await adapter.inspect(handle.owner.pid);assert.equal(fresh?.startTime,handle.owner.startTime);await originalSignal(handle.owner.pid,item.ending);}
      if(handle.exited)await Promise.race([handle.exited,wait(5000)]);else await wait(1000);
      handle.result=await reap({...options,mode:'orphans'});
    }
    await wait(250);
  }
  async function observe(handle,item) {
    const table=await adapter.list(), record=await ledger.read(handle.record.id);
    const owned=table.filter(row=>row.pid===record.pid||record.kind==='leased'&&row.pgid===record.pgid||row.argv?.some(arg=>arg.includes(record.userDataDir)));
    const profilePresent=await access(record.userDataDir).then(()=>true,()=>false);
    const sentinelAlive=Boolean(await adapter.inspect(sentinel.process().pid));
    const pages=await sentinel.pages();
    return {ownedProcesses:owned.length,ownedRssBytes:resourceTotals(owned).rssBytes,throwawayDirectories:record.profileClass==='throwaway'&&profilePresent?1:0,persistentDirectoriesKept:record.profileClass!=='driver-persistent'||profilePresent,runTabs:owned.length?null:0,sentinelAlive,sentinelTabs:pages.length,wrongKills,idleClosed:item.ending!=='idle'||!owned.length,timerExited:!handle.timer||!await adapter.inspect(handle.timer.pid),budgetWarning:Boolean(handle.warning),cleanup:handle.result};
  }
  async function dispose(handle) {
    if(handle.disposed)return;
    if(handle.record)await cleanup({...base,sessionKey:handle.session,apply:true});
    if(handle.p0)await runtime.cleanup(handle.p0);
    if(handle.child?.connected)handle.child.send({type:'end',ending:'normal'});
    if(handle.exited)await Promise.race([handle.exited,wait(3000)]);
    handle.disposed=true;
  }
  let rows=[];
  try {
    sentinel=await puppeteer.launch({headless:true,userDataDir:join(root,'sentinel'),args:['--no-sandbox']});
    await sentinel.newPage();
    rows=await executeMatrix(items||crashMatrix(catalog),{start,end,observe,dispose});
    for(const ending of scriptedHooks?['normal','SIGKILL','idle']:[]) {
      const item={id:`hook-${ending}`,arm:'leased',ending};let handle;
      try {
        handle=await start(item);
        await installedHook('SessionStart',handle);
        const pre=await installedHook('PreToolUse',handle);assert.notEqual(pre.hookSpecificOutput?.permissionDecision,'deny');
        await installedHook('PostToolUse',handle);
        const stop=await installedHook('Stop',handle);assert.equal(stop.decision,'block','installed close check blocks once');
        const timer=(await ledger.readSession(handle.session)).timer;
        if(ending==='idle') {
          handle.timer=timer;
          for(let i=0;i<100;i++){if((await ledger.readSession(handle.session)).timer===null)break;await wait(100);}
        } else if(ending==='normal') await installedHook('SessionEnd',handle);
        else {const owner=await adapter.inspect(handle.owner.pid);assert.equal(owner.startTime,handle.owner.startTime);await originalSignal(owner.pid,'SIGKILL');await handle.exited;await installedHook('SessionStart',handle);}
        const proof=await observe(handle,item);assert.equal(proof.ownedProcesses,0);assert.equal(proof.throwawayDirectories,0);assert.equal(proof.sentinelTabs,2);
        if(ending==='idle')assert.equal(proof.timerExited,true);
        rows.push({...item,...proof,scriptedHooks:true,fixtureOverrides:{localIdleSeconds:1,termGraceMs:1000},status:'passed'});
      } catch(error){rows.push({...item,scriptedHooks:true,status:'failed',error:{message:error.message,stack:error.stack}});}
      finally{if(handle)await dispose(handle);}
    }
  } finally {
    for(const handle of handles)await dispose(handle).catch(error=>rows.push({status:'failed',cleanupError:error.message}));
    if(sentinel)await sentinel.close();if(!providedFixture)await fixture.close();
    let raw=rows.map(row=>JSON.stringify(row)).join('\n')+'\n';
    for(const [path,alias] of [[ROOT,'$PACKAGE_ROOT'],[process.env.RUNNER_TEMP,'$RUNNER_TEMP'],[process.env.HOME,'$RUNNER_HOME']].filter(([path])=>path).sort((a,b)=>b[0].length-a[0].length))raw=raw.replaceAll(path,alias);
    await writeFile(join(out,'raw.jsonl'),raw);await writeFile(join(out,'raw.sha256'),createHash('sha256').update(raw).digest('hex')+'\n');
  }
  return {rows,status:rows.length===(items?.length||41)+(scriptedHooks?3:0)&&rows.every(row=>row.status==='passed')?'passed':'failed'};
}
export async function runE1(options={}) {
  requireCi(process.env,{authorizedBenchmark:options.authorizedBenchmark===true});
  const fixture=options.fixture||await startFixtureServer();
  try {return await executeE1({...options,fixture});}
  finally {if(!options.fixture)await fixture.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  if(!process.argv.includes('--ci'))throw new Error('E1_CI_REQUIRED');
  const result=await runE1();process.stdout.write(`E1 ${result.status}: ${result.rows.length} outcomes\n`);process.exitCode=result.status==='passed'?0:1;
}
