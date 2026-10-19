import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { config } from '../src/config.mjs';
import { check } from '../src/build/validate.mjs';
test('declared command and plugin assets exist', () => {
  const { pkg, core }=config();
  for (const p of [...Object.values(pkg.bin),`${core}/SKILL.md`,'agents/aun-runner-browser.md','hooks/hooks.json']) assert.ok(existsSync(p),p);
});
test('package source drives no pages', () => assert.equal(check(process.cwd()).issues.filter(s=>s.startsWith('NO_DRIVER:')).length,0));
