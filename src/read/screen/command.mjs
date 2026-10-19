import { spawn } from 'node:child_process';

export const SCREEN_LIMITS = Object.freeze({ timeoutMs: 5000, outputBytes: 65536 });

export async function screenCommand(content, { command, args = [], timeoutMs = SCREEN_LIMITS.timeoutMs, maxOutputBytes = SCREEN_LIMITS.outputBytes, spawnCommand = spawn } = {}) {
  if (!command) return { status: 'unscreened', provider: 'command', reasons: ['provider_unavailable'] };
  return new Promise((resolve) => {
    let child;
    const output = [];
    let bytes = 0;
    let complete = false;
    let aborted;
    const abort = (reason) => {
      aborted = reason;
      child?.stdin?.destroy();
      if (child && child.exitCode == null) child.kill('SIGKILL');
    };
    const done = (status, reasons) => {
      if (complete) return;
      complete = true; clearTimeout(timer);
      resolve({ status, provider: 'command', reasons });
    };
    const timer = setTimeout(() => {
      // Kill only the child created by this invocation and wait for close.
      abort('provider_timeout');
    }, timeoutMs);
    try {
      child = spawnCommand(command, args, { shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
      child.on('error', () => done('unscreened', ['provider_error']));
      child.stdin.on('error', () => {});
      child.stderr.on('data', () => {});
      child.stdout.on('data', (chunk) => {
        bytes += Buffer.byteLength(chunk);
        if (bytes > maxOutputBytes) { abort('provider_output_limit'); return; }
        output.push(Buffer.from(chunk));
      });
      child.on('close', (code) => {
        if (aborted) { done('unscreened', [aborted]); return; }
        if (code !== 0) { done('unscreened', ['provider_exit']); return; }
        try {
          const result = JSON.parse(Buffer.concat(output).toString('utf8'));
          if (!['clean', 'review', 'flagged', 'unscreened'].includes(result.status) || !Array.isArray(result.reasons) || result.reasons.length > 16 || result.reasons.some((reason) => typeof reason !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/u.test(reason))) throw Error('Invalid provider response');
          done(result.status, result.reasons);
        } catch { done('unscreened', ['provider_invalid']); }
      });
      child.stdin.end(content);
    } catch { done('unscreened', ['provider_error']); }
  });
}
