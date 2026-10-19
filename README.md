# browser-control-layer

[![npm](https://img.shields.io/npm/v/browser-control-layer.svg)](https://www.npmjs.com/package/browser-control-layer) [![Repository checks](https://github.com/aunysillyme/browser-control-layer/actions/workflows/check.yml/badge.svg)](https://github.com/aunysillyme/browser-control-layer/actions/workflows/check.yml) [![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE) [![node](https://img.shields.io/node/v/browser-control-layer.svg)](package.json)

**A skill pack that teaches your AI to run browser work and close what it opens, over the browser tools you already use.**

- **The problem:** each browser step makes an AI re-read its whole conversation, and browsers it opens can keep using CPU and memory after the job ends.
- **What you get:** a skill your AI reads, hooks that close what it opened, a cleanup command and a benchmark that measures both. Your AI does the browser work.

| Do this | Command |
|---|---|
| See which automation browsers are running now (read-only) | `npx browser-control-layer doctor` |
| Teach your AI and add the cleanup hooks | `npx browser-control-layer` |

<!-- trailer: restored when docs/trailer.gif lands -->

<!-- proof:start (generated; package rows only) -->
| Row | Measurement | Median | Date | Rerun |
|---|---|---|---|---|
| H1 | owner endings | 0 processes | 2026-10-19T10:04:54.791Z | `npx browser-control-layer bench hygiene --suite H --n 3` |
| E1 | crash matrix | 0 processes | 2026-10-19T08:53:51.000Z | `npx browser-control-layer bench hygiene --suite E1 --n 3` |
| H4 | sentinel safety | 0 processes | 2026-10-19T10:04:54.791Z | `npx browser-control-layer bench hygiene --suite H --n 3` |
<!-- proof:end -->

This release works on public pages, in isolated or throwaway browser profiles, and leaves your own Chrome profile untouched. The package closes the browsers it can prove it owns. A browser from a driver it does not recognize is listed by `doctor` and left running.

## What your AI learns

The skill is a short set of steps (frame, route, pick, batch, run, verify, clean, report). At each step your AI loads only the file that step needs. The package teaches and your AI does the browser work through the driver you already have; the package never drives a page itself.

| Method file | What your AI learns |
|---|---|
| [Cost model](skills/browser-control-layer/method/01-cost-model.md) | Why each browser step re-reads the whole conversation, and the three levers that lower the bill: fewer steps, a smaller context per step, a smaller output per step |
| [Route by job](skills/browser-control-layer/method/02-route-by-job.md) | The cheapest way to do each job: read a page as text, batch several reads into one session, fan out in parallel, hand clicks to a fresh runner, or use a remote browser |
| [Batch first](skills/browser-control-layer/method/03-batch-first.md) | Send a predictable sequence as one call and read every field in one pass |
| [Close what you open](skills/browser-control-layer/method/04-close-what-you-open.md) | Who closes what, how to own a browser you start, how idle sessions end, and the checked cleanup line that ends every run |
| [Resources](skills/browser-control-layer/method/05-resources.md) | Practices that keep CPU and RAM low: text before browser, isolated profiles, one browser with tabs, a headless shell, blocked media, waits on elements, scoped reads, a concurrency cap from your own headroom, parked tabs and short remote sessions |
| [Profiles and site rules](skills/browser-control-layer/method/06-profiles-and-site-rules.md) | Three profile classes, one browser and profile per run, site rules that only tighten, a stop at any control that needs a human, and screen labels for fetched text |
| [Verify and report](skills/browser-control-layer/method/07-verify-and-report.md) | A runner's DONE is a claim to check; every action carries an effect status; the report ends with the cleanup line |

Playbooks, a runner, brief and report templates and checklists with a gate code per stage sit beside these files. [SKILL.md](skills/browser-control-layer/SKILL.md) is the entry point.

### Ideas packaged from open projects

Each idea below ships as a file your AI reads and a command, template or hook you run. [Provenance](docs/PROVENANCE.md) lists every row.

| Idea | From | Where you use it |
|---|---|---|
| Choose an index from the page's own numbered list; never write a selector from memory | aun-index-runner, with techniques from [browser-use/jev-ultrafast](https://github.com/browser-use/jev-ultrafast) | [Indexed actions](skills/browser-control-layer/playbooks/indexed-actions.md); a field in the brief |
| Own throwaway profile, own process group, owner file, sweep on start | aun-lease | `lease` command and `reap --orphans` |
| Action ladder, effect statuses, re-observe on stale references, idle expiry, browser and profile fixed at launch | [trycua/cua](https://github.com/trycua/cua) | [Snapshot refs](skills/browser-control-layer/playbooks/snapshot-refs.md); the report template; `reap --idle` |
| One-shot, reuse and dynamic sessions; the app owns the browser; a scheduled sweep; a restarted notice; a web fetch URL policy | [cloudflare/agents](https://github.com/cloudflare/agents) | [Close what you open](skills/browser-control-layer/method/04-close-what-you-open.md); `read`; `reap` |
| A remote browser on your own Cloudflare account with a short keep-alive and a close-reason audit | aun-edge, from [Cloudflare Browser Run docs](https://github.com/cloudflare/cloudflare-docs) | [Remote browser](skills/browser-control-layer/playbooks/remote-browser.md); `doctor --remote` |
| A bounded view: a short head, the rest by path | aun-keep, with [rtk-ai/rtk](https://github.com/rtk-ai/rtk) as an opt-in companion | `read` output; `doctor --json` |
| Route by job; batch first; main picks and the runner executes | aun-web-use, aun-batch-nudge, aun-pick-guard | [Route table](skills/browser-control-layer/checklists/route.md); the batch and pick hooks |
| Measure your own cost | aun-meter, aun-runner | `meter` and `bench cost` |

## What the hooks do

Claude Code loads these through the plugin ([hooks.json](hooks/hooks.json)). They match browser tools only: MCP browser tools, plus Bash commands that start with a known CLI driver.

| Hook | Runs | What it does |
|---|---|---|
| aun-pick-guard | Before a browser tool call | Accepts an isolated or throwaway profile and refuses a launch that points at your own Chrome profile |
| aun-retry-guard | Around browser tool calls | Stops a repeated wait, a repeated navigation to one page, a repeated empty read or a repeated identical error, so your AI changes approach. Its caps come from [DEFAULTS](docs/DEFAULTS.md) |
| aun-batch-nudge | After browser tool calls | Reminds your AI to batch when single actions pile up |
| aun-cleanup: stamp | After each browser tool call | Records session activity so idle time is measured per session |
| aun-cleanup: close check | When the session or a subagent stops | Blocks once while tabs or browsers this run opened are still open, then passes after they close |
| aun-cleanup: session sweep | Session start, each prompt, session end | Closes leftover browsers the package owns from crashed or finished sessions |
| aun-cleanup: idle timer | Started when the session stops | One detached timer per session closes owned browsers idle past the limit, then exits by itself |
| aun-cleanup: idle notice | Next tool call or prompt | Tells your AI that a browser closed after sitting idle and that its temporary profile state is gone |

Other hosts get the same protection from the commands below until a real-client trial confirms native hooks there.

## After you install

`npx browser-control-layer` shows every file it will write and asks once. It copies the skill into your project, adds the runner, and for Claude Code merges project-scoped hooks with a backup of any file it edits. Enter `edit <host>` at the prompt to choose another host. `npx browser-control-layer install --dry-run` shows the same plan and writes nothing.

The installer ends by printing that activation is `UNVERIFIED`. These checks verify it on your host:

| Host | Confirm it loaded |
|---|---|
| Claude Code | Ask it to name the steps in `.claude/skills/browser-control-layer/SKILL.md`. Give it a short public-page job. At stop, the close check blocks once if a tab is still open, then passes |
| Codex, Gemini (via Antigravity CLI) | Ask it to name the steps in `.agents/skills/browser-control-layer/SKILL.md`, then give it a short public-page job |
| Gemini CLI | Ask which file it read for browser work; the `GEMINI.md` block points it at the skill |
| Cursor | Ask it to read the skill through the `.cursor/rules/browser-control-layer.mdc` rule |
| Any host that reads `AGENTS.md` | Ask which file it read for browser work; the `AGENTS.md` block points it at the skill |

On every host, run `npx browser-control-layer doctor` to see the browsers running now, then check that the job's report ends with the cleanup line. It counts the browsers, tabs and sessions closed against those owned, shows what remains, and names the probes that ran. Host pages: [adapters](adapters/claude-code.md).

Here is one cleanup line from a CI fixture run:

<!-- capture:start -->
`cleanup: browsers=1/1 tabs=UNVERIFIED/0 sessions=UNVERIFIED/0 remaining=0 checks=ps`
<!-- capture:end -->

## Part of a set

<!-- set:start -->
## Part of a set

| Repo | What it gives you |
|---|---|
| [agent-personalizer](https://github.com/aunysillyme/agent-personalizer) | AI custom instructions from approved entries: a profile and rules for Claude Code, Codex, Cursor, Gemini CLI and ChatGPT, kept in sync from one source. |
| [model-orchestrator](https://github.com/aunysillyme/model-orchestrator) | Model router for AI coding agents: routes routine work to cheaper models with routing rules, 8 subagents, hooks and a CLI runner |
| [website-build-skill](https://github.com/aunysillyme/website-build-skill) | A skill pack that turns your AI into an expert website builder: current research, design, code, accessibility, speed, SEO and security, alone or as a team. |
<!-- set:end -->

## Run the benchmark yourself

Every number the package publishes comes from a row you can reproduce. The hygiene benchmark needs no model and no key.

| Command | What it measures | What it costs |
|---|---|---|
| `npx browser-control-layer bench hygiene` | Synthetic browsers on a local fixture site, ended several ways: normal close, error, interrupt, terminate, kill, idle and over budget. It counts owned processes, tabs and directories left behind, checks that a sentinel browser it did not start survives, and times the hooks | Free. It detects the drivers on your machine and prints the vendor install line for any pinned driver that is missing. Add `--dry-run` to see the plan |
| `npx browser-control-layer bench cost` | The same task done from your main conversation and handed to the package runner at several conversation sizes, and one action per call against a batch | Uses your own harness and quota. It prints the planned run count and a spend preview, then asks before anything runs |
| `npx browser-control-layer bench e2` | Task cards on a local fixture site, run with and without the package. Two cards are safety checks: a planted instruction on a page, and a button that needs human confirmation | Uses your own AI tool and quota. It prints the planned run count and a spend preview, then asks before anything runs |

Rows are written under `proof/runs/hygiene` in the current folder (change it with `--out`), each with a date, a machine description and a raw-log hash. [Benchmark](docs/BENCHMARK.md) explains each suite, and [Results](docs/RESULTS.md) lists the recorded rows. Send your own `bench hygiene` file as a pull request and it becomes an outside row with your machine and date.

## Commands

Run each with `npx browser-control-layer <command>`.

| Command | What it does |
|---|---|
| `read <url>` | Fetches a public page as text and prints a short head, the saved path and the byte count. The page arrives wrapped as untrusted data with a screen label of `clean`, `review`, `flagged` or `unscreened` |
| `doctor [--json] [--remote]` | A read-only audit of automation browsers and memory headroom. `--remote` lists remote browser sessions |
| `cleanup [--session] [--apply]` | A dry run until `--apply`. Closes what the package owns and prints the cleanup line |
| `reap --idle`, `--orphans` or `--budget` | Closes idle, orphaned or over-budget browsers the package owns. `--dry-run` previews |
| `top` | Owned browsers with memory, CPU and idle seconds |
| `lease -- <driver command>` | Starts a driver in its own process group with an owner file and a throwaway profile. The command carries `--user-data-dir={profile}` |
| `meter [--path <transcripts>] [--json]` | Your own re-read share per step, from local Claude Code transcripts. It runs on your machine and prints aggregates only |

## Works with whatever your AI has

| Your AI has | You get |
|---|---|
| Claude Code | The plugin: the skill, the `aun-runner-browser` runner, every hook above and all commands |
| Codex, or Gemini (via Antigravity CLI) | The skill at `.agents/skills/browser-control-layer/`, the runner as a plain-text brief and all commands. Native hook loading on this host is awaiting a real-client trial; the check above confirms it on yours. Until then `cleanup --session --apply` at the end of a job carries the cleanup |
| Gemini CLI | The skill folder, a `GEMINI.md` block and all commands. Native hook loading on this host is awaiting a real-client trial; the check above confirms it on yours |
| Cursor | The skill folder, a project rule file and all commands. Native hook loading on this host is awaiting a real-client trial; the check above confirms it on yours |
| Any host that reads `AGENTS.md` | The skill folder, an `AGENTS.md` block and all commands |
| A chat with browser tools and nothing installed | [Zero install](adapters/zero-install.md): `doctor` is read-only, and a short block you paste carries the core steps |
| Playwright MCP | Ownership matched by a pinned recipe. A temporary profile (`--isolated`) is closed and nothing is kept. The default persistent profile, which keeps logins, is closed gracefully and kept |
| Chrome DevTools MCP | Ownership matched by a pinned recipe; its persistent profile is closed gracefully and kept. A recipe for pointing it at a remote browser |
| agent-browser | Ownership matched by a pinned recipe, hooks that match the CLI in Bash commands, and its `batch` command taught in the batch-first method |
| Another browser driver, or a version outside the pinned list | `doctor` lists what it sees and leaves it running. Start it under `lease` and the package can prove it owns it |
| A Cloudflare account | The [remote browser playbook](skills/browser-control-layer/playbooks/remote-browser.md), and `doctor --remote` for read-only session listing |
| Crawl4AI | `read` reports it as an available reader, and the fetch-order playbook says when to reach for it |
| rtk | An opt-in companion: the installer prints its vendor install command and leaves running it to you |

[Drivers](docs/DRIVERS.md) lists the pinned driver versions, and [Compatibility](docs/COMPATIBILITY.md) holds the dated host detail.

## Common questions

### How do I stop Playwright MCP leaving Chrome running?

Install the pack and run Playwright MCP with `--isolated`. The close check, session sweep and idle timer close the browsers the package can prove it owns, and `npx browser-control-layer cleanup --apply` does the same on demand. `npx browser-control-layer doctor` shows what is running first.

### Why does browser automation use so many tokens?

Each step makes your AI re-read its whole conversation, so a job costs its steps times its context. The skill lowers both: read a page as text with `npx browser-control-layer read <url>`, batch predictable steps, and hand clicks to a fresh runner. `npx browser-control-layer meter` shows your own re-read share.

### How do I close idle headless Chrome sessions automatically?

The idle timer starts when a session stops and closes owned browsers idle past the limit; [DEFAULTS](docs/DEFAULTS.md) holds the value and its source. `npx browser-control-layer reap --idle` runs the same sweep by hand, and your own scheduler can run it on a timer.

### Does it keep my own Chrome profile untouched?

Yes. The pick check refuses a launch that points at Chrome's default profile directory, and the package sends no signal to it, opens or closes no tab in it and reads no file from it. Anything the package cannot prove it owns, `doctor` reports and leaves running.

### Does it work with Codex, Cursor or Gemini CLI?

Yes. Each host loads the skill from its own project path and runs every command from its terminal. Claude Code runs the hooks natively, and other hosts use the same checks as commands: see Works with whatever your AI has above.

### How do I use a remote browser to save memory?

Point Chrome DevTools MCP at your own Cloudflare Browser Run account and give the session the shortest keep-alive that covers your longest step. The [playbook](skills/browser-control-layer/playbooks/remote-browser.md) has the recipe, and `npx browser-control-layer doctor --remote` lists sessions read-only when `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` are in your environment.

## Uninstall

`npx browser-control-layer uninstall --dry-run` shows what would go. `npx browser-control-layer uninstall` removes the files the install wrote, only where you have not edited them, and restores integration files to their original bytes from the install receipt in `.browser-control-layer/`. A project with no receipt is left as it is. Details: [Installer](docs/INSTALLER.md).

## Read next

- [Method](docs/METHOD.md): why stage checklists with gate codes help.
- [Hygiene](docs/HYGIENE.md): ownership, profile classes and the closing rules.
- [Hooks](docs/HOOKS.md): each hook, its event and its contract.
- [Reader](docs/READER.md): the `read` fetch order, URL policy and screen labels.
- [Meter](docs/METER.md): what `meter` reads and how to interpret its share.
- [Benchmark](docs/BENCHMARK.md), [Results](docs/RESULTS.md) and [Defaults](docs/DEFAULTS.md): the suites, the recorded rows and every setting with its source.
- [Drivers](docs/DRIVERS.md), [Compatibility](docs/COMPATIBILITY.md) and [Installer](docs/INSTALLER.md): how the method runs on each driver and host.
- [Security model](docs/SECURITY-MODEL.md) and [Evaluation](docs/EVALUATION.md): what the package protects and how it is tested.
- [Provenance](docs/PROVENANCE.md): where each idea comes from.
- [Roadmap](docs/ROADMAP.md) and [Changelog](CHANGELOG.md): what each version adds.

## For agents

[llms.txt](llms.txt) links the reference docs. [AGENTS.md](AGENTS.md) is the contributor build guide, and [SKILL.md](skills/browser-control-layer/SKILL.md) is the skill your AI follows.

## Contributing

Useful work to bring: a driver recipe, a host trial with its version and date, a fixture page for the benchmark, a docs fix, or a failure with steps to reproduce on a reserved example domain. Start with [CONTRIBUTING.md](CONTRIBUTING.md); outside contributors sign the [CLA](CLA.md). Report vulnerabilities through [private reporting](SECURITY.md).

<!-- credits:start -->
## Credits

Every project below is credited with its licence. The pack copies no upstream code; it takes ideas, techniques and documented behavior, and it links the vendor's own pages. [Provenance](docs/PROVENANCE.md) maps each idea to a file.

- [trycua/cua](https://github.com/trycua/cua) (MIT): action ladder, effect statuses, background-first, idle expiry, browser and profile fixed at launch, batch steps.
- [browser-use/jev-ultrafast](https://github.com/browser-use/jev-ultrafast) (MIT): indexed actions, atomic snapshot, freshness, hit-test (techniques only).
- [cloudflare/agents](https://github.com/cloudflare/agents) (MIT): session modes and sweep, app-owned browser, restarted flag, web fetch URL policy.
- [cloudflare/cloudflare-docs](https://github.com/cloudflare/cloudflare-docs) (CC-BY-4.0): Browser Run idle timeout, keep-alive, close reasons and the MCP-client recipe, attributed.
- [MirzaMotoTech/agent-browser-hygiene](https://github.com/MirzaMotoTech/agent-browser-hygiene) (MIT): a read-only audit kept apart from apply, dry run by default.
- [rtk-ai/rtk](https://github.com/rtk-ai/rtk) (Apache-2.0): the output economy idea and an opt-in companion.
- [microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp) (Apache-2.0): benchmark driver and profile classes from its documented paths.
- [ChromeDevTools/chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp) (Apache-2.0): benchmark driver and the remote browser recipe.
- [vercel-labs/agent-browser](https://github.com/vercel-labs/agent-browser) (Apache-2.0): benchmark driver and the `batch` command as prior art.
- [puppeteer/puppeteer](https://github.com/puppeteer/puppeteer) (Apache-2.0): the benchmark launch script.
- [unclecode/crawl4ai](https://github.com/unclecode/crawl4ai) (Apache-2.0): an optional reader in the fetch order.
- [aunysillyme/website-build-skill](https://github.com/aunysillyme/website-build-skill) (MIT): repo template, gates and installer pattern.
<!-- credits:end -->

## License

MIT, copyright Auny LLC and contributors. See [LICENSE](LICENSE).
