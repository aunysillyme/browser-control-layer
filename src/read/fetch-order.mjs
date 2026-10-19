import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { delimiter, join } from 'node:path';
import { pinURL } from './url-policy.mjs';
import { pinnedRequest, TRANSPORT_LIMITS } from './transport.mjs';
import { ReadError, readError } from './errors.mjs';
import { fetchSidecars } from './sidecars.mjs';
export { SIDECARS } from './sidecars.mjs';

const redirects = new Set([301, 302, 303, 307, 308]);

export async function fetchURL(input, { resolver, transport = pinnedRequest, maxRedirects = TRANSPORT_LIMITS.redirects, ...transportOptions } = {}) {
  let next = input;
  let previous;
  for (let count = 0; count <= maxRedirects; count++) {
    const pin = await pinURL(next, { resolver, previous });
    let response;
    try { response = await transport(pin, transportOptions); } catch (error) { throw readError(error); }
    if (redirects.has(response.status)) {
      if (count === maxRedirects) throw new ReadError('FETCH_REDIRECT_LIMIT', 'Redirect count exceeds the security ceiling');
      const location = response.headers.location;
      if (!location || Array.isArray(location)) throw new ReadError('FETCH_REDIRECT_INVALID', 'Redirect must contain one location');
      previous = pin.url;
      try { next = new URL(location, pin.url).href; } catch { throw new ReadError('FETCH_REDIRECT_INVALID', 'Redirect location is invalid'); }
      continue;
    }
    if (response.status < 200 || response.status > 299) throw new ReadError('FETCH_HTTP', `Server returned HTTP ${response.status}`, { retryable: response.status === 429 || response.status >= 500 });
    const encoding = response.headers['content-encoding'];
    if (encoding && encoding !== 'identity') throw new ReadError('FETCH_ENCODING', 'Use an uncompressed text response');
    const type = (response.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (type && !type.startsWith('text/') && !['application/json', 'application/ld+json', 'application/xml', 'application/xhtml+xml'].includes(type)) throw new ReadError('FETCH_CONTENT_TYPE', 'Response must contain text');
    return { ...response, url: pin.url.href };
  }
  throw new ReadError('FETCH_REDIRECT_LIMIT', 'Redirect count exceeds the security ceiling');
}

export async function findCrawler({ path = process.env.PATH || '', executable = process.platform === 'win32' ? 'crwl.exe' : 'crwl', accessFile = access } = {}) {
  for (const directory of path.split(delimiter).filter(Boolean)) {
    const candidate = join(directory, executable);
    try { await accessFile(candidate, constants.X_OK); return candidate; } catch {}
  }
  return null;
}

export async function fetchPage(input, options = {}) {
  const firstPin = await pinURL(input, { resolver: options.resolver });
  const sidecars = await fetchSidecars(firstPin.url, (url) => fetchURL(url, options));
  const markdown = new URL(firstPin.url);
  if (!/\.(?:md|markdown)$/iu.test(markdown.pathname)) markdown.pathname += '.md';
  const candidates = [...new Set([markdown.href, firstPin.url.href])];
  const attempts = [];
  let lastError;
  for (const url of candidates) {
    try {
      const response = await fetchURL(url, options);
      return { ...response, sidecars, attempts, route: 'pinned-http' };
    } catch (error) {
      if (error.code !== 'FETCH_HTTP' || error.retryable) throw error;
      attempts.push({ code: error.code, retryable: error.retryable }); lastError = error;
    }
  }
  throw lastError;
}
