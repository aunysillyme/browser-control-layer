import { cleanup } from './cleanup.mjs';
export async function reap(options) {
  if (!['idle', 'orphans', 'budget'].includes(options.mode)) throw new Error('REAP_MODE: choose idle, orphans or budget');
  return cleanup({ ...options, apply: options.apply !== false });
}
