# Contributing

Use synthetic reproductions and reserved example domains. Start with
[the build guide](AGENTS.md), then read the manifest for the asset you change.

## Verify

Use Node >=22. Run `node scripts/build.mjs --rehash` for intentional skill edits,
`node scripts/check.mjs` and `node --test`. Check is read-only. Browser suites
run in CI. Give new rules a refusing case and a passing control.
Release candidates also run `node scripts/check.mjs --release`.
Keep source attribution and return exact checks with any unverified behavior.

## Contributor License Agreement

Outside contributors tick the Contributor License Agreement box in the PR description.
You keep the copyright in what you wrote and grant Auny LLC the licenses in [CLA.md](CLA.md).
Use [private reporting](SECURITY.md) for vulnerabilities.
