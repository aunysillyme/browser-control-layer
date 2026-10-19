# Release operations

## What and why

This guide covers validation and distribution. Browser proofs run in browser.yml;
repository checks run in check.yml. Nothing watches local commands.

## Trigger and invocation

A maintainer runs build, check, tests and independent review. A version tag starts
release.yml. It verifies metadata, runs release checks, packs once and publishes
that same tarball with provenance. Publication requires maintainer authorization.

## Dependencies and data

Node >=22, git and the checked-in sources are required locally. CI also installs
its declared development tools. Checks read source and evidence. Build writes
manifest hashes and generated bundles. Browser jobs write proof artifacts.

## Failures and verification

Any failed required check stops publication. Inspect its complete job output.
Run `node scripts/check.mjs --release` and `node --test` by hand. Verify the
published version, provenance and README against the registry after a release.
Live publication and consumer installation: UNVERIFIED for this scaffold.

## Source of truth

package.json, the skill manifest and the workflows define the behavior.
proof.yml and repo-health.yml are maintainer-dispatched until their refresh
implementation lands; they fail visibly in the meantime. Nothing schedules them.
