import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { pinnedRequest } from '../../src/read/transport.mjs';
import { fetchURL } from '../../src/read/fetch-order.mjs';

// The shared fixture server and full S1 matrix are owned by the next build step.
// This CI-only integration verifies the actual pinned transport independently.
test('CI actual transport uses a pinned socket and public policy refuses private redirects', async () => {
  assert.equal(process.env.CI, 'true', 'Run this network suite in CI');
  const server = createServer((req, res) => {
    if (req.url === '/redirect') { res.writeHead(302, { location: 'http://169.254.169.254/' }); res.end(); return; }
    res.writeHead(200, { 'content-type': 'text/plain' }); res.end('fixture page');
  });
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const address = server.address();
    let resolutions = 0;
    const resolver = async () => { resolutions++; return [{ address: '127.0.0.1', family: 4 }]; };
    const base = `http://fixture.example:${address.port}`;
    const pin = { url: new URL(`${base}/`), hostname: 'fixture.example', address: '127.0.0.1', family: 4 };
    const result = await pinnedRequest(pin);
    assert.equal(result.body, 'fixture page');
    await assert.rejects(fetchURL(`${base}/`, { resolver }), (error) => error.code === 'URL_PRIVATE');
    assert.equal(resolutions, 1);
    const redirect = await pinnedRequest({ ...pin, url: new URL(`${base}/redirect`) });
    await assert.rejects(fetchURL('http://public.example/', { resolver: async () => [{ address: '93.184.216.34', family: 4 }], transport: async () => redirect }), (error) => error.code === 'URL_PRIVATE');
  } finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
});
