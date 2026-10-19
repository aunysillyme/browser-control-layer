export const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/;

export function selectVersions(catalog, supplied = {}) {
  const rows = [...catalog.drivers, { package: 'puppeteer', version: catalog.browser?.version }, ...(catalog.tools || [])];
  const required = rows.map(row => row.package);
  const pins = Object.fromEntries(rows.map(row => [row.package, row.version]));
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
