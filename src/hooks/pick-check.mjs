import { isAbsolute, win32, normalize } from 'node:path';
import { isUserProfile } from '../hygiene/profiles.mjs';
import { deny } from './_event.mjs';

const fail = (event, message) => ({ allowed: false, output: deny(event, `aun-pick-guard: ${message}`) });
const present = value => value !== undefined && value !== null && value !== '';

function argumentsChoice(args) {
  const paths = [];
  let isolated, browser, browserSession;
  for (let i = 1; i < (args?.length || 0); i++) {
    const arg = args[i];
    if (/^--(?:cdp|connect|browser-url|ws-endpoint|wsEndpoint|auto-connect|autoConnect|extension)(?:=|$)/.test(arg)) return { attach: true };
    if (arg === '--isolated') isolated = true;
    if (arg === '--session') browserSession = args[++i];
    else if (arg.startsWith('--session=')) browserSession = arg.slice('--session='.length);
    if (arg === '--browser' || arg === '--channel') browser = args[++i];
    else if (/^--(?:browser|channel)=/.test(arg)) browser = arg.slice(arg.indexOf('=') + 1);
    if (arg === '--user-data-dir' || arg === '--userDataDir' || arg === '--profile') paths.push(args[++i]);
    else if (/^--(?:user-data-dir|userDataDir|profile)=/.test(arg)) paths.push(arg.slice(arg.indexOf('=') + 1));
  }
  return { isolated, paths, browser, browserSession };
}

export function launchChoice(event, tool, configured = {}) {
  const input = event.input;
  const parsed = argumentsChoice(tool.args);
  const fields = ['user_data_dir', 'userDataDir', 'profile_path', 'profilePath', 'profile'];
  const paths = [...(parsed.paths || []), ...fields.filter(key => present(input[key])).map(key => input[key])];
  if (present(configured.userDataDir)) paths.push(configured.userDataDir);
  return {
    driverId: tool.driverId,
    browser: input.browser || parsed.browser || configured.browser || 'chromium',
    browserSession: input.sessionId || input.session_id || parsed.browserSession || configured.browserSession || '',
    profileClass: input.profile_class || input.profileClass || configured.profileClass,
    isolated: parsed.isolated === true || input.isolated === true || configured.isolated === true,
    paths,
    attach: parsed.attach || ['cdp', 'browserURL', 'browserUrl', 'wsEndpoint', 'autoConnect'].some(key => present(input[key]))
  };
}

export async function pickCheck(event, tool, { ledger, choices = {}, profileOptions = {} }) {
  if (!tool) return { allowed: true, output: {} };
  if (!tool.valid) return fail(event, 'Use one direct browser command without shell expansions or operators.');
  const previous = (await ledger.readSession(event.sessionKey))?.hooks?.selection;
  const configured = choices[tool.driverId] || (previous?.driverId === tool.driverId ? { browser: previous.browser, browserSession: previous.browserSession, profileClass: previous.profileClass, ...(previous.profile !== 'isolated' ? { userDataDir: previous.profile } : {}) } : {});
  const selected = launchChoice(event, tool, configured);
  if (typeof selected.browser !== 'string' || !selected.browser) return fail(event, 'Name the browser selected at launch.');
  if (selected.attach) return fail(event, 'Launch an isolated browser for this public-page session.');
  const platform = profileOptions.platform || process.platform;
  const pathApi = platform === 'win32' ? win32 : { isAbsolute, normalize };
  if (selected.paths.some(path => typeof path !== 'string' || !pathApi.isAbsolute(path) || isUserProfile(path, profileOptions))) return fail(event, 'Choose an absolute throwaway profile outside the user browser directory.');
  const paths = [...new Set(selected.paths.map(path => platform === 'win32' ? pathApi.normalize(path).toLowerCase() : pathApi.normalize(path)))];
  if (paths.length > 1) return fail(event, 'Use one profile path for the browser session.');
  if (selected.profileClass && !['isolated', 'throwaway'].includes(selected.profileClass)) return fail(event, 'Choose an isolated or throwaway profile.');
  if (!(selected.isolated || selected.profileClass === 'isolated' || selected.profileClass === 'throwaway' && paths.length === 1)) return fail(event, 'Set the launch choice to isolated, or declare the throwaway profile path.');
  const selection = { driverId: selected.driverId, browser: selected.browser, browserSession: selected.browserSession, profile: paths[0] || 'isolated', profileClass: selected.profileClass || 'isolated' };
  let changed = false;
  await ledger.updateSession(event.sessionKey, old => {
    if (old?.hooks?.selection && JSON.stringify(old.hooks.selection) !== JSON.stringify(selection)) { changed = true; return old; }
    return { ...old, sessionKey: event.sessionKey, hooks: { ...old?.hooks, selection } };
  });
  return changed ? fail(event, 'Keep the browser and profile fixed for this session; start a fresh session to choose another.') : { allowed: true, selection, output: {} };
}
