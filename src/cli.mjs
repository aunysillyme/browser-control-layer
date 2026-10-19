import { config } from './config.mjs';
import { readCommand } from './read/cli.mjs';
import { hygieneCommand } from './hygiene/cli.mjs';
import { cliSweep } from './hygiene/sweep.mjs';

export function commandError(error) {
  return JSON.stringify({ code:error.code || 'COMMAND_FAILED', message:error.message, ...(typeof error.retryable==='boolean' ? {retryable:error.retryable} : {}), ...(error.cause?.code ? {causeCode:error.cause.code} : {}) });
}

export async function main(args, adapters = {}) {
  const { name, pkg } = config();
  const write = adapters.write || console.log;
  const metadata = args.length === 1 && ['--version','--help'].includes(args[0]);
  if (metadata || args[0] === 'read') await (adapters.cliSweep || cliSweep)({ env: adapters.env || process.env, ...adapters.hygiene });
  if (args[0] === '--version' && args.length === 1) { write(pkg.version); return 0; }
  if (args[0] === '--help' && args.length === 1) { write(`${name}: doctor | cleanup | reap | top | lease | read | install | uninstall | meter | bench`); return 0; }
  if (!args.length || ['install','uninstall','--uninstall'].includes(args[0])) {
    const uninstall=args[0]==='uninstall' || args[0]==='--uninstall';
    const key=uninstall?'uninstallCommand':'installCommand';
    const command=adapters[key] || (await import('./install/index.mjs'))[key];
    return command(args.slice(1),{write,...adapters.install});
  }
  if (args[0] === 'meter') {
    const command=adapters.meterCommand || (await import('./meter/report.mjs')).meterCommand;
    return command(args.slice(1),{write,...adapters.meter});
  }
  if (args[0] === 'bench') {
    if (['cost','e2'].includes(args[1])) {
      const command=adapters.costCommand || (await import('../bench/cost.mjs')).costCommand;
      return command(args.slice(1),{write,...adapters.bench});
    }
    const command=adapters.benchCommand || (await import('../bench/run.mjs')).benchMain;
    return command(args.slice(1),{stdout:{write:value=>write(value.trimEnd())},...adapters.bench});
  }
  if (args[0] === 'read') return (adapters.readCommand || readCommand)(args.slice(1), { write, ...adapters.read });
  if (['doctor','cleanup','reap','top','lease'].includes(args[0])) {
    const result = await (adapters.hygieneCommand || hygieneCommand)(args, { env: adapters.env || process.env, ...adapters.hygiene });
    if (result.output) write(result.output);
    return result.exitCode;
  }
  throw Object.assign(Error(`Unknown command: ${args[0]}`), { code: 'USAGE', exitCode: 2 });
}
