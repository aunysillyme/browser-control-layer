import { Resolver } from 'node:dns/promises';
import { isIP } from 'node:net';
import { ReadError } from './errors.mjs';

const blockedV4 = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
];
const v4Number = (value) => value.split('.').reduce((acc, octet) => acc * 256 + Number(octet), 0);
const inV4 = (value, base, bits) => Math.floor(value / 2 ** (32 - bits)) === Math.floor(v4Number(base) / 2 ** (32 - bits));

function v6Number(input) {
  let value = input.toLowerCase();
  if (value.includes('.')) {
    const tail = value.slice(value.lastIndexOf(':') + 1);
    const numeric = v4Number(tail);
    value = `${value.slice(0, value.lastIndexOf(':') + 1)}${Math.floor(numeric / 65536).toString(16)}:${(numeric % 65536).toString(16)}`;
  }
  const halves = value.split('::');
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length > 1 && halves[1] ? halves[1].split(':') : [];
  const parts = halves.length === 1 ? left : [...left, ...Array(8 - left.length - right.length).fill('0'), ...right];
  return parts.reduce((acc, part) => (acc << 16n) + BigInt(`0x${part}`), 0n);
}
const inV6 = (value, base, bits) => (value >> BigInt(128 - bits)) === (v6Number(base) >> BigInt(128 - bits));

export function isPublicAddress(address) {
  const family = isIP(address);
  if (family === 4) return !blockedV4.some(([base, bits]) => inV4(v4Number(address), base, bits));
  if (family !== 6) return false;
  const value = v6Number(address);
  // Only global unicast is admitted. Transition and documentation ranges stay closed.
  if (!inV6(value, '2000::', 3)) return false;
  return ![['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20]].some(([base, bits]) => inV6(value, base, bits));
}

export function parseURL(input, { previous } = {}) {
  if (typeof input !== 'string' || /[\u0000-\u0020\u007f]/u.test(input)) throw new ReadError('URL_INVALID', 'Supply a valid HTTP or HTTPS URL');
  let url;
  try { url = new URL(input); } catch { throw new ReadError('URL_INVALID', 'Supply an absolute HTTP or HTTPS URL'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new ReadError('URL_SCHEME', 'Use HTTP or HTTPS');
  if (url.username || url.password) throw new ReadError('URL_CREDENTIALS', 'URL credentials are refused');
  if (previous?.protocol === 'https:' && url.protocol !== 'https:') throw new ReadError('URL_DOWNGRADE', 'HTTPS redirects must retain HTTPS');
  url.hash = '';
  return url;
}

// A resolver belongs to one request and is cancelled when its security deadline ends.
export async function resolveHostname(hostname, { createResolver = () => new Resolver(), timeoutMs = 5000 } = {}) {
  const resolver = createResolver();
  let expired = false;
  const timer = setTimeout(() => { expired = true; resolver.cancel(); }, timeoutMs);
  try {
    const answers = await Promise.allSettled([resolver.resolve4(hostname), resolver.resolve6(hostname)]);
    if (expired) throw new ReadError('DNS_TIMEOUT', 'DNS resolution timed out', { retryable: true });
    const values = answers.flatMap((answer) => answer.status === 'fulfilled' ? answer.value : []);
    if (!values.length) throw new ReadError('DNS_FAILED', 'DNS resolution failed', { retryable: true });
    return values.map((address) => ({ address, family: isIP(address) }));
  } finally { clearTimeout(timer); resolver.cancel(); }
}

export async function pinURL(input, { resolver = resolveHostname, previous } = {}) {
  const url = parseURL(input, { previous });
  const hostname = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (!hostname || /(?:^|\.)(?:localhost|local|internal|home\.arpa)$/u.test(hostname)) throw new ReadError('URL_PRIVATE', 'Local hostnames are refused');
  let answers;
  if (isIP(hostname)) answers = [{ address: hostname, family: isIP(hostname) }];
  else {
    if (!hostname.includes('.')) throw new ReadError('URL_PRIVATE', 'Use a public hostname');
    try { answers = await resolver(hostname, { all: true, verbatim: true }); }
    catch (cause) { if (cause instanceof ReadError) throw cause; throw new ReadError('DNS_FAILED', 'DNS resolution failed', { retryable: true, cause }); }
  }
  if (!Array.isArray(answers) || !answers.length || answers.some((answer) => !isPublicAddress(answer?.address))) {
    throw new ReadError('URL_PRIVATE', 'Every resolved address must be public');
  }
  const first = answers[0];
  return Object.freeze({ url, hostname, address: first.address, family: isIP(first.address) });
}

export function pinnedLookup(pin) {
  return (hostname, options, callback) => {
    const done = typeof options === 'function' ? options : callback;
    const requested = hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
    if (requested !== pin.hostname) return done(new ReadError('DNS_PIN_MISMATCH', 'Transport hostname changed'));
    if (options?.all) return done(null, [{ address: pin.address, family: pin.family }]);
    return done(null, pin.address, pin.family);
  };
}
