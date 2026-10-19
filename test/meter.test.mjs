import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, mkdtemp, rm, writeFile, symlink } from 'node:fs/promises';
import { resolve,join } from 'node:path';
import { parseTranscript } from '../src/meter/claude-code.mjs';
import { aggregate,meterCommand,meterFiles } from '../src/meter/report.mjs';
const fixture=await readFile(new URL('./fixtures/meter/known.jsonl',import.meta.url),'utf8');
async function scratch(t){await mkdir('.test-work',{recursive:true});const dir=await mkdtemp(resolve('.test-work/meter-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir;}
test('meter exact cached reread aggregates deduplicate streaming fragments and retain no content',()=>{
 const steps=parseTranscript(fixture);assert.deepEqual(steps.map(s=>[s.input_tokens,s.output_tokens,s.reread_tokens,s.reread_share]),[[100,10,0,0],[200,20,150,0.75]]);
 const report=aggregate(steps);assert.equal(report.input_tokens,300);assert.equal(report.reread_share,0.5);assert.equal(report.output_tokens,30);assert.equal(report.subject,undefined);assert.ok(!JSON.stringify(report).includes('Synthetic output'));assert.match(report.interpretation,/lower bound/);
});
test('meter refuses unknown or corrupt usage with clear code, accepts known metadata',()=>{
 for(const source of ['{}','bad','{"type":"future"}', '{"type":"assistant","message":{"id":"x","usage":{"input_tokens":2}}}',fixture.replace('"input_tokens":30','"input_tokens":-1')]) assert.throws(()=>parseTranscript(source),e=>e.code==='UNKNOWN_TRANSCRIPT'&&e.exitCode===4);
 assert.equal(parseTranscript('{"type":"progress"}\n'+fixture).length,2);
});
test('meter local path accepts transcript and refuses paths outside projects or symlinks',async t=>{
 const dir=await scratch(t);const projects=join(dir,'projects');await mkdir(projects);await writeFile(join(projects,'known.jsonl'),fixture);const output=[];
 assert.equal(await meterCommand(['--path',join(projects,'known.jsonl')],{projectsRoot:projects,write:x=>output.push(x)}),0);assert.equal(JSON.parse(output[0]).files,1);
 await assert.rejects(meterFiles(dir,projects),e=>e.code==='METER_PATH');
 await symlink(join(projects,'known.jsonl'),join(projects,'linked.jsonl'));await assert.rejects(meterFiles(join(projects,'linked.jsonl'),projects),e=>e.code==='METER_PATH');
});
