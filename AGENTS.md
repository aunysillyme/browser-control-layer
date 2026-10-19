# Contributor build guide

## Naming

Our own tools and concepts use aun- names; docs/PROVENANCE.md lists them.

## Build steps

Use Node >=22 and JavaScript ESM. Runtime dependencies stay empty.
Read the skill manifest before editing an asset. Keep process ownership checks
immediately before signals. Use fake process and filesystem adapters in unit tests.
Run `node scripts/build.mjs --rehash` after intentional skill edits, then
`node scripts/check.mjs` and `node --test`. Check is read-only.
Use `node scripts/check.mjs --release` for a release candidate.
Real browser, network and loopback suites run through browser.yml in CI.
Keep private term sources in the ignored local file; publish only their hashes.
Give each new guard a refusing case and an allowed control.
Obtain an independent code review before publication.
