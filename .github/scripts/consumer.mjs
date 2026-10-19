import { mkdtempSync,readFileSync,readdirSync,writeFileSync,rmSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
const root=process.cwd(), pkg=JSON.parse(readFileSync('package.json','utf8'));
const tarball=resolve('packed',readdirSync('packed').find(name=>name.endsWith('.tgz')));
const cwd=mkdtempSync(join(tmpdir(),'packed-consumer-'));
function run(command,args,accepted=[0]) {
  const result=spawnSync(command,args,{cwd,encoding:'utf8',shell:process.platform==='win32' && command==='npm.cmd',env:{...process.env,AUN_STATE_DIR:join(cwd,'state')}});
  process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || '');
  if(result.error || !accepted.includes(result.status)) throw result.error || Error(`Consumer command exited ${result.status}`);
  return result;
}
try {
  writeFileSync(join(cwd,'package.json'),JSON.stringify({name:'packed-consumer',version:'1.0.0',private:true}));
  run(process.platform==='win32'?'npm.cmd':'npm',['install','--offline','--ignore-scripts','--omit=dev','--no-audit','--no-fund','--package-lock=false',tarball]);
  const packageRoot=join(cwd,'node_modules',pkg.name),bin=join(packageRoot,Object.values(pkg.bin)[0]);
  const doctor=run(process.execPath,[bin,'doctor','--json'],[0,3]);
  const result=JSON.parse(doctor.stdout);
  if(typeof result.verified!=='boolean') throw Error('Doctor did not produce its documented report');
  if(doctor.status===3 && result.verified) throw Error('Doctor verification status disagrees with exit code');
  run(process.execPath,[bin,'install','--host','claude-code','--dry-run']);
  // Exercise the same plan/apply implementation after explicit CI fixture confirmation.
  const {pathToFileURL}=await import('node:url');
  const {planInstall,applyInstall}=await import(pathToFileURL(join(packageRoot,'src/install/index.mjs')));
  applyInstall(planInstall({root:packageRoot,cwd,host:'claude-code'}),cwd);
  run(process.execPath,[bin,'uninstall']);
} finally { rmSync(cwd,{recursive:true,force:true}); }
