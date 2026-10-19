# Changelog

All notable changes to this project are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Ships as 0.1.0.

### Added

- **Skill pack** (`skills/browser-control-layer/`)
  - `SKILL.md` walks the AI through frame, route, pick, batch, run, verify, clean and report, and loads only the file each step needs.
  - Seven method files: cost model, route by job, batch first, close what you open, resources, profiles and site rules, verify and report.
  - Seven playbooks: fetch order, wait for an element, scoped extraction, indexed actions, snapshot references, remote browser and stop rules.
  - A runner template, a brief template and a report template, plus checklists with a gate code per stage.
  - Generated reference pages for the pinned drivers and for every default.
- **Hygiene commands**
  - `doctor` audits automation browsers and memory headroom without changing anything; `--remote` lists remote sessions read-only.
  - `cleanup` is a dry run until `--apply` and prints one checked cleanup line that names the probes that ran.
  - `reap` closes idle, orphaned or over-budget browsers the package owns.
  - `top` shows owned browsers with memory, CPU and idle seconds.
  - `lease` starts a driver in its own process group with an owner file and a throwaway profile.
  - Three profile classes: your own browser is never touched, a driver's persistent profile is closed gracefully and kept, a throwaway profile is closed and removed.
  - Ownership is proved from owner files, pinned driver recipes and exact profile paths, never from a process name. A browser from a driver the package does not recognize is reported and left running.
- **Hooks** for Claude Code, through the plugin
  - `aun-pick-guard` accepts isolated or throwaway profiles and refuses your own Chrome profile.
  - `aun-retry-guard` stops repeated waits, navigations, empty reads and identical errors.
  - The `aun-retry-guard` wait guard is active with `waitCap=8`, calibrated on the R4 benchmark fixture and reset by a non-empty read.
  - `aun-batch-nudge` reminds the AI to batch when single actions pile up.
  - `aun-cleanup` stamps activity, blocks a stop once while run-created tabs or browsers are open, sweeps at session start, on each prompt and at session end, starts one idle timer per session, and tells the AI when a browser closed after sitting idle.
- **`read`**
  - Fetches a public page as text through a documented order: site sidecars such as `llms.txt`, a Markdown twin, then plain text. An installed Crawl4AI shows up in the result as an available reader.
  - Applies a URL policy, wraps the page as untrusted data, returns typed errors, saves the file with private permissions and prints a short head, the path and the byte count.
  - Reports the site's `llms.txt` and `ai-instructions.json` files.
  - Labels fetched text `clean`, `review`, `flagged` or `unscreened`, with a built-in `rules` provider and a `command` provider you name. The default label is `unscreened`.
- **`meter`** reports your own per-step re-read share from local Claude Code transcripts and prints aggregates only.
- **`bench`**
  - `bench hygiene` measures leftovers after several kinds of run ending, a sentinel-browser safety check, hook overhead, resource settings and the screen rules, with no model and no key.
  - `bench cost` and `bench e2` compare the package with a baseline through your own harness, print the planned run count and a spend preview, and ask before spending.
  - Result rows carry a date, an expiry, a machine description and a raw-log hash; `docs/DEFAULTS.md` is generated from them and from dated primary documentation.
- **Remote browser** playbook for Cloudflare Browser Run with Chrome DevTools MCP: a short keep-alive, an explicit close, a close-reason audit and a Live View hand-back, using your own account and token.
- **Installer and uninstaller**
  - `npx browser-control-layer` previews every file, asks once, writes an install receipt and keeps backups of edited files; `--dry-run` writes nothing.
  - `uninstall` removes only the files the install wrote and nobody edited.
  - Hosts: Claude Code (plugin or project files), Codex, Gemini CLI, Cursor, any `AGENTS.md` host and a zero-install paste block. Gemini via Antigravity CLI shares the Codex path.
  - Companions such as rtk are printed with their vendor commands and never installed.
- **Claude Code plugin** with the skill, the `aun-runner-browser` runner and the hook registry.
- **Documentation and credits**
  - Provenance for every packaged idea, with the file that carries it and the command, template or hook that uses it.
  - Credits and licences for every upstream project.
  - `llms.txt`, an `AGENTS.md` build guide and a roadmap.
