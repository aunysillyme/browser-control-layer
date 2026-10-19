import { spawn } from 'node:child_process';

export function validateResult(result,request) {
  const invalid=detail=>{throw Object.assign(new Error(`Harness result invalid: ${detail}`),{code:'HARNESS_RESULT',exitCode:4});};
  if(!result || typeof result!=='object' || result.protocol!==1) invalid('protocol must be 1');
  for(const field of ['tokens','tool_calls','owned_processes_left','prefill_tokens']) if(!Number.isSafeInteger(result.metrics?.[field]) || result.metrics[field]<0) invalid(`metrics.${field} must be a nonnegative integer`);
  if(typeof result.metrics.ownership_verified!=='boolean') invalid('ownership_verified must be boolean');
  if(result.metrics.reread_share!==null && (!Number.isFinite(result.metrics.reread_share) || result.metrics.reread_share<0 || result.metrics.reread_share>1)) invalid('reread_share must be a fraction or null');
  for(const key of ['harness','model_id','driver']) if(typeof result.versions?.[key]!=='string' || !result.versions[key]) invalid(`versions.${key} required`);
  if(result.versions.model_id!==request.model || result.versions.driver!==request.driver) invalid('host, model and driver must stay fixed per pair');
  if(result.harness!==request.harness) invalid('harness differs from requested host');
  if(typeof result.elapsed_ms!=='number' || result.elapsed_ms<0) invalid('elapsed_ms required');
  if(request.context_tokens && result.metrics.prefill_tokens!==request.context_tokens) invalid('C2 requires exact measured context prefill; rejected or truncated context cannot be a curve point');
  if(request.arm==='package' && !['skill','hooks','runner'].every(component=>result.loaded?.includes(component))) invalid('installed skill, hooks and runner must have loading evidence');
  if(request.arm==='baseline' && result.loaded?.length) invalid('baseline must run without package components');
  if(!result.result || typeof result.result!=='object') invalid('structured task result required');
  return result;
}

// The executable is supplied by the user. It owns host startup, instrumentation
// and shutdown, and receives a protocol request on stdin. No shell is involved.
export function executeHarness(command,request,{spawnProcess=spawn}={}) {
  return new Promise((resolve,reject)=>{
    const child=spawnProcess(command,[],{cwd:request.cwd,stdio:['pipe','pipe','pipe'],windowsHide:true});
    let output='',stderr='';
    child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
    child.stdout.on('data',chunk=>{output+=chunk;});child.stderr.on('data',chunk=>{stderr+=chunk;});
    child.on('error',reject);
    child.on('close',code=>{
      if(code!==0) return reject(Object.assign(new Error(`Harness exited ${code}: ${stderr}`),{code:'HARNESS_FAILED',exitCode:4}));
      try {const result=JSON.parse(output);resolve({result:validateResult(result,request),raw:output});}
      catch(error){reject(error.code ? error : Object.assign(new Error(`Harness must return one protocol JSON object: ${error.message}`),{code:'HARNESS_RESULT',exitCode:4}));}
    });
    child.stdin.on('error',()=>{});
    child.stdin.end(JSON.stringify(request));
  });
}

export function parseCodexEvents(raw) {
  let tokens=0,toolCalls=0,text='',knownUsage=false,cached=0,input=0;
  const counted=new Set();
  for(const line of raw.split('\n').filter(Boolean)) {
    let event;try{event=JSON.parse(line);}catch{throw Object.assign(new Error('Unknown Codex JSON event stream'),{code:'HARNESS_RESULT',exitCode:4});}
    if(event.type==='turn.failed' || event.type==='error') throw Object.assign(new Error('Codex reported a failed turn'),{code:'HARNESS_FAILED',exitCode:4});
    if(event.type==='turn.completed' && event.usage) {
      const usage=event.usage;
      if(!['input_tokens','output_tokens'].every(key=>Number.isSafeInteger(usage[key])&&usage[key]>=0)) throw Object.assign(new Error('Unknown Codex usage shape'),{code:'HARNESS_RESULT',exitCode:4});
      knownUsage=true;input+=usage.input_tokens;tokens+=usage.input_tokens+usage.output_tokens;cached+=usage.cached_input_tokens||0;
    }
    const item=event.item;
    if(event.type==='item.completed' && item?.type==='agent_message') text=item.text;
    if(event.type==='item.completed' && ['mcp_tool_call','command_execution','web_search'].includes(item?.type) && !counted.has(item.id)) {counted.add(item.id);toolCalls++;}
  }
  if(!knownUsage) throw Object.assign(new Error('Codex usage was not recorded'),{code:'HARNESS_RESULT',exitCode:4});
  let result;try{result=JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g,''));}catch{result={unparsed:true};}
  return {result,metrics:{tokens,tool_calls:toolCalls,reread_share:input?cached/input:0,prefill_tokens:0,owned_processes_left:null,ownership_verified:false}};
}
export async function inspectNativeOwnership(hostPid) {
  const [{doctor},{createLedger},{processAdapter}]=await Promise.all([import('../src/hygiene/doctor.mjs'),import('../src/hygiene/ledger.mjs'),import('../src/proc/table.mjs')]);
  const ledger=createLedger();
  const records=await ledger.list();
  const ownIds=new Set(records.filter(record=>record.hostPid===hostPid).map(record=>record.pid));
  const report=await doctor({ledger,processAdapter:processAdapter()});
  return {probe_verified:report.verified,ledger_records:ownIds.size,owned_detected:report.rows.filter(row=>row.owned&&ownIds.has(row.pid)).length};
}
export function executeCodex(request,{spawnProcess=spawn,inspectOwnership=inspectNativeOwnership}={}) {
  if(request.context_tokens) throw Object.assign(new Error('C2 exact context prefill requires --harness-command with tokenizer instrumentation.'),{code:'CONTEXT_INSTRUMENTATION_REQUIRED',exitCode:2});
  return new Promise((resolve,reject)=>{
    const args=['exec','--json','--ephemeral','--skip-git-repo-check','--cd',request.cwd,'--model',request.model,'-'];
    const child=spawnProcess('codex',args,{cwd:request.cwd,stdio:['pipe','pipe','pipe'],windowsHide:true});
    let raw='',stderr='';const started=Date.now();
    child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
    child.stdout.on('data',chunk=>{raw+=chunk;});child.stderr.on('data',chunk=>{stderr+=chunk;});child.on('error',reject);
    child.on('close',async code=>{
      if(code!==0)return reject(Object.assign(new Error(`Codex exited ${code}: ${stderr}`),{code:'HARNESS_FAILED',exitCode:4}));
      try {const ownership=await inspectOwnership(child.pid).catch(error=>({probe_verified:false,reason:error.code || 'UNVERIFIED'}));
        resolve({raw,result:{protocol:1,harness:'codex',ownership,...parseCodexEvents(raw),elapsed_ms:Date.now()-started,versions:{harness:request.harness_version,model_id:request.model,driver:request.driver},loaded:[],unverified:['package loading','host global instruction isolation','ownership leftovers']}});}catch(error){reject(error);}
    });
    child.stdin.on('error',()=>{});
    child.stdin.end(`${request.prompt}\nUse the configured ${request.driver} browser driver. ${request.arm==='package'?'Load the installed skill and its generated runner in this project.':'Use your usual browser workflow.'} Close the resources you opened before returning the task result JSON.`);
  });
}
