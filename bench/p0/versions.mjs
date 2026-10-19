export const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/;

export function selectVersions(catalog, supplied = {}) {
  const required = [...catalog.drivers.map(driver => driver.package), 'puppeteer'];
  const pins = Object.fromEntries(catalog.drivers.map(driver => [driver.package, driver.version]));
  pins.puppeteer = catalog.browser?.version;
  for (const name of Object.keys(supplied)) {
    if (!required.includes(name)) throw new Error(`P0_VERSION_PACKAGE: ${name}`);
  }
  const versions = {};
  for (const name of required) {
    const version = supplied[name] ?? pins[name];
    if (typeof version !== 'string' || !VERSION_PATTERN.test(version)) {
      throw new Error(`P0_VERSION_UNVERIFIED: provide a reviewed exact version for ${name}`);
    }
    versions[name] = version;
  }
  return versions;
}

export function verifyInstalled(versions, installed) {
  for (const [name, version] of Object.entries(versions)) {
    if (installed[name] !== version) throw new Error(`P0_VERSION_DRIFT: ${name}`);
  }
}
