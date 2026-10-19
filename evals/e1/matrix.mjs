export function crashMatrix(catalog) {
  const rows=[];
  for(const ending of ['normal','error','SIGINT','SIGTERM','SIGKILL']) for(let repeat=1;repeat<=4;repeat++) rows.push({arm:'leased',ending,repeat});
  for(let repeat=1;repeat<=5;repeat++) rows.push({arm:'leased',ending:'idle',repeat});
  rows.push({arm:'leased',ending:'budget',repeat:1});
  for(const driver of catalog.drivers) {
    for(const ending of ['SIGTERM','SIGKILL'])for(let repeat=1;repeat<=2;repeat++) rows.push({arm:'unleased',driver:driver.id,ending,repeat});
    rows.push({arm:'unleased',driver:driver.id,ending:'idle',repeat:1});
  }
  return rows.map((row,index)=>({...row,id:`E1-${index+1}`}));
}
export function outcomeIssues(row) {
  const issues=[];
  for(const key of ['ownedProcesses','ownedRssBytes','throwawayDirectories','runTabs','wrongKills']) if(row[key]!==0)issues.push(key);
  if(row.sentinelAlive!==true||row.sentinelTabs!==2)issues.push('sentinel');
  if(row.persistentDirectoriesKept!==true)issues.push('persistentDirectoriesKept');
  if(row.ending==='idle'&&(row.idleClosed!==true||row.timerExited!==true))issues.push('idleTimer');
  if(row.ending==='budget'&&row.budgetWarning!==true)issues.push('budgetWarning');
  return issues;
}
export async function executeMatrix(items, adapter) {
  const rows=[];
  for(const item of items) {
    let handle;
    try {handle=await adapter.start(item);await adapter.end(handle,item);const observation=await adapter.observe(handle,item);const issues=outcomeIssues({...item,...observation});rows.push({...item,...observation,status:issues.length?'failed':'passed',issues});}
    catch(error){handle??=error.handle;rows.push({...item,status:'failed',error:{name:error.name,message:error.message,stack:error.stack}});}
    finally {if(handle)try{await adapter.dispose(handle);}catch(error){rows.at(-1).status='failed';rows.at(-1).cleanupError=error.message;}}
  }
  return rows;
}
