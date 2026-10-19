import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { crashMatrix, outcomeIssues, executeMatrix } from '../evals/e1/matrix.mjs';
import { RECIPES, matchRecipe } from '../src/hygiene/recipes.mjs';
const catalog=JSON.parse(readFileSync(new URL('../bench/drivers.json',import.meta.url)));
const passed={ownedProcesses:0,ownedRssBytes:0,throwawayDirectories:0,runTabs:0,wrongKills:0,sentinelAlive:true,sentinelTabs:2,persistentDirectoriesKept:true,idleClosed:true,timerExited:true,budgetWarning:true};
test('E1 enumerates exactly the specified leased and unleased endings',()=>{
  const rows=crashMatrix(catalog);assert.equal(rows.length,41);assert.equal(rows.filter(row=>row.arm==='leased'&&!['idle','budget'].includes(row.ending)).length,20);assert.equal(rows.filter(row=>row.arm==='leased'&&row.ending==='idle').length,5);assert.equal(rows.filter(row=>row.arm==='unleased'&&row.ending!=='idle').length,12);assert.equal(rows.filter(row=>row.arm==='unleased'&&row.ending==='idle').length,3);assert.equal(rows.filter(row=>row.ending==='budget').length,1);
});
test('E1 refuses each violated outcome and accepts complete observed control',()=>{
  assert.deepEqual(outcomeIssues({...passed,ending:'idle'}),[]);
  for(const key of ['ownedProcesses','ownedRssBytes','throwawayDirectories','runTabs','wrongKills'])assert.ok(outcomeIssues({...passed,[key]:1}).includes(key));
  assert.ok(outcomeIssues({...passed,sentinelTabs:1}).includes('sentinel'));assert.ok(outcomeIssues({...passed,ending:'idle',timerExited:false}).includes('idleTimer'));assert.ok(outcomeIssues({...passed,persistentDirectoriesKept:false}).includes('persistentDirectoriesKept'));assert.ok(outcomeIssues({...passed,ending:'budget',budgetWarning:false}).includes('budgetWarning'));
});
test('matrix observes before final cleanup and retains failed measurements',async()=>{
  const order=[];const adapter={start:async()=>{order.push('start');return {};},end:async()=>order.push('end'),observe:async()=>{order.push('observe');return passed;},dispose:async()=>order.push('dispose')};
  assert.equal((await executeMatrix([{ending:'idle'}],adapter))[0].status,'passed');assert.deepEqual(order,['start','end','observe','dispose']);
  const failed=await executeMatrix([{}],{...adapter,observe:async()=>({...passed,wrongKills:1})});assert.equal(failed[0].status,'failed');
});
test('pinned recipes refuse unrelated profile and version and allow vendor-owned control',()=>{
  const recipe=RECIPES.find(row=>row.id==='playwright-mcp');const row={readable:true,executable:'/synthetic/chrome',argv:['chrome','--remote-debugging-pipe','--user-data-dir=/synthetic/cache/ms-playwright/mcp-fixture']};
  assert.equal(matchRecipe(row,{versions:{[recipe.id]:recipe.version}})?.id,recipe.id);assert.equal(matchRecipe(row,{versions:{[recipe.id]:'0.0.0'}}),null);assert.equal(matchRecipe({...row,argv:['chrome','--remote-debugging-pipe','--user-data-dir=/synthetic/personal']},{versions:{[recipe.id]:recipe.version}}),null);
});

test('saved recipe version authorizes idle cleanup only when pinned and matching',async()=>{
  const { leasedFixture }=await import('./fixtures/hygiene/fakes.mjs');
  const { cleanup }=await import('../src/hygiene/cleanup.mjs');
  for(const version of ['1','2']) {
    const f=await leasedFixture();const record={...f.record,kind:'recipe',driverId:'fixture',driverVersion:version,parentPid:50,parentStartTime:'start-50',profileClass:'driver-persistent'};
    await f.ledger.write(record);
    const recipes=[{id:'fixture',version:'1',executables:['chrome'],automationFlags:[],matchesProfile:path=>path===record.userDataDir,profileClass:'driver-persistent'}];
    await cleanup({...f,recipes,mode:'idle',apply:true});assert.equal(f.processAdapter.signals.length,version==='1'?1:0);assert.equal(f.fs.entries.has(record.userDataDir),true);
  }
});
test('stamp-derived version stays within the selected session and host ancestry',async()=>{
  const { leasedFixture,processRow }=await import('./fixtures/hygiene/fakes.mjs');
  const { stampActivity }=await import('../src/hygiene/ledger.mjs');
  const { discoverRuns }=await import('../src/hygiene/sweep.mjs');
  const f=await leasedFixture();
  const path='/state/driver-profile';await f.fs.mkdir(path,{mode:0o700});
  f.processAdapter.state.set(200,processRow(200,{ppid:50,executable:'/node',argv:['/node','/driver/main.mjs']}));
  f.processAdapter.state.set(300,processRow(300,{ppid:200,argv:['/test/chrome',`--user-data-dir=${path}`]}));
  const recipes=[{id:'fixture',version:'1',executables:['chrome'],automationFlags:[],matchesProfile:p=>p===path,profileClass:'driver-persistent',driverExecutables:['/node'],driverArg:arg=>arg==='/driver/main.mjs'}];
  await stampActivity({...f,sessionKey:'other',hostPid:50,hostStartTime:'start-50',driverId:'fixture',driverVersion:'1'});
  assert.equal((await discoverRuns({...f,sessionKey:'selected',recipes})).discovered.length,0);
  await stampActivity({...f,sessionKey:'selected',hostPid:50,hostStartTime:'start-50',driverId:'fixture',driverVersion:'1'});
  assert.equal((await discoverRuns({...f,sessionKey:'selected',recipes})).discovered.length,1);
});
test('hook version environment refuses drift and accepts the exact catalog version',async()=>{
  const {leasedFixture}=await import('./fixtures/hygiene/fakes.mjs');const {stamp}=await import('../src/hooks/stamp.mjs');
  for(const version of [catalog.drivers[0].version,'0.0.0']) {
    const f=await leasedFixture();let recorded;
    await stamp({sessionKey:'event'}, {driverId:'playwright-mcp'}, {...f,hostPid:50,env:{AUN_DRIVER_VERSION:version},stampActivity:async value=>{recorded=value;},discoverRuns:async()=>({discovered:[]})});
    assert.equal(recorded.driverVersion,version===catalog.drivers[0].version?version:undefined);
  }
});
test('budget warning comes from the package only for an eligible exceeded budget',async()=>{
  const {leasedFixture}=await import('./fixtures/hygiene/fakes.mjs');const {cleanup}=await import('../src/hygiene/cleanup.mjs');
  const exceeded=await leasedFixture({budgets:{rssBytes:1}});assert.match((await cleanup({...exceeded,mode:'budget',apply:true})).warnings[0],/Resource budget exceeded/);
  const below=await leasedFixture({budgets:{rssBytes:1000}});assert.deepEqual((await cleanup({...below,mode:'budget',apply:true})).warnings,[]);
});
