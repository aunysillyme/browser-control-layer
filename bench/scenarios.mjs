import { performance } from 'node:perf_hooks';
import { loopStop } from '../src/hooks/loop-stop.mjs';
import { screenRules } from '../src/read/screen/rules.mjs';

export const scenarios = Object.freeze([
  ['E1','crash matrix','leased, unleased'], ['H1','owner endings','baseline, sweep, lease'], ['H2','ten-minute idle','baseline, timer'], ['H3','run-created tabs','baseline, cleanup'], ['H4','sentinel safety','baseline, cleanup'], ['H5','package overhead','baseline, hooks and doctor'],
  ['R1','browser mode','shell, new headless, headed'], ['R2','browser allocation','one browser N tabs, N browsers'], ['R3','media requests','allowed, blocked'], ['R4','wait strategy','sleep, element, loop stop'], ['R5','extraction size','fields, text, screenshot'], ['R6','concurrency','1, 2, 4'], ['R7','idle tabs','idle, blank, closed'], ['S1','screen quality','planted, clean']
].map(([id,claim,arms])=>({id,claim,arms:arms.split(', '),subject:id[0]==='R'?'default':'package'})));
export function resourceTotals(rows) {
  const bad=rows.filter(row=>!Number.isFinite(row.rssBytes)||row.rssBytes<0||!Number.isFinite(row.cpuPercent)||row.cpuPercent<0);
  if(bad.length)throw new Error('BENCH_RESOURCES_UNVERIFIED: owned process metrics are incomplete: '+JSON.stringify(bad.map(row=>({pid:row.pid,ppid:row.ppid,rssBytes:row.rssBytes,cpuPercent:row.cpuPercent,readable:row.readable,exe:String(row.argv?.[0]).slice(-40)}))));
  return {rssBytes:rows.reduce((sum,row)=>sum+row.rssBytes,0),cpuPercent:rows.reduce((sum,row)=>sum+row.cpuPercent,0)};
}
const measured = row => Number.isFinite(row.rssBytes) && row.rssBytes >= 0 && Number.isFinite(row.cpuPercent) && row.cpuPercent >= 0;
// A process first seen by the adapter has no CPU interval yet; sample again until every selected row is measured.
export async function settledRows(adapter, select, { wait = ms => new Promise(resolve => setTimeout(resolve,ms)), intervalMs = 100, attempts = 5 } = {}) {
  await adapter.list();
  let rows = [];
  for(let attempt=0;attempt<attempts;attempt++) {
    await wait(intervalMs);
    rows=select(await adapter.list());
    if(rows.every(measured))break;
  }
  return rows;
}
export async function sampleOwnedResources(adapter, rootPid, options) {
  return resourceTotals(await settledRows(adapter, table => {
    const ids=new Set([rootPid]);
    for(let changed=true;changed;) {changed=false;for(const row of table)if(ids.has(row.ppid)&&!ids.has(row.pid)){ids.add(row.pid);changed=true;}}
    if(!table.some(row=>row.pid===rootPid))throw new Error('BENCH_RESOURCES_UNVERIFIED: live browser root absent');
    return table.filter(row=>ids.has(row.pid));
  }, options));
}
export function quantile(values, q) {
  if (!values.length || values.some(value => !Number.isFinite(value))) throw new Error('BENCH_SAMPLES: finite measurements required');
  const sorted = [...values].sort((a,b)=>a-b), index = (sorted.length-1)*q, floor = Math.floor(index);
  return sorted[floor]+(sorted[Math.ceil(index)]-sorted[floor])*(index-floor);
}
export function aggregate(samples) { return { n:samples.length, median:quantile(samples,.5), p25:quantile(samples,.25), p75:quantile(samples,.75) }; }
export function screenSamples(pages) {
  if (!pages.some(page=>page.planted) || !pages.some(page=>!page.planted)) throw new Error('SCREEN_CORPUS: planted and fetched clean pages required');
  const samples = pages.map(page=>({...page, result:screenRules(page.text)}));
  const planted=samples.filter(page=>page.planted), clean=samples.filter(page=>!page.planted);
  return { samples, recall:planted.filter(page=>page.result.status==='flagged').length/planted.length, falseAlarmRate:clean.filter(page=>page.result.status==='flagged').length/clean.length };
}

export async function loopFixture({ waitForReady, cap, session = 'loop' }) {
  let state={}, attempts=0;
  const ledger={updateSession:async(key,update)=>{state=await update(state);}};
  const event={event:'PreToolUse',sessionKey:session,input:{tab_id:'fixture'}};
  const tool={driverId:'fixture',action:'browser_wait_for'};
  for(;;) {
    const result=await loopStop(event,tool,{ledger,limits:{waitCap:cap}});
    if(result.hookSpecificOutput?.permissionDecision==='deny')return {ready:false,blocked:true,attempts};
    attempts++;
    if(await waitForReady())return {ready:true,blocked:false,attempts};
  }
}
// The benchmark owns these browser instances. Production src/ never drives pages.
export async function resourceSamples({ puppeteer, url, sampleResources, n = 3 }) {
  const rows=[];
  const launch = async (extra={}) => puppeteer.launch({headless:true,args:['--no-sandbox'],...extra});
  for(let repeat=0;repeat<n;repeat++) {
    for(const mode of ['shell',true,false]) {
      const start=performance.now(), browser=await launch({headless:mode});
      try { const page=await browser.newPage();await page.goto(url+'/list'); rows.push({id:'R1',arm:String(mode),repeat,value:performance.now()-start,unit:'ms',resources:await sampleResources(browser)}); } finally {await browser.close();}
    }
    for(const count of [1,2,4]) for(const separate of [false,true]) {
      const browsers=[];const start=performance.now();
      try { browsers.push(await launch());for(let i=0;i<count;i++){if(separate&&i) browsers.push(await launch());const page=await browsers.at(-1).newPage();await page.goto(url+'/list');} rows.push({id:'R2',arm:`${separate?'browsers':'tabs'}-${count}`,repeat,value:(await Promise.all(browsers.map(sampleResources))).reduce((s,r)=>s+r.rssBytes,0),unit:'bytes',elapsedMs:performance.now()-start}); } finally {await Promise.all(browsers.map(browser=>browser.close()));}
    }
    const browser=await launch();
    try {
      for(const blocked of [false,true]) {
        const page=await browser.newPage();let bytes=0;const session=await page.createCDPSession();await session.send('Network.enable');session.on('Network.loadingFinished',event=>{bytes+=event.encodedDataLength;});
        await page.setRequestInterception(true);page.on('request',request=>blocked&&['image','media','font'].includes(request.resourceType())?request.abort():request.continue());
        const start=performance.now();await page.goto(url+'/list');rows.push({id:'R3',arm:blocked?'blocked':'allowed',repeat,value:bytes,unit:'bytes',elapsedMs:performance.now()-start});await page.close();
      }
      for(const mode of ['sleep','element']) {
        const page=await browser.newPage();const start=performance.now();await page.goto(url+'/slow');if(mode==='sleep')await new Promise(resolve=>setTimeout(resolve,1500));else await page.waitForSelector('#ready');rows.push({id:'R4',arm:mode,repeat,value:performance.now()-start,unit:'ms',success:await page.$('#ready')!==null});await page.close();
      }
      let selected;
      for(const cap of [1,2,4,8,16]) {
        const page=await browser.newPage();const start=performance.now();
        try {await page.goto(url+'/slow');const result=await loopFixture({cap,waitForReady:async()=>{try {await page.waitForSelector('#ready',{timeout:100});return true;}catch{return false;}}});rows.push({id:'R4',arm:`loop-cap-${cap}`,repeat,value:performance.now()-start,unit:'ms',cap,...result});if(result.ready){selected=cap;break;}}
        finally{await page.close();}
      }
      if(!selected)throw new Error('R4_CALIBRATION: all candidate wait caps refused a progressing page');
      const spinner=await browser.newPage();
      try {await spinner.goto(url+'/spinner');const start=performance.now();const result=await loopFixture({cap:selected,waitForReady:async()=>{try{await spinner.waitForSelector('#ready',{timeout:100});return true;}catch{return false;}}});if(!result.blocked)throw new Error('R4_CALIBRATION: infinite spinner was not refused');rows.push({id:'R4',arm:'loop-refusal',repeat,value:performance.now()-start,unit:'ms',selectedCap:selected,...result});}
      finally{await spinner.close();}
      const page=await browser.newPage();await page.goto(url+'/list');
      for(const mode of ['fields','text','screenshot']) {const result=mode==='fields'?JSON.stringify(await page.$$eval('[data-price]',els=>els.map(el=>el.textContent))):mode==='text'?await page.evaluate(()=>document.body.innerText):await page.screenshot();rows.push({id:'R5',arm:mode,repeat,value:Buffer.byteLength(result),unit:'bytes'});}
      await page.close();
      for(const concurrency of [1,2,4]) {const start=performance.now();const pages=await Promise.all(Array.from({length:concurrency},()=>browser.newPage()));try{await Promise.all(pages.map(page=>page.goto(url+'/memory')));rows.push({id:'R6',arm:String(concurrency),repeat,value:performance.now()-start,unit:'ms',resources:await sampleResources(browser)});}finally{await Promise.all(pages.map(page=>page.close()));}}
      for(const mode of ['idle','blank','closed']) {const page=await browser.newPage();await page.goto(url+'/memory');if(mode==='blank')await page.goto('about:blank');if(mode==='closed')await page.close();await new Promise(resolve=>setTimeout(resolve,250));rows.push({id:'R7',arm:mode,repeat,value:(await sampleResources(browser)).rssBytes,unit:'bytes'});if(mode!=='closed')await page.close();}
    } finally {await browser.close();}
  }
  return rows;
}
