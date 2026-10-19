import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stageRoutes} from '../src/build/manifest.mjs';
import {config} from '../src/config.mjs';
test('stage routes derive from the invocation table and reject a missing table',()=>{
  const {core,manifest}=config();
  assert.deepEqual(stageRoutes(readFileSync(`${core}/SKILL.md`,'utf8')),manifest.stageRoutes);
  assert.throws(()=>stageRoutes('## When invoked\nRead.'),/Stage table/);
});
