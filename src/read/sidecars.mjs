import { ReadError } from './errors.mjs';

export const SIDECARS = Object.freeze(['/llms.txt', '/docs/llms.txt', '/.well-known/ai-instructions.json']);
const optionalErrors = new Set(['FETCH_HTTP', 'FETCH_FAILED', 'FETCH_TIMEOUT', 'DNS_FAILED', 'DNS_TIMEOUT', 'FETCH_CONTENT_TYPE', 'FETCH_ENCODING', 'FETCH_TOO_LARGE']);

export async function fetchSidecars(url, fetch) {
  const results = await Promise.allSettled(SIDECARS.map(async (path) => {
    try {
      const response = await fetch(new URL(path, url).href);
      return { path, url: response.url, content: response.body };
    } catch (error) {
      if (!(error instanceof ReadError) || !optionalErrors.has(error.code)) throw error;
      return { path, error: { code: error.code, retryable: error.retryable } };
    }
  }));
  const failure = results.find((result) => result.status === 'rejected');
  if (failure) throw failure.reason;
  return results.map((result) => result.value);
}
