import { homedir } from 'node:os';
import { isAbsolute, normalize, resolve, sep, win32 } from 'node:path';

export const PROFILE = Object.freeze({ USER: 'user', PERSISTENT: 'driver-persistent', THROWAWAY: 'throwaway' });

export function userProfilePaths({ platform = process.platform, home = homedir(), env = process.env } = {}) {
  if (platform === 'darwin') return [resolve(home, 'Library/Application Support/Google/Chrome'), resolve(home, 'Library/Application Support/Chromium')];
  if (platform === 'win32') return [win32.join(env.LOCALAPPDATA || win32.join(home, 'AppData/Local'), 'Google/Chrome/User Data'), win32.join(env.LOCALAPPDATA || win32.join(home, 'AppData/Local'), 'Chromium/User Data')];
  const base = env.CHROME_CONFIG_HOME || env.XDG_CONFIG_HOME || resolve(home, '.config');
  return [resolve(base, 'google-chrome'), resolve(base, 'google-chrome-beta'), resolve(base, 'google-chrome-unstable'), resolve(base, 'chromium')];
}

export function samePath(a, b, platform = process.platform) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const path = platform === 'win32' ? win32 : { normalize, resolve };
  const canonical = value => path.normalize(path.resolve(value));
  return platform === 'win32' ? canonical(a).toLowerCase() === canonical(b).toLowerCase() : canonical(a) === canonical(b);
}

export function isWithin(parent, child, platform = process.platform) {
  if (typeof child !== 'string' || typeof parent !== 'string') return false;
  const path = platform === 'win32' ? win32 : { resolve, sep };
  const root = path.resolve(parent);
  const target = path.resolve(child);
  const fold = s => ['win32', 'darwin'].includes(platform) ? s.toLowerCase() : s;
  return fold(target) === fold(root) || fold(target).startsWith(fold(root + path.sep));
}

// This check is lexical. It never enumerates or opens a browser profile.
export function isUserProfile(path, options = {}) {
  if (!path || typeof path !== 'string') return true;
  return userProfilePaths(options).some(root => isWithin(root, path, options.platform));
}

export function profileArgument(argv) {
  if (!Array.isArray(argv)) return null;
  const found = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--user-data-dir') found.push(argv[++i]);
    else if (argv[i].startsWith('--user-data-dir=')) found.push(argv[i].slice('--user-data-dir='.length));
  }
  return found.length === 1 && typeof found[0] === 'string' && isAbsolute(found[0]) ? found[0] : null;
}

export function classifyProfile(path, { leaseRoot, leaseVerified = false, recipe, ...options } = {}) {
  if (isUserProfile(path, options)) return PROFILE.USER;
  if (leaseVerified && leaseRoot && isWithin(leaseRoot, path, options.platform)) return PROFILE.THROWAWAY;
  if (recipe?.verified === true && recipe.matchesProfile?.(path)) return recipe.profileClass;
  return PROFILE.USER;
}
