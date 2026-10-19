import { readFileSync, writeFileSync, mkdirSync, lstatSync, unlinkSync, openSync, closeSync, fstatSync, realpathSync } from 'node:fs';
import { resolve, dirname, relative, sep, parse } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { constants } from 'node:fs';
import { config, ROOT } from '../config.mjs';
import { files, read, digest } from '../build/bundle.mjs';
import { catalog, companions, renderRunner } from './catalog.mjs';

const fail=message=>{ throw Object.assign(Error(message),{code:'INSTALL_REFUSED',exitCode:3}); };
function stat(path) { try { return lstatSync(path); } catch(error) { if(error.code==='ENOENT') return null; throw error; } }
export function safePath(root, path) {
  if(typeof path!=='string' || !path || path.includes('\\') || path.split('/').includes('..') || path.startsWith('/') || /^[A-Za-z]:/.test(path)) fail('Invalid project-relative path');
  const base=realpathSync(root), full=resolve(base,path);
  if(!full.startsWith(base+sep)) fail('Path escapes project');
  let part=base;
  for(const segment of relative(base,full).split(sep)) {
    part=resolve(part,segment); const info=stat(part);
    if(info?.isSymbolicLink()) fail('Symlink path refused');
    if(part!==full && info && !info.isDirectory()) fail('Parent is not a directory');
  }
  return full;
}
function current(root,path) {
  const full=safePath(root,path), info=stat(full);
  if(!info) return null;
  if(!info.isFile() || info.nlink!==1) fail(`Regular single-link file required: ${path}`);
  return readFileSync(full,'utf8');
}
function replace(root,path,before,after) {
  if(current(root,path)!==before) fail(`Changed since preview: ${path}`);
  const full=safePath(root,path); mkdirSync(dirname(full),{recursive:true}); safePath(root,path);
  const fd=openSync(full,before===null?'wx':constants.O_WRONLY | (constants.O_NOFOLLOW || 0),0o600);
  try {
    if(fstatSync(fd).nlink!==1) fail('Hard link refused');
    if(before!==null) {
      const actual=readFileSync(full,'utf8');
      if(actual!==before) fail(`Changed before write: ${path}`);
      // Write through the verified descriptor after all preflight checks.
      const { size }=fstatSync(fd);
      if(size!==Buffer.byteLength(before)) fail('File changed before write');
    }
    writeFileSync(fd,after);
    // The replacement can be shorter than the original.
    return fd;
  } catch(error) { closeSync(fd); throw error; }
}
function write(root,path,before,after) {
  const fd=replace(root,path,before,after);
  try { truncate(fd,Buffer.byteLength(after)); } finally { closeSync(fd); }
}
import { ftruncateSync as truncate } from 'node:fs';
function block(text,body,name) {
  const start=`<!-- ${name}:start -->`, end=`<!-- ${name}:end -->`;
  if(text.includes(start) || text.includes(end)) fail('Existing integration block requires uninstall first');
  return `${text}${text && !text.endsWith('\n')?'\n':''}\n${start}\n${body}\n${end}\n`;
}
export function planInstall({root=ROOT,cwd=process.cwd(),host='claude-code'}={}) {
  const cfg=config(root), target=catalog(cfg).find(item=>item.id===host);
  if(!target) fail(`Unknown host: ${host}`);
  const state=`.${cfg.skillName}`, receiptPath=`${state}/install.json`, old=current(cwd,receiptPath);
  if(old!==null) fail('An install receipt exists; uninstall before replacing this installation');
  const entries=[];
  const add=(path,body,merge=false)=>{
    const before=current(cwd,path);
    if(before!==null && before!==body && !merge) fail(`File conflict: ${path}`);
    if(entries.some(entry=>entry.path===path)) fail(`Duplicate target: ${path}`);
    entries.push({path,before,body,sha256:digest(body),action:before===body?'existing':before===null?'create':'replace'});
  };
  if(target.id==='zero-install') return {host,target,entries,receiptPath:null,companions};
  for(const path of files(root,cfg.core)) add(`${target.skill}/${path.slice(cfg.core.length+1)}`,read(root,path));
  const template=read(root,`${cfg.core}/runners/aun-runner-browser.template.md`);
  const command=`npx ${cfg.name}`;
  add(target.runner,renderRunner(template,target,command));
  if(target.context) {
    const instruction=`For browser work on public pages, read ${target.skill}/SKILL.md and follow its steps. End each job with the cleanup line.\nUse ${target.runner} for a fresh browser runner.`;
    const before=current(cwd,target.context) || '';
    const header=target.id==='cursor' && !before?'---\ndescription: Browser work on public pages\nalwaysApply: false\n---\n':'';
    add(target.context,block(before || header,instruction,cfg.skillName),true);
  }
  if(target.hooks) {
    const runtime=`${state}/runtime`;
    for(const path of [...files(root,'src'),...files(root,'bin'),...files(root,cfg.core),'package.json','bench/drivers.json']) add(`${runtime}/${path}`,read(root,path));
    const hookSpec=JSON.parse(read(root,'hooks/hooks.json')).hooks;
    const hookPath=resolve(cwd,runtime,'src/hooks/cli.mjs');
    if(/["$`\r\n]/.test(hookPath)) fail('Project path cannot be quoted safely in hook commands');
    const replacement=JSON.parse(JSON.stringify(hookSpec).replaceAll('${CLAUDE_PLUGIN_ROOT}/src/hooks/cli.mjs',hookPath.replaceAll('\\','/')));
    const path='.claude/settings.json', before=current(cwd,path), settings=before===null?{}:JSON.parse(before);
    if(!settings || Array.isArray(settings) || typeof settings!=='object' || settings.hooks && (Array.isArray(settings.hooks)||typeof settings.hooks!=='object')) fail('Invalid project hook settings');
    const hooks={...settings.hooks};
    for(const [event,items] of Object.entries(replacement)) {
      if(hooks[event] && !Array.isArray(hooks[event])) fail(`Invalid hook event: ${event}`);
      hooks[event]=[...(hooks[event] || []),...items];
    }
    add(path,JSON.stringify({...settings,hooks},null,2)+'\n',true);
  }
  for(const entry of [...entries]) if(entry.action==='replace') {
    entry.backup=`${state}/backups/${digest(entry.path)}.txt`;
    add(entry.backup,entry.before);
  }
  entries.sort((a,b)=>Number(Boolean(b.path.includes('/backups/')))-Number(Boolean(a.path.includes('/backups/'))));
  return {host,target,entries,receiptPath,companions};
}
export function applyInstall(plan,cwd) {
  if(!plan.receiptPath) return null;
  for(const entry of plan.entries) if(current(cwd,entry.path)!==entry.before) fail(`Changed since preview: ${entry.path}`);
  if(current(cwd,plan.receiptPath)!==null) fail('Receipt appeared since preview');
  const receipt={schemaVersion:1,host:plan.host,files:[],activation:'UNVERIFIED'};
  // Write the receipt first, then persist each landed file so an interrupted install remains recoverable.
  let receiptText=JSON.stringify(receipt,null,2)+'\n'; write(cwd,plan.receiptPath,null,receiptText);
  for(const entry of plan.entries) {
    if(entry.action!=='existing') write(cwd,entry.path,entry.before,entry.body);
    if(digest(current(cwd,entry.path))!==entry.sha256) fail(`Read-back failed: ${entry.path}`);
    receipt.files.push({path:entry.path,sha256:entry.sha256,action:entry.action,...(entry.backup?{backup:entry.backup,originalSha256:digest(entry.before)}:{})});
    const next=JSON.stringify(receipt,null,2)+'\n'; write(cwd,plan.receiptPath,receiptText,next); receiptText=next;
  }
  return receipt;
}
function parseArgs(args) {
  const result={};
  for(let i=0;i<args.length;i++) {
    if(args[i]==='--dry-run') result.dryRun=true;
    else if(args[i]==='--host' && args[i+1]) result.host=args[++i];
    else throw Object.assign(Error(`Unknown install argument: ${args[i]}`),{code:'USAGE',exitCode:2});
  }
  return result;
}
export async function installCommand(args=[],options={}) {
  const {root=ROOT,cwd=process.cwd(),write:output=console.log}=options;
  let {host='claude-code',dryRun=false}=parseArgs(args), ui;
  const prompt=options.prompt || (async question=>{
    if(!process.stdin.isTTY) fail('Interactive confirmation required; use --dry-run to inspect');
    ui ||= createInterface({input:process.stdin,output:process.stdout}); return ui.question(question);
  });
  try {
    while(true) {
      const plan=planInstall({root,cwd,host});
      output(JSON.stringify({host,files:plan.entries.map(({path,sha256,action})=>({path,sha256,action})),receipt:plan.receiptPath,companions:plan.companions},null,2));
      if(dryRun) return 0;
      const answer=(await prompt('Install this plan? [y/N/edit <host>] ')).trim();
      if(answer.startsWith('edit ')) { host=answer.slice(5).trim(); output(`Hosts: ${catalog(config(root)).map(item=>item.id).join(', ')}`); continue; }
      if(!/^y(?:es)?$/i.test(answer)) { output('Install cancelled.'); return 0; }
      applyInstall(plan,cwd); output('Install complete. Activation: UNVERIFIED.'); return 0;
    }
  } finally { ui?.close(); }
}
export async function uninstallCommand(args=[],{root=ROOT,cwd=process.cwd(),write:output=console.log}={}) {
  const {dryRun}=parseArgs(args), cfg=config(root), receiptPath=`.${cfg.skillName}/install.json`, text=current(cwd,receiptPath);
  if(text===null) { output('Install receipt absent; nothing changed.'); return 2; }
  const receipt=JSON.parse(text);
  if(receipt.schemaVersion!==1 || !Array.isArray(receipt.files)) fail('Invalid install receipt');
  const retained=[], changes=[];
  for(const entry of receipt.files) {
    if(!['create','replace','existing'].includes(entry.action) || !/^[a-f0-9]{64}$/.test(entry.sha256)) fail('Invalid receipt entry');
    const body=current(cwd,entry.path);
    if(entry.action==='existing' || body===null) continue;
    if(digest(body)!==entry.sha256) { retained.push(entry); continue; }
    const backup=entry.backup?current(cwd,entry.backup):null;
    if(entry.action==='replace' && (backup===null || digest(backup)!==entry.originalSha256)) { retained.push(entry); continue; }
    changes.push({entry,body,backup});
  }
  const protectedBackups=new Set(retained.map(entry=>entry.backup).filter(Boolean));
  for(const {entry,body,backup} of changes) {
    if(protectedBackups.has(entry.path)) { retained.push(entry); continue; }
    output(`${entry.action==='replace'?'restore':'remove'}: ${entry.path}`);
    if(dryRun) continue;
    if(current(cwd,entry.path)!==body) fail(`Changed during uninstall: ${entry.path}`);
    if(entry.action==='replace') write(cwd,entry.path,body,backup); else unlinkSync(safePath(cwd,entry.path));
  }
  if(!dryRun) {
    if(retained.length) write(cwd,receiptPath,text,JSON.stringify({...receipt,files:retained},null,2)+'\n');
    else { if(current(cwd,receiptPath)!==text) fail('Receipt changed'); unlinkSync(safePath(cwd,receiptPath)); }
  }
  output(`Kept edited files: ${retained.length}`); return 0;
}
