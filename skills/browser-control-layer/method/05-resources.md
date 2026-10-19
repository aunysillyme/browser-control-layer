# Resources: keep CPU and RAM low

Eleven practices. Each rests on a shipped default or a dated vendor document. The value behind every cap lives in `references/defaults.md`, which the package generates from its own bench rows; a value without a row there is a pending default, and you read it as a suggestion. Watch the result with `top`, `doctor` and `reap --budget`.

1. **Read as text first.** `read <url>` opens no browser at all. See `playbooks/fetch-order.md`.
2. **Isolated or temporary profile for every job.** Playwright MCP's `--isolated` keeps the profile in memory, while its default stores a persistent profile with logins (microsoft/playwright-mcp README, read 2026-10-18). The user's own profile is never used.
3. **One browser per run, tabs for parallel pages.** Bench row R2 holds the comparison.
4. **Headless shell for headless runs.** Bench row R1 compares it with new headless and headed.
5. **Block images, media and fonts on read-only jobs.** Bench row R3.
6. **Wait for elements, never for time.** Bench row R4; snippets in `playbooks/wait-for-element.md`.
7. **Scoped field extraction over full page text or screenshots.** Bench row R5; `playbooks/scoped-extraction.md`.
8. **Concurrency cap from cores and free memory.** Bench row R6 sets the knee. `doctor` prints your headroom, and `lease` checks it before it launches.
9. **Close or park idle tabs.** Bench row R7 compares an idle tab, `about:blank` and a closed tab. The local idle limit starts at five minutes, after the trycua/cua docs (idle sessions end after five idle minutes, read 2026-10-18); `reap --idle` and the idle timer apply it.
10. **Close in finally; keep remote sessions short.** Give a remote session the shortest `keep_alive` that covers the longest step, close it explicitly, and read its close reason afterwards (`playbooks/remote-browser.md`). The token lives in the environment or the host's secret store, never in a committed config.
11. **End every report with the cleanup line** (`method/04-close-what-you-open.md`).

## Dated vendor figures

Source: Cloudflare Browser Run documentation, limits page and "Using with MCP clients (CDP)" page, read 2026-10-18 (cloudflare/cloudflare-docs, CC-BY-4.0).

| Item | Figure |
|---|---|
| Workers Free browser time | 10 browser minutes per day |
| Workers Free concurrent browsers | 3 |
| Idle browser timeout (default) | 60 seconds |
| Workers Paid concurrent browsers | 200 |
| Longest `keep_alive` | 20 minutes |
| `keep_alive` in the vendor's MCP example | 600000 ms (10 minutes) |

The vendor's example value can spend a whole Free-tier day on one idle session. The limits page names unclosed sessions as the usual cause of limit errors and recommends closing in a `try/finally`.

## Pending defaults

Wait cap per tab, repeat-navigate cap, empty-read cap, browsers and tabs per run, fan-out split, memory and sustained-CPU caps per owned group, and the SIGTERM grace period come from bench rows. Read them in `references/defaults.md`; the loop caps are enforced by `playbooks/stop-rules.md`.
