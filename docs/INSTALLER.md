# Installer

<!-- installer:start (generated) -->
## Project installation

Run `npx browser-control-layer` in the project. The preview lists every target and its hash, the receipt, and optional companion commands. Enter `edit <host>` to choose another host, then confirm once. `install --host <host> --dry-run` produces the same plan and performs no writes. Companions are printed for the user to install separately.

- **Claude Code:** skill at `.claude/skills/browser-control-layer`; runner at `.claude/agents/aun-runner-browser.md`.
- **Codex:** skill at `.agents/skills/browser-control-layer`; runner at `.agents/aun-runner-browser.md`.
- **Gemini CLI:** skill at `skills/browser-control-layer`; runner at `.gemini/aun-runner-browser.md`; context at `GEMINI.md`.
- **Cursor:** skill at `skills/browser-control-layer`; runner at `.cursor/aun-runner-browser.md`; context at `.cursor/rules/browser-control-layer.mdc`.
- **AGENTS.md:** skill at `skills/browser-control-layer`; runner at `agents/aun-runner-browser.md`; context at `AGENTS.md`.

Claude Code project hooks merge into `.claude/settings.json`. A local runtime snapshot keeps those commands usable after the package cache changes. Other hosts use the cleanup commands until a native hook trial proves their integration. Activation remains UNVERIFIED until a real host session confirms it.

The receipt lives at `.browser-control-layer/install.json`. Each written file has a hash; edited integration files have backups under `.browser-control-layer/backups/`. Existing identical files remain user-owned. Conflicts and linked targets are refused before writes. An existing receipt requires uninstall before replacement.

Run `npx browser-control-layer uninstall --dry-run` to preview removal, then `uninstall` to apply it. Only unchanged written files are removed; unchanged integrations restore their original bytes. Edited files and the backups they need remain with a receipt. An absent receipt returns code 2 and changes nothing. An interrupted install retains its receipt for recovery.

Source of truth: `src/install/catalog.mjs` and `src/install/index.mjs`. The command reads shipped skill assets and writes only in the selected project. It starts no services. `consumer.yml` tests one packed tarball on each supported operating system; `release.yml` publishes only after those consumers pass. Local verification: `node --test test/install.test.mjs test/generate.test.mjs`. Native host loading is verified separately by a host-trial receipt.
<!-- installer:end -->
