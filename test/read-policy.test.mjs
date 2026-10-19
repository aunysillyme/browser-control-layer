import test from 'node:test';
import assert from 'node:assert/strict';
import { isPublicAddress, parseURL, pinURL, pinnedLookup, resolveHostname } from '../src/read/url-policy.mjs';
import { fetchURL } from '../src/read/fetch-order.mjs';
import { requestOptions } from '../src/read/transport.mjs';

const resolver = async () => [{ address: '93.184.216.34', family: 4 }];
const text = { status: 200, headers: { 'content-type': 'text/plain' }, body: 'page' };
const refused = (code) => (error) => error.code === code && error.retryable === false;
const privateAddresses = [
  '127.0.0.1', '100.64.0.1', '169.254.169.254', '10.0.0.1', '172.16.0.1', '192.168.1.1',
  '0.0.0.0', '224.0.0.1', '192.0.2.1', '::1', '::', '::ffff:127.0.0.1', '::ffff:7f00:1',
  'fe80::1', 'fc00::1', 'ff02::1', '2001:db8::1', '2002:7f00:1::',
];

for (const address of privateAddresses) test(`RED policy refuses reserved address ${address}`, async () => {
  assert.equal(isPublicAddress(address), false);
  await assert.rejects(pinURL('https://public.example/', { resolver: async () => [{ address }] }), refused('URL_PRIVATE'));
});

for (const address of ['93.184.216.34', '8.8.8.8', '2606:4700:4700::1111', '2001:4860:4860::8888']) test(`GREEN policy allows global address ${address}`, async () => {
  assert.equal(isPublicAddress(address), true);
  const pin = await pinURL('https://public.example/', { resolver: async () => [{ address }] });
  assert.equal(pin.address, address);
});

for (const url of ['http://0x7f.1/', 'http://2130706433/', 'http://0177.0.0.1/', 'http://[::ffff:127.0.0.1]/', 'http://localhost/', 'http://host.local/', 'http://metadata.google.internal/']) test(`RED policy refuses normalized local target ${url}`, async () => {
  await assert.rejects(pinURL(url, { resolver }), refused('URL_PRIVATE'));
});

test('RED URL scheme credentials whitespace and downgrade; GREEN HTTP and HTTPS', () => {
  assert.throws(() => parseURL('file:///fixture/read'), refused('URL_SCHEME'));
  assert.throws(() => parseURL('https://name:pass@public.example/'), refused('URL_CREDENTIALS'));
  assert.throws(() => parseURL('https://public.example/\n'), refused('URL_INVALID'));
  assert.throws(() => parseURL('http://public.example/', { previous: new URL('https://public.example/') }), refused('URL_DOWNGRADE'));
  assert.equal(parseURL('http://public.example/').protocol, 'http:');
  assert.equal(parseURL('https://public.example/#part').hash, '');
});

test('RED mixed DNS answer sets fail; GREEN all global answers pin one address', async () => {
  await assert.rejects(pinURL('https://public.example/', { resolver: async () => [{ address: '93.184.216.34' }, { address: '127.0.0.1' }] }), refused('URL_PRIVATE'));
  assert.equal((await pinURL('https://public.example/', { resolver })).address, '93.184.216.34');
});

test('RED redirect to private and HTTPS downgrade; GREEN redirect to public', async () => {
  let calls = 0;
  const transport = async () => { calls++; return { status: 302, headers: { location: 'http://127.0.0.1/' } }; };
  await assert.rejects(fetchURL('http://public.example/', { resolver, transport }), refused('URL_PRIVATE'));
  assert.equal(calls, 1);
  await assert.rejects(fetchURL('https://public.example/', { resolver, transport: async () => ({ status: 301, headers: { location: 'http://public.example/' } }) }), refused('URL_DOWNGRADE'));
  const response = await fetchURL('https://public.example/', { resolver, transport: async (pin) => pin.url.pathname === '/' ? { status: 302, headers: { location: '/target' } } : text });
  assert.equal(response.url, 'https://public.example/target');
});

test('RED DNS rebinding cannot affect transport lookup; GREEN TLS retains hostname', async () => {
  let lookups = 0;
  const pin = await pinURL('https://public.example/', { resolver: async () => { lookups++; return [{ address: '93.184.216.34' }]; } });
  const lookup = pinnedLookup(pin);
  await new Promise((resolve, reject) => lookup('public.example', {}, (error, address, family) => {
    if (error) { reject(error); return; }
    assert.equal(address, '93.184.216.34'); assert.equal(family, 4); resolve();
  }));
  await new Promise((resolve) => lookup('other.example', {}, (error) => { assert.equal(error.code, 'DNS_PIN_MISMATCH'); resolve(); }));
  assert.equal(lookups, 1);
  const options = requestOptions(pin);
  assert.equal(options.servername, 'public.example');
  assert.equal(options.agent, false);
  assert.equal(options.autoSelectFamily, false);
  assert.equal(options.headers['accept-encoding'], 'identity');
});

test('RED DNS rebinding on redirect is refused before another request', async () => {
  let resolutions = 0;
  let requests = 0;
  await assert.rejects(fetchURL('https://public.example/', {
    resolver: async () => [{ address: ++resolutions === 1 ? '93.184.216.34' : '127.0.0.1' }],
    transport: async () => { requests++; return { status: 302, headers: { location: '/next' } }; },
  }), refused('URL_PRIVATE'));
  assert.equal(requests, 1);
});

test('RED malformed and cyclic redirects fail; GREEN text response succeeds', async () => {
  await assert.rejects(fetchURL('https://public.example/', { resolver, transport: async () => ({ status: 302, headers: {} }) }), refused('FETCH_REDIRECT_INVALID'));
  await assert.rejects(fetchURL('https://public.example/', { resolver, maxRedirects: 1, transport: async () => ({ status: 302, headers: { location: '/' } }) }), refused('FETCH_REDIRECT_LIMIT'));
  assert.equal((await fetchURL('https://public.example/', { resolver, transport: async () => text })).body, 'page');
});

test('RED network failure is typed and retryable; GREEN status policy separates permanent HTTP errors', async () => {
  await assert.rejects(pinURL('https://public.example/', { resolver: async () => { throw Error('unavailable'); } }), (error) => error.code === 'DNS_FAILED' && error.retryable);
  await assert.rejects(fetchURL('https://public.example/', { resolver, transport: async () => ({ status: 503, headers: {} }) }), (error) => error.code === 'FETCH_HTTP' && error.retryable);
  await assert.rejects(fetchURL('https://public.example/', { resolver, transport: async () => ({ status: 404, headers: {} }) }), refused('FETCH_HTTP'));
});

test('RED binary and compressed bodies refused; GREEN JSON accepted', async () => {
  for (const headers of [{ 'content-type': 'image/png' }, { 'content-encoding': 'gzip' }]) await assert.rejects(fetchURL('https://public.example/', { resolver, transport: async () => ({ ...text, headers }) }));
  assert.equal((await fetchURL('https://public.example/', { resolver, transport: async () => ({ ...text, headers: { 'content-type': 'application/json' } }) })).body, 'page');
});


test('RED DNS deadline cancels outstanding operations; GREEN resolver releases completed operations', async () => {
  let cancellations = 0;
  const rejections = [];
  await assert.rejects(resolveHostname('public.example', { timeoutMs: 5, createResolver: () => ({
    resolve4: () => new Promise((resolve, reject) => rejections.push(reject)),
    resolve6: () => new Promise((resolve, reject) => rejections.push(reject)),
    cancel: () => { cancellations++; for (const reject of rejections) reject(Error('cancelled')); },
  }) }), (error) => error.code === 'DNS_TIMEOUT' && error.retryable);
  assert.ok(cancellations > 0);
  let closed = false;
  const answers = await resolveHostname('public.example', { createResolver: () => ({
    resolve4: async () => ['93.184.216.34'], resolve6: async () => [], cancel: () => { closed = true; },
  }) });
  assert.equal(answers[0].address, '93.184.216.34'); assert.equal(closed, true);
});

test('RED special IPv6 ranges are refused; GREEN ordinary global unicast remains allowed', async () => {
  for (const address of ['2001:10::1', '2001:20::1', '3fff::1']) {
    assert.equal(isPublicAddress(address), false);
    await assert.rejects(pinURL(`https://[${address}]/`), refused('URL_PRIVATE'));
  }
  assert.equal(isPublicAddress('2001:4860::1'), true);
});

test('RED transport errors preserve a typed retryable result; GREEN successful transport returns its body', async () => {
  await assert.rejects(fetchURL('https://public.example/', { resolver, transport: async () => { throw Error('socket closed'); } }), (error) => error.code === 'FETCH_FAILED' && error.retryable);
  assert.equal((await fetchURL('https://public.example/', { resolver, transport: async () => text })).body, 'page');
});
