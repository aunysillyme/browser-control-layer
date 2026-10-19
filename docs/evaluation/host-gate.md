# Host activation gate

A host trial establishes that the host loaded the skill and aun-runner and actually invoked the declared hooks. Installer and contract tests establish files and payload shapes; a real-client receipt establishes activation. Keep that distinction when reporting a result. Sources: [host catalog](../../src/install/catalog.mjs), [installer receipt](../../src/install/index.mjs), [hook manifest](../../hooks/hooks.json).

## Prepare the trial

Use a disposable project and an isolated or throwaway browser profile on public synthetic pages. Read [COMPATIBILITY.md](../COMPATIBILITY.md) and the host's [adapter](../../adapters/claude-code.md). For Claude Code, load the repository through the host's plugin mechanism, or preview `npx browser-control-layer install --host claude-code --dry-run` and install its project files. Retain the exact host version, package commit and command used.

The plugin ships [agents/aun-runner-browser.md](../../agents/aun-runner-browser.md), [skills/browser-control-layer/SKILL.md](../../skills/browser-control-layer/SKILL.md) and [hooks/hooks.json](../../hooks/hooks.json). A project install instead generates host-specific paths from the catalog. An installer receipt begins with activation marked `UNVERIFIED`; installation alone does not change that evidence into a live pass.

## Observe the sequence

- **Skill:** ask the host to name the loaded skill path and explain its stages. Save the response and loading evidence.
- **Runner:** invoke the installed aun-runner on a small public-page task. Save evidence that the host loaded its file, rather than only mentioning its name.
- **Browser events:** inspect host hook diagnostics for a recognized browser tool. Confirm the pick check, stamp and browser activity were associated with the intended session. The hook entry points and matching rules are in [cli.mjs](../../src/hooks/cli.mjs) and [_event.mjs](../../src/hooks/_event.mjs).
- **Stop block:** with a run-owned resource still recorded, stop the runner or host. Save the close check's block and listed resources. It blocks once; the next stop with its repeat flag set avoids an endless stop loop. Source: [close-check.mjs](../../src/hooks/close-check.mjs).
- **Close and pass:** close only this run's owned resources, run `npx browser-control-layer cleanup --session <session-key> --apply`, and inspect the cleanup line. Stop again and retain the passing response and an independent owned-resource probe. A missing probe stays `UNVERIFIED`.
- **End:** close the trial browser and host session, then retain their final state and the cleanup evidence. Read [HYGIENE.md](../HYGIENE.md) for timer and session-end behavior.

Use the actual normalized session key from the hook receipt or ledger. `--session` also accepts the value supplied through `AUN_SESSION_KEY`; an unresolved session is an argument error. Sources: [event normalization](../../src/hooks/_event.mjs), [CLI parsing](../../src/hygiene/cli.mjs), [checked cleanup line](../../src/hygiene/cleanup.mjs).

## Save the receipt

Store the trial under `docs/evidence/host-trial-<host>.json`. Record the receipt fields below, plus host and driver versions, package commit, loaded paths, raw-log path and hash. In `observed`, distinguish skill loading, aun-runner loading, hook execution, the initial block, the later pass and verified cleanup. Record a failed or unverified observation as such; never substitute a generated file for a loading receipt.

<!-- generated:reference:start (source: src/build/validate.mjs, CLAIM_EVIDENCE receipt validation) -->
Receipt fields: `command`, `environment`, `date`, `exitCode`, `artifactSha256`, `observed`.
<!-- generated:reference:end -->

These receipt fields bind content claims through [CLAIM_EVIDENCE](../../src/build/validate.mjs). A content-review entry with `PASS` must name the exact claim text and its evidence path. An independent content review that has not run may be `WAIVED` with its reason; WAIVED never blocks. The waiver describes review status and supplies no host activation evidence.

## Reproduce the contracts

```text
node --test test/install.test.mjs test/generate.test.mjs test/hooks.test.mjs
node scripts/check.mjs --only CLAIM_RUNNERS,CLAIM_EVIDENCE
```

The [scripted deterministic trial](../../evals/e1/run.mjs) exercises installed hook commands against controlled browsers. It is useful integration evidence and remains separate from this real-client loading trial. Nothing schedules this manual trial; retain the receipt when host behavior changes so the new result can be compared with the previous one.
