import { screenRules } from './rules.mjs';
import { screenCommand } from './command.mjs';

export async function screenContent(content, options = {}) {
  if (options.provider === 'rules') return screenRules(content);
  if (options.provider === 'command') return screenCommand(content, options);
  return { status: 'unscreened', provider: 'none', reasons: ['provider_not_selected'] };
}
