import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { config } from '../config.mjs';
import { fetchPage, findCrawler } from './fetch-order.mjs';
import { wrapContent } from './wrap.mjs';
import { saveContent, boundedOutput } from './save.mjs';
import { screenContent } from './screen/index.mjs';
import { ReadError } from './errors.mjs';

export function parseReadArgs(args) {
  const options = { url: '', output: '', headBytes: 2048, screen: { provider: 'none' } };
  const take = (index) => {
    if (!args[index] || args[index].startsWith('--')) throw new ReadError('USAGE', 'Flag requires a value');
    return args[index];
  };
  for (let index = 0; index < args.length; index++) {
    const value = args[index];
    if (value === '--output') options.output = take(++index);
    else if (value === '--head-bytes') {
      const bytes = Number(take(++index));
      if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > 65536) throw new ReadError('USAGE', 'Head byte count must be an integer from 0 through 65536');
      options.headBytes = bytes;
    } else if (value === '--screen') {
      const provider = take(++index);
      if (!['none', 'rules', 'command'].includes(provider)) throw new ReadError('USAGE', 'Choose none, rules or command screening');
      options.screen.provider = provider;
    } else if (value === '--screen-command') options.screen.command = take(++index);
    else if (value.startsWith('-') || options.url) throw new ReadError('USAGE', 'Supply one URL and supported read flags');
    else options.url = value;
  }
  if (!options.url) throw new ReadError('USAGE', 'Supply one public HTTP or HTTPS URL');
  if (options.screen.provider === 'command' && !options.screen.command) throw new ReadError('USAGE', 'Command screening needs --screen-command');
  return options;
}

export async function readCommand(args, { fetch = fetchPage, save = saveContent, screen = screenContent, crawler = findCrawler, write = console.log } = {}) {
  const options = parseReadArgs(args);
  const response = await fetch(options.url);
  const source = new URL(response.url);
  source.search = '';
  const sections = response.sidecars.filter((item) => typeof item.content === 'string').map((item) => `Source: ${item.path}\n${item.content}`);
  const content = wrapContent([`Source: ${source.href}`, response.body, ...sections].join('\n\n'));
  const verdict = await screen(content, options.screen);
  const path = options.output ? resolve(options.output) : join(tmpdir(), `${config().skillName}-read-${randomUUID()}.txt`);
  const saved = await save(path, content);
  const installed = await crawler();
  const sidecars = response.sidecars.map(({ path, error, content: body }) => ({ path, ...(error ? { error } : { bytes: Buffer.byteLength(body), status: 'retrieved' }) }));
  const result = { ...boundedOutput(content, { ...saved, headBytes: options.headBytes, screen: verdict.status }), screening: verdict, sidecars, route: response.route, crawler: installed ? 'available-policy-unverified' : 'absent' };
  write(JSON.stringify(result));
  return 0;
}

export const readMain = readCommand;
