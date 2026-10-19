export class McpClient {
  constructor(child, timeoutMs = 30_000) {
    this.child = child;
    this.timeoutMs = timeoutMs;
    this.nextId = 0;
    this.pending = new Map();
    this.buffer = '';
    this.logs = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => this.consume(chunk));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => { this.logs += chunk; });
    child.stdin.on?.('error', error => this.fail(error));
    child.on('error', error => this.fail(error));
    child.on('exit', (code, signal) => this.fail(new Error(`P0_DRIVER_EXIT: code=${code} signal=${signal}\n${this.logs}`)));
  }
  consume(chunk) {
    this.buffer += chunk;
    let newline;
    while ((newline = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      let response;
      try { response = JSON.parse(line); } catch { this.logs += line + '\n'; continue; }
      const entry = this.pending.get(response.id);
      if (!entry) continue;
      this.pending.delete(response.id);
      clearTimeout(entry.timer);
      if (response.error) entry.reject(new Error(`P0_MCP: ${JSON.stringify(response.error)}\n${this.logs}`));
      else entry.resolve(response.result);
    }
  }
  fail(error) {
    this.failure = error;
    for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(error); }
    this.pending.clear();
  }
  request(method, params = {}) {
    if (this.failure) return Promise.reject(this.failure);
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`P0_MCP_TIMEOUT: ${method}\n${this.logs}`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n', error => {
        if (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
      });
    });
  }
  notify(method, params = {}) {
    this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  }
  async open(url) {
    await this.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'aun-p0', version: '1' } });
    this.notify('notifications/initialized');
    const listed = await this.request('tools/list');
    const names = listed.tools?.map(tool => tool.name) ?? [];
    const name = ['browser_navigate', 'new_page', 'navigate_page'].find(candidate => names.includes(candidate));
    if (!name) throw new Error(`P0_UNSUPPORTED_TOOLS: ${JSON.stringify(names)}`);
    const result = await this.request('tools/call', { name, arguments: name === 'navigate_page' ? { type: 'url', url } : { url } });
    if (result.isError) throw new Error(`P0_TOOL_ERROR: ${JSON.stringify(result)}\n${this.logs}`);
    return { tool: name, result };
  }
}
