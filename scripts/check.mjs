import { readFileSync } from 'node:fs';
import { CODES, check, contentIssues } from '../src/build/validate.mjs';

try {
  const args = process.argv.slice(2), selected = new Set();
  for (let i=0;i<args.length;i++) {
    if (args[i]==='--only') {
      if (!args[i+1]) throw Error('--only needs comma-separated codes');
      for (const code of args[++i].split(',')) { if (!CODES.includes(code)) throw Error(`Unknown gate: ${code}`); selected.add(code); }
    } else if (!['--stdin','--release'].includes(args[i])) throw Error(`Unknown flag: ${args[i]}`);
  }
  let result;
  if (args.includes('--stdin')) {
    if ([...selected].some(c=>!['PRIVACY','PRIVACY_NAME','INTERNAL_TERMS','VOICE'].includes(c))) throw Error('--stdin supports content gates');
    const hashes=new Set(readFileSync('check/terms.private.sha256','utf8').trim().split('\n'));
    result={issues:contentIssues('<stdin>',readFileSync(0,'utf8'),hashes),warnings:[]};
  } else result=check(process.cwd(),{release:args.includes('--release'),only:[...selected]});
  const wanted=s=>!selected.size || selected.has(s.split(':')[0]);
  const issues=result.issues.filter(wanted);
  for (const warning of result.warnings.filter(wanted)) console.error(`WARN ${warning}`);
  for (const issue of issues) console.error(`FAIL ${issue}`);
  if (issues.length) process.exitCode=1;
  else console.log(`PASS ${selected.size ? [...selected].join(',') : 'repository gates'}`);
} catch (error) { console.error(`FAIL CHECK_INPUT:${error.message}`); process.exitCode=2; }
