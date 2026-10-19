# Compatibility

The pack supplies method files, generated aun-runner instructions and terminal commands over browser tools already installed in your host. Installation paths come from the [host catalog](../src/install/catalog.mjs); a generated file is distinct from a real-client loading receipt. Start with the [installer guide](INSTALLER.md).

## Works with

| Host | What you get | Activation check |
|---|---|---|
| Claude Code | Plugin skill, committed aun-runner and event hooks; project-file installation under `.claude/skills/browser-control-layer/` with a generated runner and project-scoped hooks | [Claude Code adapter](../adapters/claude-code.md) and [host gate](evaluation/host-gate.md) |
| Codex | Skill under `.agents/skills/browser-control-layer/`, generated aun-runner at `.agents/aun-runner-browser.md`, terminal commands | [Codex adapter](../adapters/codex.md) |
| Gemini CLI | Skill under `skills/browser-control-layer/`, generated aun-runner under `.gemini/`, context instructions in `GEMINI.md`, terminal commands | [Gemini CLI adapter](../adapters/gemini-cli.md) |
| Cursor | Skill under `skills/browser-control-layer/`, generated aun-runner under `.cursor/`, a project rule and terminal commands | [Cursor adapter](../adapters/cursor.md) |
| Hosts reading AGENTS.md | Skill folder, generated aun-runner under `agents/`, a context block and terminal commands | [AGENTS.md adapter](../adapters/agents-md.md) |
| Zero-install use | Read-only doctor and a pasteable method; no project files written | [Zero-install adapter](../adapters/zero-install.md) |

Claude Code has declared hook wiring in [hooks/hooks.json](../hooks/hooks.json). The other host catalog entries install method and runner text without native hooks. Native loading on this host is awaiting a real-client trial; the check below confirms it on yours. For each host you use, follow its adapter check and save a receipt before describing native activation as verified.

| Driver or route | What you get | Source |
|---|---|---|
| Playwright MCP | Method and snapshot-reference guidance, pinned persistent and isolated profile variants, stamped ownership checks where the recipe matches | [Driver catalog](../bench/drivers.json), [recipes](../src/hygiene/recipes.mjs) |
| Chrome DevTools MCP | Method guidance, pinned driver-persistent profile recipe and remote CDP playbook | [Driver catalog](../bench/drivers.json), [recipes](../src/hygiene/recipes.mjs), [aun-edge playbook](../skills/browser-control-layer/playbooks/remote-browser.md) |
| agent-browser | CLI-driver hook recognition, session-stamped ownership and throwaway-profile recipe | [Driver catalog](../bench/drivers.json), [recipes](../src/hygiene/recipes.mjs), [tool matching](../src/hooks/_event.mjs) |
| Puppeteer | Synthetic benchmark launch and browser-resource measurements | [Scenario harness](../bench/scenarios.mjs) |
| Cloudflare Browser Run | aun-edge recipe, read-only remote listing and close by ledger-recorded session id | [Remote implementation](../src/hygiene/remote.mjs), [playbook](../skills/browser-control-layer/playbooks/remote-browser.md) |
| Another installed browser tool | The aun-runner method and manual cleanup contract; doctor reports processes it cannot prove it owns | [Security model](SECURITY-MODEL.md), [doctor](../src/hygiene/doctor.mjs) |

Use [DRIVERS.md](DRIVERS.md) for the dated driver method and [HYGIENE.md](HYGIENE.md) for ownership classes. Matching a driver name is insufficient to authorize cleanup: profile, version, process identity and session evidence must pass the ownership checks. Windows provides process inspection; process signaling waits for a verified adapter and is refused by the shipped Windows adapter. Sources: [ownership](../src/proc/owns.mjs), [Windows adapter](../src/proc/platform/win32.mjs).

## Confirm activation

- **Load:** ask the host to identify the skill path it read and describe the method stages.
- **Inspect:** run `npx browser-control-layer doctor` and read its verification status.
- **Exercise:** run a short public-page task in an isolated or throwaway profile, invoke the generated aun-runner where supported, and independently check the task result.
- **Close:** end the job with `npx browser-control-layer cleanup --session <session-key> --apply`, then inspect the checked cleanup line. Use [host-gate.md](evaluation/host-gate.md) to verify Claude Code's block-then-pass hook behavior.
- **Record:** save host and driver versions, date, command, observed loading and cleanup evidence. A file-generation test proves generated artifacts, while a host receipt proves activation.

Sources: [installer tests](../test/install.test.mjs), [generation tests](../test/generate.test.mjs), [session argument handling](../src/hygiene/cli.mjs). Public-page routes use isolated or throwaway profiles and leave the user's own browser untouched.
