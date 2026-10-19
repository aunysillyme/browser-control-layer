import { basename } from 'node:path';
import { PROFILE, profileArgument } from './profiles.mjs';

// A version receipt is required before an installed driver can own a browser.
export const RECIPES = Object.freeze([
  { id: 'playwright-mcp', version: null, executables: ['chrome', 'chromium', 'Google Chrome', 'Chromium'], automationFlags: ['--remote-debugging-pipe'], profileClass: PROFILE.PERSISTENT, source: 'https://github.com/microsoft/playwright-mcp', verification: 'CI_PENDING' },
  { id: 'chrome-devtools-mcp', version: null, executables: ['chrome', 'chromium', 'Google Chrome', 'Chromium'], automationFlags: ['--remote-debugging-port=0'], profileClass: PROFILE.THROWAWAY, source: 'https://github.com/ChromeDevTools/chrome-devtools-mcp', verification: 'CI_PENDING' },
  { id: 'agent-browser', version: null, executables: ['chrome', 'chromium', 'Google Chrome', 'Chromium'], automationFlags: ['--remote-debugging-port=0'], profileClass: PROFILE.THROWAWAY, source: 'https://github.com/vercel-labs/agent-browser', verification: 'CI_PENDING' }
]);

export function matchRecipe(processInfo, { recipes = RECIPES, versions = {} } = {}) {
  if (!processInfo?.readable || !processInfo.argv?.length || !processInfo.executable) return null;
  const profile = profileArgument(processInfo.argv);
  if (!profile) return null;
  return recipes.find(recipe => typeof recipe.version === 'string' && recipe.version.length > 0 && versions[recipe.id] === recipe.version && recipe.executables.includes(basename(processInfo.executable)) && recipe.automationFlags.every(flag => processInfo.argv.includes(flag)) && typeof recipe.matchesProfile === 'function' && recipe.matchesProfile(profile)) || null;
}
