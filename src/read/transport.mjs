import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { ReadError, readError } from './errors.mjs';
import { pinnedLookup } from './url-policy.mjs';

// Security ceilings bound untrusted responses, independent of resource tuning.
export const TRANSPORT_LIMITS = Object.freeze({ bytes: 2 * 1024 * 1024, timeoutMs: 15000, redirects: 5 });
const accept = 'text/markdown, text/plain, text/html;q=0.8, application/json;q=0.5';

export function requestOptions(pin) {
  return {
    protocol: pin.url.protocol, hostname: pin.hostname, port: pin.url.port || undefined,
    path: `${pin.url.pathname}${pin.url.search}`, method: 'GET',
    headers: { accept, 'accept-encoding': 'identity' },
    lookup: pinnedLookup(pin), family: pin.family, autoSelectFamily: false,
    agent: false, servername: isIP(pin.hostname) ? undefined : pin.hostname,
  };
}

// Built-in fetch accepts a dispatcher. This small adapter supplies its socket
// through native HTTP so DNS stays pinned and TLS still verifies the hostname.
export function pinnedDispatcher(pin, { requesters = { 'http:': httpRequest, 'https:': httpsRequest } } = {}) {
  return {
    dispatch(options, handler) {
      let request;
      let ended = false;
      const fail = (error) => {
        if (ended) return;
        ended = true;
        handler.onError(error);
      };
      try {
        if (String(options.origin) !== pin.url.origin || options.path !== `${pin.url.pathname}${pin.url.search}` || options.method !== 'GET') {
          throw new ReadError('DNS_PIN_MISMATCH', 'Fetch target changed after validation');
        }
        request = requesters[pin.url.protocol](requestOptions(pin), (response) => {
          response.on('error', fail);
          response.on('aborted', () => fail(new ReadError('FETCH_TRUNCATED', 'Response ended before completion', { retryable: true })));
          const raw = response.rawHeaders || Object.entries(response.headers).flatMap(([key, value]) => [key, String(value)]);
          const headers = raw.map((value) => Buffer.from(value));
          const locationCount = raw.filter((value, index) => index % 2 === 0 && value.toLowerCase() === 'location').length;
          if (locationCount > 1) {
            fail(new ReadError('FETCH_REDIRECT_INVALID', 'Redirect must contain one location'));
            response.destroy(); return;
          }
          const resume = () => response.resume();
          if (handler.onHeaders(response.statusCode, headers, resume, response.statusMessage || '') === false) response.pause();
          response.on('data', (chunk) => { if (!ended && handler.onData(chunk) === false) response.pause(); });
          response.on('end', () => { if (!ended) { ended = true; handler.onComplete([]); } });
        });
        request.on('error', fail);
        handler.onConnect((reason) => {
          fail(reason || new ReadError('FETCH_ABORTED', 'Page retrieval was cancelled', { retryable: true }));
          request.destroy();
        });
        if (!ended) request.end();
      } catch (error) { fail(error); request?.destroy(); }
      return true;
    },
  };
}

export async function pinnedRequest(pin, { maxBytes = TRANSPORT_LIMITS.bytes, timeoutMs = TRANSPORT_LIMITS.timeoutMs, requesters, fetchRequest = globalThis.fetch } = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new ReadError('USAGE', 'Transport ceilings must be positive integers');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new ReadError('FETCH_TIMEOUT', 'Page retrieval timed out', { retryable: true })), timeoutMs);
  let reader;
  try {
    const response = await fetchRequest(pin.url, {
      method: 'GET', redirect: 'manual', headers: { accept, 'accept-encoding': 'identity' },
      signal: controller.signal, dispatcher: pinnedDispatcher(pin, { requesters }),
    });
    const headers = Object.fromEntries(response.headers);
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      return { status: response.status, headers, body: '' };
    }
    if (headers['content-encoding'] && headers['content-encoding'].toLowerCase() !== 'identity') {
      await response.body?.cancel();
      throw new ReadError('FETCH_ENCODING', 'Use an uncompressed text response');
    }
    reader = response.body?.getReader();
    const chunks = [];
    let bytes = 0;
    if (reader) for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) throw new ReadError('FETCH_TOO_LARGE', 'Response exceeds the byte ceiling');
      chunks.push(Buffer.from(value));
    }
    return { status: response.status, headers, body: Buffer.concat(chunks).toString('utf8') };
  } catch (error) {
    const typed = controller.signal.aborted ? controller.signal.reason : readError(error);
    controller.abort(typed);
    throw typed;
  } finally {
    clearTimeout(timer);
    await reader?.cancel().catch(() => {});
    reader?.releaseLock();
  }
}
