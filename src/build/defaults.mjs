import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config.mjs';

export function deriveDefaults(defaults, rows) {
  return Object.fromEntries(Object.entries(defaults).map(([key, setting]) => {
    if (!setting.needs) return [key, setting];
    const candidates = rows.filter(row => setting.needs.split(',').some(id => row.id === id || row.id.startsWith(id + '-')) && row.status !== 'failed' && Number.isFinite(row.defaults?.[key]) && row.defaults[key] >= 0 && row.raw?.sha256 && Number.isFinite(Date.parse(row.measured_at)));
    const row = candidates.sort((a,b) => Date.parse(b.measured_at) - Date.parse(a.measured_at))[0];
    return [key, row ? { ...setting, value: row.defaults[key], source: { row: row.id }, date: row.measured_at.slice(0,10) } : { ...setting, value: null, source: null, date: null }];
  }));
}
export function generateDefaults(root) {
  const { core } = config(root);
  const json = name => JSON.parse(readFileSync(join(root, name), 'utf8'));
  const results = json('proof/results.json');
  const defaults = deriveDefaults(json('src/hygiene/defaults.json'), Array.isArray(results) ? results : results.rows || []);
  const lines = Object.entries(defaults).map(([key,s]) => `| ${key} | ${s.value === null ? 'unset' : s.value} | ${s.source?.row ? `row: ${s.source.row} (${s.date})${key === 'waitCap' ? '; calibrated on the benchmark fixture as a conservative loop guard that resets on a non-empty read' : ''}` : s.source?.url ? `[Primary documentation](${s.source.url}) (${s.date})` : `Awaiting ${s.needs}`} |`);
  const body = '# Resource defaults\n\nGenerated from recorded benchmark rows and dated primary documentation. Unmeasured settings stay unset. Expired evidence warns and retains its dated binding.\n\n| Setting | Value | Evidence |\n|---|---|---|\n' + lines.join('\n') + '\n';
  return { 'src/hygiene/defaults.json': JSON.stringify(defaults,null,2)+'\n', 'docs/DEFAULTS.md': body, [`${core}/references/defaults.md`]: body };
}
