# Provenance

Where each idea in the pack comes from, the file that carries it, and how you use it. Our own tools and concepts carry aun- names; upstream projects carry their real names and links. Credit details are in `CREDITS.md`.

## Concepts

| Concept | From | Shipped file | Usable as |
|---|---|---|---|
| Choose an index, never generate a selector | aun-index-runner; technique credit [browser-use/jev-ultrafast](https://github.com/browser-use/jev-ultrafast) | `skills/browser-control-layer/playbooks/indexed-actions.md` | Runner rule; brief field (the runner itself arrives in a later release) |
| One call per observation: operation and target asked together, only the matching answer consumed | aun-index-runner, aun-jev | `skills/browser-control-layer/playbooks/indexed-actions.md` | Brief field; runner rule |
| One atomic snapshot, stable ids, freshness, hit-test, decision consumed before acting | aun-index-runner; technique credit [browser-use/jev-ultrafast](https://github.com/browser-use/jev-ultrafast) | `skills/browser-control-layer/playbooks/indexed-actions.md` | Runner rule |
| Own throwaway profile, process group, owner files, sweep on start | aun-lease | `skills/browser-control-layer/method/04-close-what-you-open.md` | `lease` command; `reap --orphans` |
| Tighten-only site rules, human-confirmation stop | aun-site-rules | `skills/browser-control-layer/method/06-profiles-and-site-rules.md` | `read` sidecar report; runner stop rule; evaluation task |
| Action ladder with escalation, background-first | [trycua/cua](https://github.com/trycua/cua) | `skills/browser-control-layer/playbooks/snapshot-refs.md` | Runner rule |
| Effect statuses; a tool's ok is not evidence | [trycua/cua](https://github.com/trycua/cua) | `skills/browser-control-layer/method/07-verify-and-report.md` | Report template `effect` field |
| Re-observe on stale references | [trycua/cua](https://github.com/trycua/cua) | `skills/browser-control-layer/playbooks/snapshot-refs.md` | Runner rule; the loop stop hook counts it as a fresh read |
| Batch steps in one call | [trycua/cua](https://github.com/trycua/cua), [vercel-labs/agent-browser](https://github.com/vercel-labs/agent-browser) | `skills/browser-control-layer/method/03-batch-first.md` | Brief template; runner rule |
| Idle session expiry | [trycua/cua](https://github.com/trycua/cua) | `skills/browser-control-layer/method/05-resources.md` | `reap --idle` default; idle timer hook |
| Browser and profile fixed at launch | [trycua/cua](https://github.com/trycua/cua) | `skills/browser-control-layer/method/06-profiles-and-site-rules.md` | Pick check hook reads the run's browser choice once per session |
| One-shot, reuse and dynamic session modes; host sweep on a schedule | [cloudflare/agents](https://github.com/cloudflare/agents) | `skills/browser-control-layer/method/04-close-what-you-open.md` | Ledger `kind`; `reap` is the local sweep; idle timer hook |
| App owns the browser; the model never closes it | [cloudflare/agents](https://github.com/cloudflare/agents) | `skills/browser-control-layer/method/04-close-what-you-open.md` | Close check and session sweep hooks do the closing |
| Restarted flag after an idle close | [cloudflare/agents](https://github.com/cloudflare/agents) | `skills/browser-control-layer/method/04-close-what-you-open.md` | Idle close notice hook |
| `web_fetch` URL policy, untrusted wrapper, typed errors | [cloudflare/agents](https://github.com/cloudflare/agents) | `skills/browser-control-layer/playbooks/fetch-order.md` | `read` command |
| Code mode over CDP, Quick Actions, Live View, close-reason audit, short `keep_alive` | [cloudflare/agents](https://github.com/cloudflare/agents), [cloudflare/cloudflare-docs](https://github.com/cloudflare/cloudflare-docs) (Browser Run); recipe as aun-edge | `skills/browser-control-layer/playbooks/remote-browser.md` | Remote browser recipe; `doctor --remote` |
| Host re-read cost, fresh small runner | aun-meter, aun-runner | `skills/browser-control-layer/method/01-cost-model.md` | `meter` command; runner template |
| Bounded view, rest by path | aun-keep; [rtk-ai/rtk](https://github.com/rtk-ai/rtk) as companion (aun-squeeze) | `skills/browser-control-layer/method/01-cost-model.md` | `read` output contract; `doctor --json`; companion line in the installer |
| Batch first | aun-web-use, aun-batch-nudge | `skills/browser-control-layer/method/03-batch-first.md` | Brief template; batch reminder hook |
| Route by job and data class | aun-web-use | `skills/browser-control-layer/method/02-route-by-job.md` | `checklists/route.md` table |
| Main picks, runner executes | aun-pick-guard | `skills/browser-control-layer/method/06-profiles-and-site-rules.md` | Pick check hook |
| Loop stops that block | aun-retry-guard | `skills/browser-control-layer/playbooks/stop-rules.md` | Loop stop hook |
| Fetch order, text before browser | aun-read | `skills/browser-control-layer/playbooks/fetch-order.md` | `read` command |
| Screen, fetched text is data, `unscreened` as the honest default | aun-screen | `skills/browser-control-layer/method/06-profiles-and-site-rules.md` | `read` screen providers |
| Cleanup contract with a checked line | aun-cleanup | `skills/browser-control-layer/method/04-close-what-you-open.md` | `cleanup` output; close check hook |
| Isolated or throwaway profile for every job; the user's own profile untouched | aun-lease; [microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp) | `skills/browser-control-layer/method/05-resources.md`, `skills/browser-control-layer/method/06-profiles-and-site-rules.md` | Profile classes in `reap`; pick check hook; runner rule |
| Measure your own cost | aun-meter | `skills/browser-control-layer/method/01-cost-model.md` | `meter` and `bench cost` commands |

## Upstream

Every project below is credited in the README and in `CREDITS.md`. Licences were read from each project's GitHub page on the date shown. The pack copies no upstream code; it takes ideas, techniques and documented behavior, and it links the recipes to the vendor's pages.

| Project | Licence | Checked | What we took |
|---|---|---|---|
| [trycua/cua](https://github.com/trycua/cua) | MIT | 2026-10-18 | Action ladder, effect statuses, background-first, idle expiry, browser and profile fixed at launch, batch steps |
| [browser-use/jev-ultrafast](https://github.com/browser-use/jev-ultrafast) | MIT | 2026-10-18 | Indexed actions, atomic snapshot, freshness, hit-test (techniques only, no code copied) |
| [cloudflare/agents](https://github.com/cloudflare/agents) | MIT | 2026-10-18 | Session modes and sweep, app-owned browser, restarted flag, `web_fetch` URL policy and wrapper |
| [cloudflare/cloudflare-docs](https://github.com/cloudflare/cloudflare-docs) (Browser Run) | CC-BY-4.0 | 2026-10-18 | Idle timeout, `keep_alive`, close reasons, limits, MCP-client recipe (documentation, attributed) |
| [MirzaMotoTech/agent-browser-hygiene](https://github.com/MirzaMotoTech/agent-browser-hygiene) | MIT | 2026-10-18 | Read-only audit kept apart from apply; dry run by default |
| [rtk-ai/rtk](https://github.com/rtk-ai/rtk) | Apache-2.0 | 2026-10-18 | Output economy idea; opt-in companion |
| [microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp) | Apache-2.0 | 2026-10-18 | Benchmark driver; profile classes from its documented paths |
| [ChromeDevTools/chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp) | Apache-2.0 | 2026-10-18 | Benchmark driver; remote-browser recipe |
| [vercel-labs/agent-browser](https://github.com/vercel-labs/agent-browser) | Apache-2.0 | 2026-10-18 | Benchmark driver; the `batch` command as prior art |
| [puppeteer/puppeteer](https://github.com/puppeteer/puppeteer) | Apache-2.0 | 2026-10-18 | Benchmark launch script; headless shell in CI |
| [unclecode/crawl4ai](https://github.com/unclecode/crawl4ai) | Apache-2.0 | 2026-10-18 | Optional reader in the fetch order (the vendor's own install command) |
| [aunysillyme/website-build-skill](https://github.com/aunysillyme/website-build-skill) | MIT | 2026-10-18 | Repo template, gates, installer pattern |

A later release adds [StackOneHQ/defender](https://github.com/StackOneHQ/defender) as a screen provider, credited here when it ships.
