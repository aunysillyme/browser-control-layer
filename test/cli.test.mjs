import test from 'node:test';
import assert from 'node:assert/strict';
import { main, commandError } from '../src/cli.mjs';

test('CLI routes read and hygiene without invoking real adapters in contract tests', async()=>{
  const calls=[], output=[];
  const adapters={env:{},write:value=>output.push(value),readCommand:async args=>{calls.push(['read',args]);return 0;},hygieneCommand:async args=>{calls.push(['hygiene',args]);return {exitCode:3,output:'UNVERIFIED: fake probe'};}};
  assert.equal(await main(['read','https://example.com'],adapters),0);
  for (const command of ['doctor','cleanup','reap','top','lease']) assert.equal(await main([command],adapters),3);
  assert.deepEqual(calls[0],['read',['https://example.com']]);
  assert.equal(output.length,5);
  assert.ok(output.every(value=>value==='UNVERIFIED: fake probe'));
});

test('CLI preserves typed reader retryability in error output',()=>{
  const error=Object.assign(new Error('Page retrieval failed'),{code:'FETCH_FAILED',retryable:true,cause:{code:'ECONNRESET'}});
  assert.deepEqual(JSON.parse(commandError(error)),{code:'FETCH_FAILED',message:'Page retrieval failed',retryable:true,causeCode:'ECONNRESET'});
});

test('CLI metadata requires no process or network adapter',async()=>{
  const output=[];
  const adapters={env:{},write:value=>output.push(value),hygiene:{processAdapter:{inspect:()=>assert.fail('unexpected process probe')}},readCommand:()=>assert.fail('unexpected read'),hygieneCommand:()=>assert.fail('unexpected hygiene')};
  assert.equal(await main(['--help'],adapters),0);
  assert.equal(await main(['--version'],adapters),0);
  assert.match(output[0],/doctor \| cleanup/);
  assert.match(output[1],/^\d+\.\d+\.\d+$/);
  await assert.rejects(main(['--version','extra'],adapters),error=>error.code==='USAGE');
  await assert.rejects(main(['unknown'],adapters),error=>error.exitCode===2);
});

test('CLI sweeps before read and metadata with explicit context and delegates hygiene command policy',async()=>{
  const calls=[],env={AUN_SESSION_KEY:'fixture-session'};
  const adapters={env,write:()=>{},cliSweep:async options=>{assert.equal(options.env,env);calls.push('sweep');},readCommand:async()=>{calls.push('read');return 0;},hygieneCommand:async(args,options)=>{assert.equal(options.env,env);calls.push(args[0]);return {exitCode:0};}};
  await main(['read','https://example.com'],adapters);
  await main(['--help'],adapters);
  await main(['--version'],adapters);
  await main(['doctor'],adapters);
  await main(['top'],adapters);
  assert.deepEqual(calls,['sweep','read','sweep','sweep','doctor','top']);
});
