import { readFile, readdir, lstat, realpath } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { parseTranscript } from './claude-code.mjs';

function fail(message) { return Object.assign(new Error(message),{code:'METER_PATH',exitCode:2}); }
export function aggregate(steps) {
  const input=steps.reduce((sum,step)=>sum+step.input_tokens,0);
  const reread=steps.reduce((sum,step)=>sum+step.reread_tokens,0);
  return {kind:'local-meter',measurement:'cache-observed re-read share',
    interpretation:'Cache reads prove repeated input. Uncached repeated input is not identifiable from usage alone; this share is a lower bound.',
    steps:steps.length,input_tokens:input,output_tokens:steps.reduce((sum,step)=>sum+step.output_tokens,0),
    reread_tokens:reread,reread_share:input ? reread/input : 0,
    per_step:steps.map(({input_tokens,output_tokens,reread_tokens,reread_share,input_share},i)=>({step:i+1,input_tokens,output_tokens,reread_tokens,reread_share,input_share}))};
}
export async function meterFiles(path,root) {
  const base=await realpath(root);
  const target=resolve(path);
  const within=relative(base,target);
  if (within==='..' || within.startsWith(`..${process.platform==='win32'?'\\':'/'}`) || isAbsolute(within)) throw fail('Select a transcript inside the Claude Code projects directory.');
  const result=[];
  async function visit(current) {
    const stat=await lstat(current);
    if (stat.isSymbolicLink()) throw fail('Transcript paths must not contain symbolic links.');
    const actual=await realpath(current);
    if (actual!==current) throw fail('Transcript paths must not contain symbolic links.');
    if (stat.isDirectory()) {
      for (const entry of await readdir(current)) await visit(join(current,entry));
    } else if (stat.isFile() && current.endsWith('.jsonl')) result.push(current);
  }
  await visit(target);
  if (!result.length) throw fail('No JSONL transcript files found in the selected path.');
  return result.sort();
}
export async function meterCommand(args,{write=console.log,projectsRoot=join(homedir(),'.claude','projects')}={}) {
  let path=projectsRoot;
  for(let i=0;i<args.length;i++) {
    if(args[i]==='--path' && args[i+1]) path=resolve(args[++i]);
    else if(args[i]==='--json') continue;
    else throw Object.assign(new Error('meter accepts --path <transcript-or-directory> and --json'),{code:'USAGE',exitCode:2});
  }
  const files=await meterFiles(path,projectsRoot);
  const steps=[];
  for(const file of files) steps.push(...parseTranscript(await readFile(file,'utf8')));
  write(JSON.stringify({...aggregate(steps),files:files.length}));
  return 0;
}
