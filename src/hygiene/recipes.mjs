import { basename } from 'node:path';
import { PROFILE, profileArgument } from './profiles.mjs';

import catalog from '../../bench/drivers.json' with { type: 'json' };

const profilePatterns = {
  'playwright-mcp': /(?:^|\/)ms-playwright(?:-mcp)?\/mcp-[^/]+$/,
  'chrome-devtools-mcp': /(?:^|\/)chrome-devtools-mcp\/(?:chrome-profile|chrome-profile-stable)$/,
  'agent-browser': /(?:^|\/)(?:playwright_chromiumdev_profile-[^/]+|agent-browser-[^/]+)$/
};
// agent-browser keeps its browser under a native daemon that outlives the AI host, so ancestry cannot reach the host.
// Its browser is owned only when that daemon's own AGENT_BROWSER_SESSION equals a session name the host stamped.
const daemons = {
  'agent-browser': { executable: name => /^agent-browser-/.test(name), sessionEnv: 'AGENT_BROWSER_SESSION', passEnv: ['AGENT_BROWSER_SOCKET_DIR', 'AGENT_BROWSER_NAMESPACE'], closeArgs: session => ['--session', session, 'close'] }
};
export const RECIPES = Object.freeze(catalog.drivers.map(driver => ({
  id: driver.id, version: driver.version, daemon: daemons[driver.id],
  executables: ['chrome', 'chromium', 'Google Chrome', 'Chromium', 'chrome-headless-shell'],
  automationFlags: [driver.id === 'agent-browser' ? '--remote-debugging-port=0' : '--remote-debugging-pipe'],
  profileClass: driver.variants[0].profileClass,
  source: driver.source, verification: catalog.verification,
  driverExecutables: [process.execPath],
  driverArg: arg => arg === driver.command || arg.replaceAll('\\', '/').includes(`/${driver.package}/`) || arg.replaceAll('\\', '/').endsWith(`/${driver.command}`),
  matchesProfile: profile => profilePatterns[driver.id]?.test(profile.replaceAll('\\', '/')) === true
})));

export function matchRecipe(processInfo, { recipes = RECIPES, versions = {} } = {}) {
  if (!processInfo?.readable || !processInfo.argv?.length || !processInfo.executable) return null;
  const profile = profileArgument(processInfo.argv);
  if (!profile) return null;
  return recipes.find(recipe => typeof recipe.version === 'string' && recipe.version.length > 0 && versions[recipe.id] === recipe.version && recipe.executables.includes(basename(processInfo.executable)) && recipe.automationFlags.every(flag => processInfo.argv.includes(flag)) && typeof recipe.matchesProfile === 'function' && recipe.matchesProfile(profile)) || null;
}
