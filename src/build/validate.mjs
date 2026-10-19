import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { config } from '../config.mjs';
import { files, read, digest, generated, owned } from './bundle.mjs';
import { linkIssues, workflowIssues, fenced } from './inherited.mjs';
import { proofBlock } from './pack.mjs';
import { validateRow } from '../../bench/run.mjs';

export const STUB = '<!-- stub: written in the prose step -->';
export const CODES = [
  'PRIVACY','PRIVACY_NAME','VOICE','LINK','WORKFLOW_FORMAT','WORKFLOW_PERMISSIONS',
  'WORKFLOW_CONCURRENCY','WORKFLOW_TRIGGER','WORKFLOW_INJECTION','WORKFLOW_CREDENTIALS',
  'WORKFLOW_TIMEOUT','ACTION_PIN','ACTION_LABEL','CLAIM_EVIDENCE','FLOOR','MANIFEST',
  'SOURCE_HASH','BUNDLE_DRIFT','PACKAGE_HONESTY','PACKAGE_FILES','PACKAGE_DEPS',
  'DESCRIPTION_DRIFT','TOPICS','VERSION','PROOF_BINDING','PROOF_SCOPE','PROOF_EXPIRY',
  'DEFAULT_ROW','SAFETY_CANARY','SKILL_BUDGET','LOAD_BUDGET','RUNNER_SIZE',
  'INVOCATION_FIRST','CLAIM_RUNNERS','CONCEPT_MAP','NAME_PARAM','ABSENCE_HEADING',
  'INTERNAL_TERMS','SET_DRIFT','LICENSE_SOURCE','CREDITS','SCOPE_V1','NO_DRIVER',
  'NO_THIRD_PARTY_INSTALL','HOOK_LATENCY',
];
export const normalize = text => text.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}_-]+|--/gu)?.join(' ') || '';
const termCache = new Map();
export function termMatches(text, hashes) {
  if (!hashes.size) return [];
  const key=digest(text)+digest([...hashes].sort().join('\n'));
  if (termCache.has(key)) return [...termCache.get(key)];
  const tokens = normalize(text).split(' '), hits = new Set();
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].startsWith('aun-')) continue;
    for (let n = 1; n <= 24 && i+n <= tokens.length; n++) {
      const value = tokens.slice(i,i+n).join(' ');
      if (hashes.has(digest(value))) hits.add(digest(value));
    }
  }
  if (termCache.size>=512) termCache.delete(termCache.keys().next().value);
  termCache.set(key,[...hits]);
  return [...hits];
}
export function contentIssues(name, text, hashes = new Set()) {
  const issues = [], add = code => issues.push(`${code}:${name}`);
  const privatePattern = new RegExp(['(?:/' + 'Users/|/' + 'home/)[^/\\s]+/', '[A-Z]:\\\\Users\\\\[^\\\\]+\\\\', '\\b' + ['A','UN'].join('') + '-\\d+', 'linear\\.app/'].join('|'), 'i');
  const homePath = new RegExp('(?:~|\\$HOME|%USERPROFILE%)[/\\\\](?:Claude Code|Vau' + 'lts)(?:[/\\\\]|$)', 'i');
  const email = /[A-Z0-9._%+-]+@(?:gmail|outlook|hotmail|icloud|yahoo)\.[A-Z]{2,}/i;
  const privateText = privatePattern.test(text) || homePath.test(text) || email.test(text);
  if (privateText || /(?:Bearer\s+[A-Za-z0-9_.-]{16,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:sk|ghp)_[A-Za-z0-9]{16,})/.test(text)) add('PRIVACY');
  if (privatePattern.test(name) || homePath.test(name) || termMatches(name,hashes).length) add('PRIVACY_NAME');
  if (text.includes(String.fromCharCode(0x2014)) || text.toLowerCase().includes(['bottle','neck'].join(''))) add('VOICE');
  if (termMatches(name+'\n'+text, hashes).length) { add('INTERNAL_TERMS'); add('PRIVACY'); }
  if (name.endsWith('.md') && /^#{1,6}\s+(?:Without\b|No\s|Not\s|Limits\b|Limitations\b|What it is not\b|Not supported\b|Missing\b|Unsupported\b)/im.test(text)) add('ABSENCE_HEADING');
  if (name.startsWith('src/') && /(?:Input\.dispatch|Runtime\.evaluate|Page\.navigate)/.test(text)) add('NO_DRIVER');
  if ((name.startsWith('src/install/') || name.startsWith('bench/')) && /(?:exec|spawn|run)\w*\s*\([^\n]*(?:npm['"]?\s*,?\s*['"]?install|\bnpx\b|\bpip(?:3)?\b|\bbrew\b)/i.test(text)) add('NO_THIRD_PARTY_INSTALL');
  if (name !== 'docs/ROADMAP.md' && name !== 'src/build/validate.mjs' && /(?:browser-grant\.json|granted-browser|cua-driver|AXUIElement|(?:desktop|native-app)[_-](?:click|snapshot)|(?:readFile|readdir|open)[^\n]*Local State)/i.test(text)) add('SCOPE_V1');
  return issues;
}
export function proofIssues(rows, now = Date.now()) {
  const issues = [], warnings = [];
  for (const row of rows) {
    const shape=validateRow(row);
    if (shape.length) issues.push(`PROOF_BINDING:${row.id}:invalid ${shape.join(',')}`);
    if (!['package','default'].includes(row.subject)) issues.push(`PROOF_SCOPE:${row.id}:invalid subject`);
    if (!row.id || !row.command || !row.raw?.path || !/^[a-f0-9]{64}$/.test(row.raw?.sha256 || '') || !Number.isFinite(Date.parse(row.measured_at)) || !Number.isFinite(Date.parse(row.expires_at))) issues.push(`PROOF_BINDING:${row.id}:incomplete row`);
    if (Date.parse(row.expires_at) < now) warnings.push(`PROOF_EXPIRY:${row.id}:expired, omit from generated blocks`);
    if (row.id?.startsWith('H4') && (row.wrong_kills > 0 || row.arms?.some?.(a => a.wrong_kills > 0))) issues.push(`SAFETY_CANARY:${row.id}:wrong kill`);
  }
  return { issues, warnings };
}
export function check(root, options = {}) {
  const issues = [], warnings = [], names = files(root);
  const selected = new Set(options.only || []);
  const wanted = code => !selected.size || selected.has(code);
  const add = (code, detail) => issues.push(`${code}:${detail}`);
  const protect = (code, fn) => { try { fn(); } catch (e) { add(code,e.message); } };
  const hashText = read(root, 'check/terms.private.sha256').trim();
  if (!hashText || hashText.split('\n').some(h => !/^[a-f0-9]{64}$/.test(h))) add('INTERNAL_TERMS','invalid hash source');
  const hashes = new Set(hashText.split('\n'));
  const local = join(root,'check/forbidden.local.txt');
  if (existsSync(local)) protect('INTERNAL_TERMS',() => {
    const list = read(root,'check/forbidden.local.txt').split(/\r?\n/).map(normalize).filter(Boolean);
    if (list.some(t => /\baun-[a-z]/.test(t))) add('INTERNAL_TERMS','public name in private source');
    if (list.some(t => !hashes.has(digest(t)))) add('INTERNAL_TERMS','hash source needs rebuild');
  });
  for (const name of names) {
    const text = /\.(?:gif|png|jpg|ico|woff2?)$/i.test(name) ? '' : read(root,name);
    issues.push(...contentIssues(name,text,hashes));
    if (name.endsWith('.md') || name === 'llms.txt') issues.push(...linkIssues(root,name,text));
    if (/^\.github\/workflows\/.*\.ya?ml$/.test(name)) issues.push(...workflowIssues(name,text));
    if (options.release && text.includes(STUB)) add('FLOOR',`${name}:stub remains`);
  }
  const contentCodes = new Set(['PRIVACY','PRIVACY_NAME','VOICE','LINK','INTERNAL_TERMS','ABSENCE_HEADING','SCOPE_V1','NO_DRIVER','NO_THIRD_PARTY_INSTALL',...CODES.filter(c=>c.startsWith('WORKFLOW_') || c.startsWith('ACTION_'))]);
  if (selected.size && [...selected].every(c=>contentCodes.has(c))) return {issues:[...new Set(issues)].filter(s=>wanted(s.split(':')[0])),warnings};
  const { pkg, core, manifest } = config(root);
  protect('FLOOR',() => {
    for (const path of ['LICENSE','CLA.md','CONTRIBUTING.md','CODE_OF_CONDUCT.md','SECURITY.md','MAINTAINERS.md','RELEASING.md','REPO_SETTINGS.md','README.md','AGENTS.md','CREDITS.md','hooks/hooks.json','agents/aun-runner-browser.md',`${core}/SKILL.md`,'.claude-plugin/plugin.json','.claude-plugin/marketplace.json']) if (!read(root,path).trim()) add('FLOOR',path);
  });
  protect('MANIFEST',() => {
    if (manifest.schemaVersion !== 1 || manifest.skillName !== pkg.name.split('/').at(-1)) add('MANIFEST','identity');
    const assets = manifest.assets.map(a=>a.path);
    if (new Set(assets).size !== assets.length) add('MANIFEST','duplicate asset');
    for (const name of files(root,core).filter(n=>!n.endsWith('/manifest.json'))) if (!assets.includes(name.slice(core.length+1))) add('MANIFEST',`unlisted ${name}`);
    for (const asset of manifest.assets) {
      if (!asset.path || asset.path.startsWith('/') || asset.path.includes('..') || asset.path.includes('\\')) throw Error('invalid asset path');
      if (digest(read(root,`${core}/${asset.path}`)) !== asset.sha256) add('SOURCE_HASH',asset.path);
    }
    for (const route of manifest.stageRoutes) for (const name of route.assets) if (!manifest.assets.some(a=>a.path===name && a.active)) add('MANIFEST',`invalid route ${route.id}`);
  });
  protect('BUNDLE_DRIFT',() => {
    const stripProof=text=>text.replace(/<!-- proof:start[^>]*-->[\s\S]*?<!-- proof:end -->/g,'<!-- generated proof -->');
    for (const [path,body] of Object.entries(generated(root))) if (stripProof(read(root,path)) !== stripProof(body)) add('BUNDLE_DRIFT',path);
  });
  protect('PACKAGE_HONESTY',() => {
    if (pkg.type !== 'module' || pkg.engines?.node !== '>=22' || pkg.license !== 'MIT' || pkg.private) add('PACKAGE_HONESTY','metadata');
    if (Object.keys(pkg.dependencies || {}).length || Object.keys(pkg.devDependencies || {}).some(n=>n!=='typescript')) add('PACKAGE_DEPS','runtime or extra development dependencies');
    for (const script of ['preinstall','install','postinstall','prepare','prepublishOnly','prepack','postpack','publish','postpublish']) if (pkg.scripts?.[script]) add('PACKAGE_HONESTY',script);
    const entries = typeof pkg.bin === 'string' ? [pkg.bin] : Object.values(pkg.bin || {});
    if (entries.length !== 1) add('PACKAGE_HONESTY','one entry required');
    entries.forEach(p=>owned(root,p));
    const allow = pkg.files.map(p=>p.replace(/\/$/,''));
    for (const p of ['bin','src','skills','adapters','hooks','agents','bench','evals','docs','.claude-plugin','README.md','LICENSE']) if (!allow.includes(p)) add('PACKAGE_FILES',p);
    const exclusions=['!docs/*.gif','!bench/lifecycle/**','!bench/read/**','!bench/p0/workflow-jobs.json'];
    if (allow.some(p=>p.startsWith('!') && !exclusions.includes(p))) add('PACKAGE_FILES','unexpected exclusion');
    if (allow.includes('!docs/*.gif') && allow.indexOf('!docs/*.gif')<allow.indexOf('docs')) add('PACKAGE_FILES','exclusion precedes docs');
    const workflow = JSON.parse(read(root,'.github/workflows/check.yml'));
    if (!workflow.jobs.checks.strategy.matrix.node.some(n=>String(n)==='22') || !workflow.jobs.checks.steps.some(s=>s.with?.['node-version']==='${{ matrix.node }}')) add('PACKAGE_HONESTY','engine floor lacks check matrix');
    const plugin = JSON.parse(read(root,'.claude-plugin/plugin.json'));
    if (plugin.version !== pkg.version || manifest.packageVersion !== pkg.version) add('VERSION','metadata drift');
    if (plugin.name !== pkg.name || plugin.description !== pkg.description) add('DESCRIPTION_DRIFT','plugin');
    const settings = read(root,'REPO_SETTINGS.md');
    if (settings.split('## Description\n')[1]?.split('\n## ')[0].trim() !== pkg.description) add('DESCRIPTION_DRIFT','settings');
    const topics = settings.split('## Topics\n')[1]?.split('\n## ')[0].split('\n').filter(s=>s.startsWith('- ')).map(s=>s.slice(2));
    if (JSON.stringify(topics)!==JSON.stringify(pkg.keywords) || pkg.keywords.length>20 || pkg.keywords.some(t=>!/^[a-z0-9-]{1,49}$/.test(t))) add('TOPICS','metadata drift');
  });
  protect('SKILL_BUDGET',() => {
    let total = 0;
    for (const asset of manifest.assets.filter(a=>a.active)) {
      const text = read(root,`${core}/${asset.path}`), size = Buffer.byteLength(text); total += size;
      if (size>8192 || (asset.path==='SKILL.md' && (size>6144 || text.split('\n').length>121))) add('SKILL_BUDGET',asset.path);
      if (asset.path.startsWith('runners/') && (size>(asset.path.includes('brief') ? 2048 : 4096))) add('RUNNER_SIZE',asset.path);
    }
    if (total>81920) add('SKILL_BUDGET','active total');
    for (const route of manifest.stageRoutes) if (route.assets.reduce((sum,p)=>sum+Buffer.byteLength(read(root,`${core}/${p}`)),0)>20480) add('LOAD_BUDGET',route.id);
    if (Buffer.byteLength(read(root,'agents/aun-runner-browser.md'))>4096) add('RUNNER_SIZE','plugin runner');
    const skill = read(root,`${core}/SKILL.md`);
    if (!skill.startsWith(STUB) && (skill.match(/^## .+$/m)?.[0]!=='## When invoked' || /\bnpx\b|\bchoose a mode\b/i.test(skill))) add('INVOCATION_FIRST','skill');
    if (skill.startsWith(STUB)) warnings.push('INVOCATION_FIRST:prose stub awaits content');
  });
  protect('PROOF_BINDING',() => {
    const rows = JSON.parse(read(root,'proof/results.json')), result = proofIssues(rows);
    issues.push(...result.issues); warnings.push(...result.warnings);
    for (const row of rows) {
      if (existsSync(join(root,row.raw?.path || ''))) {
        if (digest(read(root,row.raw.path))!==row.raw.sha256) add('PROOF_BINDING',`${row.id}:raw hash`);
      } else add('PROOF_BINDING',`${row.id}:raw missing`);
    }
    for (const name of names.filter(n=>n==='README.md' || n==='llms.txt' || n.startsWith('docs/'))) {
      const text = read(root,name), blocks = [...text.matchAll(/<!-- proof:start[^>]*-->([\s\S]*?)<!-- proof:end -->/g)];
      for (const [,body] of blocks) for (const line of body.split('\n').filter(s=>/^\|\s*[EHCSR]\d/.test(s))) {
        const id = line.split('|')[1].trim(), row = rows.find(r=>r.id===id);
        if (!row || row.subject!=='package') add('PROOF_SCOPE',`${name}:${id}`);
        if (row?.subject==='package' && !validateRow(row).length) {
          const expected=proofBlock([row],{now:0}).split('\n').find(text=>text.startsWith(`| ${id} |`));
          if (line!==expected) add('PROOF_BINDING',`${name}:${id}:rendered values differ`);
        }
        if (row && Date.parse(row.expires_at)<Date.now()) warnings.push(`PROOF_EXPIRY:${name}:${id}:refresh the generated block`);
      }
      if (name!=='docs/DEFAULTS.md') {
        const outside = text.replace(/<!-- proof:start[^>]*-->[\s\S]*?<!-- proof:end -->/g,'');
        if (/\b\d+(?:\.\d+)?\s*(?:%|times faster\b|tokens saved\b|MB saved\b)/i.test(outside)) add('PROOF_BINDING',name);
      }
    }
    if (!rows.length) warnings.push('PROOF_EXPIRY:proof rows await browser CI');
  });
  protect('DEFAULT_ROW',() => {
    const path='src/hygiene/defaults.json';
    if (!existsSync(join(root,path))) { warnings.push('DEFAULT_ROW:defaults await hygiene implementation'); return; }
    const data=JSON.parse(read(root,path)), proof=JSON.parse(read(root,'proof/results.json'));
    for (const [key,row] of Object.entries(data)) if (row.value != null) {
      if (!row.source || !Number.isFinite(Date.parse(row.date || ''))) add('DEFAULT_ROW',key);
      const doc=read(root,'docs/DEFAULTS.md');
      const citation=typeof row.source==='string' ? row.source : row.source?.url || row.source?.row;
      if (row.source?.row) {
        const measured=proof.find(item=>item.id===row.source.row);
        if (!measured || measured.defaults?.[key] !== row.value || row.date !== measured.measured_at?.slice(0,10)) add('DEFAULT_ROW',`${key}:measurement binding`);
      }
      if (!citation || (!doc.startsWith(STUB) && (!doc.includes(key) || !doc.includes(citation)))) add('DEFAULT_ROW',`${key}:documentation binding`);
    }
  });
  protect('CLAIM_RUNNERS',() => {
    const plugin=JSON.parse(read(root,'.claude-plugin/plugin.json'));
    for (const runner of plugin.agents || []) if (!existsSync(join(root,runner))) add('CLAIM_RUNNERS',runner);
    const hooks=JSON.parse(read(root,'hooks/hooks.json'));
    if (!hooks.hooks || typeof hooks.hooks!=='object') add('CLAIM_RUNNERS','hook registry');
    for (const events of Object.values(hooks.hooks || {})) for (const entry of events) for (const hook of entry.hooks || []) {
      for (const m of (hook.command || '').matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([^\s"']+)/g)) if (!existsSync(join(root,m[1]))) add('CLAIM_RUNNERS',m[1]);
    }
    for (const name of names.filter(n=>n==='README.md' || n===`${core}/SKILL.md` || n.startsWith('adapters/'))) {
      const text=read(root,name); if (text.startsWith(STUB)) continue;
      for (const m of text.matchAll(/`((?:agents|src\/hooks)\/[^`]+)`/g)) if (!existsSync(join(root,m[1]))) add('CLAIM_RUNNERS',`${name}:${m[1]}`);
    }
  });
  protect('CONCEPT_MAP',() => {
    const provenance=read(root,'docs/PROVENANCE.md');
    if (provenance.startsWith(STUB)) { warnings.push('CONCEPT_MAP:prose stub awaits concept rows'); return; }
    const conceptSection=provenance.includes('## Concepts') ? provenance.split('## Concepts')[1].split(/^## /m)[0] : provenance;
    const rows=conceptSection.split('\n').filter(s=>s.startsWith('|') && !/^\|\s*(?:Concept|[-:])/.test(s));
    if (!rows.length) add('CONCEPT_MAP','concept rows required');
    for (const line of rows) {
      const cells=line.split('|').slice(1,-1).map(s=>s.trim());
      if (cells.length<4 || !cells[2] || !cells[3]) { add('CONCEPT_MAP','incomplete row'); continue; }
      if (!/aun-[a-z-]+|[\w.-]+\/[\w.-]+|https:\/\/|Agents SDK|Browser Run|Playwright MCP/.test(cells[1])) add('CONCEPT_MAP','public concept name');
      const paths=[...cells[2].matchAll(/`([^`]+)`/g)].map(m=>m[1]);
      if (!paths.length || paths.some(p=>!existsSync(join(root,p)) && !existsSync(join(root,core,p)))) add('CONCEPT_MAP','reference missing');
      if (!/`[^`]+`|\b(?:templates?|hooks?|runner rule|brief field|report template|profile classes)\b/i.test(cells[3])) add('CONCEPT_MAP','usable artifact missing');
    }
  });
  protect('NAME_PARAM',() => { for (const name of names.filter(n=>n.startsWith('src/') && n!=='src/config.mjs')) if (read(root,name).includes(pkg.name) || read(root,name).includes(core)) add('NAME_PARAM',name); });
  protect('SET_DRIFT',() => {
    const lock='.repo-build/set.lock.json';
    if (!existsSync(join(root,lock))) { add('SET_DRIFT','set lock missing'); return; }
    const data=JSON.parse(read(root,lock)), renderer='.repo-build/render-set.mjs';
    if (!existsSync(join(root,renderer))) {
      add('SET_DRIFT','locked renderer missing');
      return;
    }
    if (digest(read(root,renderer))!==data.renderer_sha256) { add('SET_DRIFT','renderer hash'); return; }
    if (digest(read(root,'.repo-build/set.json'))!==data.vendored_sha256) { add('SET_DRIFT','vendored set hash'); return; }
    const result=spawnSync(process.execPath,[renderer,'--check'],{cwd:root,encoding:'utf8',timeout:10000});
    if (result.status!==0) add('SET_DRIFT',result.error?.message || result.stderr || result.stdout || 'renderer check failed');
  });
  protect('LICENSE_SOURCE',() => {
    const path='docs/evidence/sources.json';
    if (!existsSync(join(root,path))) {
      if (!read(root,'docs/PROVENANCE.md').startsWith(STUB)) { add('LICENSE_SOURCE','source ledger required'); add('CREDITS','source ledger required'); }
      else warnings.push('LICENSE_SOURCE:source ledger awaits prose'); return;
    }
    const sources=JSON.parse(read(root,path));
    const provenance=read(root,'docs/PROVENANCE.md');
    const activeSources=provenance.split('\n').filter(line=>line.startsWith('|')).join('\n');
    if (!provenance.startsWith(STUB)) for (const match of activeSources.matchAll(/https:\/\/(?:github\.com\/[^\s/|)`]+\/[^\s/|)`]+|developers\.[^\s|)`]+)/g)) {
      if (!sources.some(source=>source.url===match[0])) add('CREDITS',`${match[0]}:source ledger entry required`);
    }
    for (const source of sources) {
      if (!(source.kind==='docs' ? ['MIT','Apache-2.0','BSD-2-Clause','BSD-3-Clause','CC-BY-4.0'] : ['MIT','Apache-2.0','BSD-2-Clause','BSD-3-Clause']).includes(source.license)) add('LICENSE_SOURCE',source.url);
      if (!read(root,'CREDITS.md').includes(source.url) || !read(root,'CREDITS.md').includes(source.license) || !read(root,'README.md').includes(source.url)) add('CREDITS',source.url);
    }
  });
  protect('CLAIM_EVIDENCE',() => {
    const p='docs/evidence/content-review.json';
    const candidates=names.filter(n=>(n==='README.md' || n.startsWith('docs/') || n.startsWith('adapters/')) && n.endsWith('.md') && !read(root,n).startsWith(STUB));
    if (!existsSync(join(root,p))) {
      if (candidates.length) for (const path of candidates) add('CLAIM_EVIDENCE',`${path}:review entry required`);
      else warnings.push('CLAIM_EVIDENCE:content review awaits prose');
      return;
    }
    const ledger=JSON.parse(read(root,p));
    for (const path of candidates) if (!ledger.files?.[path]) add('CLAIM_EVIDENCE',`${path}:review entry required`);
    for (const [path,entry] of Object.entries(ledger.files || {})) {
      if (digest(read(root,path))!==entry.sha256 || !['PASS','WAIVED','instructions-and-qualified-status-only'].includes(entry.disposition)) add('CLAIM_EVIDENCE',path);
      if (entry.disposition==='WAIVED' && !entry.reason) add('CLAIM_EVIDENCE',`${path}:waiver needs reason`);
      if (entry.disposition==='PASS') {
        if (!entry.claims?.length) add('CLAIM_EVIDENCE',`${path}:claims required`);
        for (const claim of entry.claims || []) {
          try {
            if (!claim.text || !read(root,path).includes(claim.text) || !claim.evidence?.startsWith('docs/evidence/')) throw Error('unbound claim');
            const receipt=JSON.parse(read(root,claim.evidence));
            if (!receipt.command || !receipt.environment || !receipt.date || receipt.exitCode!==0 || !receipt.artifactSha256 || !receipt.observed) throw Error('incomplete receipt');
          } catch { add('CLAIM_EVIDENCE',`${path}:receipt required`); }
        }
      }
    }
  });
  protect('HOOK_LATENCY',() => {
    const rows=JSON.parse(read(root,'proof/results.json')).filter(r=>r.id==='H5');
    for (const row of rows) if (row.hook_p95_ms > 150) add('HOOK_LATENCY','CI budget');
    if (!rows.length) warnings.push('HOOK_LATENCY:awaits H5 measurement in CI');
  });
  const readme=read(root,'README.md');
  if (fenced(readme).some(body=>body.split('\n').length>8)) add('FLOOR','front-page fence budget');
  return { issues:[...new Set(issues)].filter(s=>wanted(s.split(':')[0])), warnings:[...new Set(warnings)].filter(s=>wanted(s.split(':')[0])) };
}
