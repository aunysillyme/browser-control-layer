import { spawn } from 'node:child_process';
import { McpClient } from './protocol.mjs';

const spec = JSON.parse(process.argv[2]);
const url = spec.url || 'data:text/html,<title>aun-p0</title><main>Public synthetic browser fixture</main>';
let child;
let client;
let logs = '';

function command(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(spec.executable, args, { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    proc.stdout.on('data', chunk => { output += chunk; });
    proc.stderr.on('data', chunk => { output += chunk; });
    proc.on('error', reject);
    proc.on('exit', code => code === 0 ? resolve({ pid: proc.pid, output }) : reject(new Error(`P0_CLI_EXIT: ${code}\n${output}`)));
  });
}

try {
  let driverPid;
  if (spec.driver.transport === 'mcp') {
    const args = [...spec.variant.args];
    args.push(spec.driver.id === 'playwright-mcp' ? `--executable-path=${spec.browserPath}` : `--executablePath=${spec.browserPath}`);
    child = spawn(spec.executable, args, { env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    client = new McpClient(child);
    const opened = await client.open(url);
    driverPid = child.pid;
    logs = JSON.stringify({ tool: opened.tool });
  } else {
    const args = ['--session', spec.token, '--executable-path', spec.browserPath];
    const opened = await command([...args, 'open', url]);
    logs = opened.output;
  }
  process.send({ type: 'ready', driverPid, logs });
} catch (error) {
  process.send({ type: 'failed', error: { name: error.name, message: error.message, stack: error.stack } });
  child?.stdin.end();
  process.exitCode = 1;
  process.disconnect();
}

process.on('message', async message => {
  if (message?.type !== 'close') return;
  try {
    if (spec.driver.transport === 'cli') {
      await command(['--session', spec.token, 'close']);
    } else child?.stdin.end();
    process.send?.({ type: 'closed' });
    process.disconnect();
  } catch (error) {
    process.send?.({ type: 'close-error', error: { name: error.name, message: error.message, stack: error.stack } });
    process.disconnect();
  }
});
