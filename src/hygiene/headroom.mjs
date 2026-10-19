import { freemem, totalmem, loadavg, availableParallelism } from 'node:os';

export function headroom({ sample = () => ({ freeBytes: freemem(), totalBytes: totalmem(), load: loadavg()[0], cores: availableParallelism() }), minimumFreeBytes, maximumLoadPerCore } = {}) {
  const current = sample();
  const reasons = [];
  if (Number.isFinite(minimumFreeBytes) && current.freeBytes < minimumFreeBytes) reasons.push('free-memory');
  if (Number.isFinite(maximumLoadPerCore) && current.load / current.cores > maximumLoadPerCore) reasons.push('load');
  return { ...current, allowed: reasons.length === 0, reasons, policy: minimumFreeBytes == null && maximumLoadPerCore == null ? 'UNSET: awaiting resource measurements' : 'explicit', minimumFreeBytes: minimumFreeBytes ?? null, maximumLoadPerCore: maximumLoadPerCore ?? null };
}
