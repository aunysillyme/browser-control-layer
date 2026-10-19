import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { config } from '../src/config.mjs';
import { STUB, contentIssues } from '../src/build/validate.mjs';
test('description matches the approved copy and README is an explicit prose stub', () => {
  assert.equal(config().pkg.description,'Browser control skill pack for AI agents: route web jobs, batch steps, hand clicks to a fresh runner, and close and check what it opens.');
  assert.ok(readFileSync('README.md','utf8').startsWith(STUB));
});
test('absence headings refuse a negative heading and allow a comparison heading', () => {
  assert.ok(contentIssues('sample.md','# '+['Not','supported'].join(' ')).some(s=>s.startsWith('ABSENCE_HEADING:')));
  assert.deepEqual(contentIssues('sample.md','# With the skill vs without'),[]);
});
test.todo('Full lead copy and E2-conditioned claim replay lands with the prose step and later evaluation implementation');
