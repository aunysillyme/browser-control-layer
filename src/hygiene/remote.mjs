const credentials = env => env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_API_TOKEN;
const endpointFor = env => `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)}/browser-rendering/sessions`;

async function request({ env, fetch, endpoint, timeoutMs = 10000 }, method, id) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
  const response = await fetch(`${endpoint || endpointFor(env)}${id ? `/${encodeURIComponent(id)}` : ''}`, { method, headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` }, redirect: 'error', signal: controller.signal });
  if (!response.ok) throw Object.assign(new Error('REMOTE_API: session request failed'), { code: 'REMOTE_API', status: response.status });
  return response.status === 204 ? {} : await response.json();
  } finally { clearTimeout(timeout); }
}

export async function remoteDoctor({ ledger, env = process.env, fetch = globalThis.fetch, endpoint, timeoutMs } = {}) {
  if (!credentials(env)) return { verified: false, status: 'UNVERIFIED', reason: 'remote credentials unavailable', sessions: [] };
  const recorded = new Set((await ledger.list()).flatMap(row => row.remoteSessionIds || []));
  try {
    const body = await request({ env, fetch, endpoint, timeoutMs }, 'GET');
    if (body.success === false || !Array.isArray(body.result) || body.result_info?.total_count > body.result.length) return { verified: false, status: 'UNVERIFIED', reason: 'remote response shape', sessions: [] };
    return { verified: true, sessions: body.result.map(row => ({ id: row.id || row.sessionId, owned: recorded.has(row.id || row.sessionId), status: row.status })), endpointVerification: 'CI_MOCKED: live endpoint pending' };
  } catch (error) { return { verified: false, status: 'UNVERIFIED', reason: error.code || 'REMOTE_API', sessions: [] }; }
}

export async function closeRemote(record, options = {}) {
  const { ledger, env = process.env, fetch = globalThis.fetch, endpoint, timeoutMs } = options;
  if (!credentials(env)) return { verified: false, closed: [], remaining: record.remoteSessionIds || [], reason: 'UNVERIFIED: remote credentials unavailable' };
  const closed = [];
  for (const id of record.remoteSessionIds || []) {
    const fresh = await ledger.read(record.id);
    if (fresh?.kind !== 'remote' || fresh.sessionKey !== record.sessionKey || !fresh.remoteSessionIds?.includes(id)) continue;
    try { await request({ env, fetch, endpoint, timeoutMs }, 'DELETE', id); closed.push(id); }
    catch { /* A failed close remains visible in the ledger. */ }
  }
  const state = await remoteDoctor({ ledger, env, fetch, endpoint, timeoutMs });
  const remaining = state.verified ? (record.remoteSessionIds || []).filter(id => state.sessions.some(row => row.id === id)) : (record.remoteSessionIds || []);
  return { verified: state.verified, closed: closed.filter(id => !remaining.includes(id)), remaining };
}
