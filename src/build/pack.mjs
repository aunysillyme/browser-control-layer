import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config.mjs';
import { read, digest } from './bundle.mjs';
import { catalog, renderRunner } from '../install/catalog.mjs';

const cell=value=>String(value).replaceAll('|','&#124;').replace(/[\r\n]/g,' ').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('`','&#96;');
export function proofBlock(rows,{now=Date.now(),root,warn=()=>{}}={}) {
  const eligible=[];
  for(const row of rows) {
    if(row.subject!=='package') continue;
    if(!Number.isFinite(Date.parse(row.expires_at)) || !Number.isFinite(Date.parse(row.measured_at))) throw Error(`PROOF_BINDING:${row.id}:invalid dates`);
    if(Date.parse(row.expires_at)<now) { warn(`PROOF_EXPIRY:${row.id}:expired`); continue; }
    if(!row.id || typeof row.claim!=='string' || !row.command || !row.raw?.path || !/^[a-f0-9]{64}$/.test(row.raw.sha256) || !Number.isFinite(row.median)) throw Error(`PROOF_BINDING:${row.id}:incomplete row`);
    if(root && digest(read(root,row.raw.path))!==row.raw.sha256) throw Error(`PROOF_BINDING:${row.id}:raw hash mismatch`);
    if(row.id.startsWith('E2') && row.claim_eligible!==true) continue;
    eligible.push(row);
  }
  const body=eligible.slice(0,3).map(row=>`| ${cell(row.id)} | ${cell(row.claim)} | ${cell(row.median)} ${cell(row.unit)} | ${cell(row.measured_at)} | \`${cell(row.command)}\` |`).join('\n');
  const rerun=root ? `npx ${config(root).name} bench hygiene` : 'bench hygiene';
  return `<!-- proof:start (generated; package rows only) -->\n${body?'| Row | Measurement | Median | Date | Rerun |\n|---|---|---|---|---|\n'+body+'\n':`Measurements await a completed benchmark. Rerun: \`${rerun}\`.\n`}<!-- proof:end -->`;
}
export function replaceBlock(text,name,body) {
  const pattern=new RegExp(`<!-- ${name}:start[^>]*-->[\\s\\S]*?<!-- ${name}:end -->`,'g');
  const matches=text.match(pattern) || [];
  if(matches.length>1) throw Error(`Duplicate ${name} block`);
  return matches.length?text.replace(pattern,()=>body):`${text.trimEnd()}\n\n${body}\n`;
}
export function generatedPack(root,options={}) {
  const cfg=config(root), rows=JSON.parse(read(root,'proof/results.json'));
  const proof=proofBlock(rows,{...options,root});
  const template=read(root,`${cfg.core}/runners/aun-runner-browser.template.md`);
  const output={'agents/aun-runner-browser.md':renderRunner(template,catalog(cfg)[0],`npx ${cfg.name}`)};
  output['README.md']=replaceBlock(read(root,'README.md'),'proof',proof);
  output['docs/RESULTS.md']=replaceBlock(read(root,'docs/RESULTS.md'),'proof',proof);
  const prior=existsSync(join(root,'llms.txt'))?read(root,'llms.txt'):'';
  const set=prior.match(/<!-- set:start -->[\s\S]*?<!-- set:end -->/)?.[0];
  const repository=(typeof cfg.pkg.repository==='string'?cfg.pkg.repository:cfg.pkg.repository.url).replace(/^git\+/,'').replace(/\.git$/,'');
  const link=path=>`${repository}/blob/HEAD/${path}`;
  output['llms.txt']=`# ${cfg.name}\n\n> ${cfg.pkg.description}\n\nInstall: \`npx ${cfg.name}\`. Preview: \`npx ${cfg.name} install --dry-run\`.\n\n## Docs\n\n- [Skill](${link(`${cfg.core}/SKILL.md`)}): Read the invocation steps.\n- [Method](${link('docs/METHOD.md')}): Browser practices and rationale.\n- [Results](${link('docs/RESULTS.md')}): Package measurements and rerun commands.\n\n## Reference\n\n- [Commands](${link('README.md')}): Command entry points and companion credits.\n- [Claude Code](${link('adapters/claude-code.md')}): Plugin and project installation.\n- [Codex](${link('adapters/codex.md')}): Shared agent skill path.\n\n## Optional\n\n- [Remote browser](${link(`${cfg.core}/playbooks/remote-browser.md`)}): Browser Run recipes.\n- [Zero install](${link('adapters/zero-install.md')}): Paste the method into a chat.\n\n${proof}\n${set?'\n'+set+'\n':''}`;
  const installer=`<!-- installer:start (generated) -->
## Project installation

Run \`npx ${cfg.name}\` in the project. The preview lists every target and its hash, the receipt, and optional companion commands. Enter \`edit <host>\` to choose another host, then confirm once. \`install --host <host> --dry-run\` produces the same plan and performs no writes. Companions are printed for the user to install separately.

${catalog(cfg).filter(host=>host.skill).map(host=>`- **${host.name}:** skill at \`${host.skill}\`; runner at \`${host.runner}\`${host.context?`; context at \`${host.context}\``:''}.`).join('\n')}

Claude Code project hooks merge into \`.claude/settings.json\`. A local runtime snapshot keeps those commands usable after the package cache changes. Other hosts use the cleanup commands until a native hook trial proves their integration. Activation remains UNVERIFIED until a real host session confirms it.

The receipt lives at \`.${cfg.skillName}/install.json\`. Each written file has a hash; edited integration files have backups under \`.${cfg.skillName}/backups/\`. Existing identical files remain user-owned. Conflicts and linked targets are refused before writes. An existing receipt requires uninstall before replacement.

Run \`npx ${cfg.name} uninstall --dry-run\` to preview removal, then \`uninstall\` to apply it. Only unchanged written files are removed; unchanged integrations restore their original bytes. Edited files and the backups they need remain with a receipt. An absent receipt returns code 2 and changes nothing. An interrupted install retains its receipt for recovery.

Source of truth: \`src/install/catalog.mjs\` and \`src/install/index.mjs\`. The command reads shipped skill assets and writes only in the selected project. It starts no services. \`consumer.yml\` tests one packed tarball on each supported operating system; \`release.yml\` publishes only after those consumers pass. Local verification: \`node --test test/install.test.mjs test/generate.test.mjs\`. Native host loading is verified separately by a host-trial receipt.
<!-- installer:end -->`;
  output['docs/INSTALLER.md']=replaceBlock(read(root,'docs/INSTALLER.md'),'installer',installer);
  return output;
}
