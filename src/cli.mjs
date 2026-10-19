import { config } from './config.mjs';
export async function main(args) {
  const { name, pkg } = config();
  if (args[0] === '--version') { console.log(pkg.version); return 0; }
  if (!args.length || args[0] === '--help') { console.log(`${name}: doctor | cleanup | reap | top | lease | read`); return 0; }
  throw Object.assign(Error(`Unknown command: ${args[0]}`), { code: 'USAGE', exitCode: 2 });
}
