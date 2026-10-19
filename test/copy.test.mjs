import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { config } from '../src/config.mjs';
import { contentIssues } from '../src/build/validate.mjs';
test('description matches the approved copy', () => {
  assert.equal(config().pkg.description,'Browser control skill pack for AI agents: route web jobs, batch steps, hand clicks to a fresh runner, and close and check what it opens.');
});
test('absence headings refuse a negative heading and allow a comparison heading', () => {
  assert.ok(contentIssues('sample.md','# '+['Not','supported'].join(' ')).some(s=>s.startsWith('ABSENCE_HEADING:')));
  assert.deepEqual(contentIssues('sample.md','# With the skill vs without'),[]);
});
test('full lead copy teaches the host and avoids overclaims', () => {
  const text=readFileSync('README.md','utf8').replace(/<!-- proof:start[^>]*-->[\s\S]*?<!-- proof:end -->/g,'');
  for(const phrase of ['teaches your AI','your AI does the browser work','over the browser tools you already use']) assert.ok(text.toLowerCase().includes(phrase.toLowerCase()),phrase);
  assert.doesNotMatch(text,/controls your browser for you|automates for you|our browser|browser engine|replaces Playwright|fastest|guaranteed|every browser|every tab|every process|\d+(?:\.\d+)?\s*%/i);
});
