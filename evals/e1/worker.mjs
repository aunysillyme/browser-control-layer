import { createLedger } from '../../src/hygiene/ledger.mjs';
import { processAdapter } from '../../src/proc/table.mjs';
import { startLease, refreshLease } from '../../src/hygiene/lease.mjs';
import { cleanup } from '../../src/hygiene/cleanup.mjs';
import { requireCi } from '../../bench/p0/runtime.mjs';

const spec=JSON.parse(process.argv[2]);
requireCi(process.env,{authorizedBenchmark:spec.authorizedBenchmark===true});
const options={ledger:createLedger({root:spec.state}),processAdapter:processAdapter(),sessionKey:spec.session,termGraceMs:1000,budgets:spec.budget?{rssBytes:1}:{},stdio:'ignore'};
let started;
try {
  started=await startLease([spec.executable,'--user-data-dir={profile}','--headless=new','--no-sandbox','--remote-debugging-port=0',spec.url],options);
  if(!started.verified)throw new Error('E1_LEASE_IDENTITY');
  await new Promise(resolve=>setTimeout(resolve,500));await refreshLease(started.record,options);
  process.send({type:'ready',id:started.record.id});
} catch(error) {process.send({type:'failed',error:error.message});process.exitCode=1;process.disconnect();}
let ending;
async function finish(reason) {
  if(ending)return;ending=true;
  try {if(reason==='error')throw new Error('E1_SYNTHETIC_ERROR');}
  catch { /* A thrown job error still crosses finally. */ }
  finally {const result=await cleanup({...options,apply:true});console.error(JSON.stringify({ending:reason,line:result.line,actions:result.actions}));await started.completion;process.disconnect();}
}
process.on('message',message=>{if(message.type==='end')void finish(message.ending);});
process.on('SIGINT',()=>void finish('SIGINT'));
process.on('SIGTERM',()=>void finish('SIGTERM'));
