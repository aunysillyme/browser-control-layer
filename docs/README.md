# Documentation

Start with [the front page](../README.md) for the install command and [METHOD.md](METHOD.md) for the browser-work sequence. The AI performs browser work through its installed tools; the pack supplies instructions, guards, cleanup and measurement.

## Use the pack

| Page | Use it for |
|---|---|
| [INSTALLER.md](INSTALLER.md) | Preview writes, choose a host, understand receipts and uninstall |
| [COMPATIBILITY.md](COMPATIBILITY.md) | Find host and driver support and confirm activation |
| [METHOD.md](METHOD.md) | Route, pick, batch, run, verify and report |
| [DRIVERS.md](DRIVERS.md) | Apply the method to each pinned driver |
| [HYGIENE.md](HYGIENE.md) | Own browser resources, close them and check the cleanup line |
| [HOOKS.md](HOOKS.md) | Understand browser matching, event guards and idle cleanup |
| [READER.md](READER.md) | Fetch text, enforce URL policy, screen and retain bounded output |
| [METER.md](METER.md) | Measure local transcript cost with aun-meter |
| [SECURITY-MODEL.md](SECURITY-MODEL.md) | Review ownership, profiles, process identity and remote-session rules |

Host-specific instructions live in [adapters/](../adapters/). The [skill entry](../skills/browser-control-layer/SKILL.md) loads only the method files, playbooks and checklists needed for the current step. Its [manifest](../skills/browser-control-layer/manifest.json) binds shipped assets and load routes.

## Evaluate and inspect evidence

| Page or record | Use it for |
|---|---|
| [BENCHMARK.md](BENCHMARK.md) | Choose a suite, reproduce it and interpret its row schema |
| [EVALUATION.md](EVALUATION.md) | Understand deterministic cleanup and paired-task claim rules |
| [RESULTS.md](RESULTS.md) | Read generated package proof and rerun commands |
| [DEFAULTS.md](DEFAULTS.md) | Trace resource defaults to rows or dated primary sources |
| [evaluation/host-gate.md](evaluation/host-gate.md) | Capture a real-client activation trial |
| [evidence/content-review.json](evidence/content-review.json) | Check content hash bindings and review dispositions |
| [evidence/sources.json](evidence/sources.json) | Inspect upstream source and licence records |

The [proof row file](../proof/results.json) supplies generated results. A proof row and its raw hash establish a measured claim under its recorded conditions; a host trial establishes loading. Keep those evidence types separate.

## Project context

- [PROVENANCE.md](PROVENANCE.md): concept-to-file-to-command map and upstream attribution.
- [CREDITS.md](../CREDITS.md): creators, repository links, licences and how their work informs the pack.
- [ROADMAP.md](ROADMAP.md): planned additions and their evidence requirements.
- [CHANGELOG.md](../CHANGELOG.md): released changes.
- [CONTRIBUTING.md](../CONTRIBUTING.md): contribution entry point.
- [AGENTS.md](../AGENTS.md): contributor build instructions.
- [SECURITY.md](../SECURITY.md): vulnerability reporting.
- [RELEASING.md](../RELEASING.md): release procedure and verification.
