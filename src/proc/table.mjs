import { linuxAdapter } from './platform/linux.mjs';
import { darwinAdapter } from './platform/darwin.mjs';
import { win32Adapter } from './platform/win32.mjs';

export function processAdapter(options = {}) {
  const platform = options.platform || process.platform;
  if (platform === 'linux') return linuxAdapter(options);
  if (platform === 'darwin') return darwinAdapter(options);
  return win32Adapter(options);
}

export async function processTable(adapter) {
  try { return { verified: true, rows: await adapter.list() }; }
  catch (error) { return { verified: false, rows: [], reason: error.code || error.message }; }
}
