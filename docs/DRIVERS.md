# Driver method

The skill teaches aun-runner to use the browser tools your AI already has. Aun-cleanup adds process attribution and cleanup where live identity matches a recorded pinned recipe. Aun-lease supplies an explicit ownership path for commands that accept its profile placeholder. The source of driver pins is [bench/drivers.json](../bench/drivers.json); the matching rules are in [src/hygiene/recipes.mjs](../src/hygiene/recipes.mjs).

## Catalog snapshot

<!-- generated:drivers:start -->
Catalog snapshot: 2026-10-19. Generated from `bench/drivers.json`; verification label: `CI_PENDING`. Catalog recipe ownership flags are false. These pins and declared variants describe the test catalog, not a completed live cleanup receipt.

| Driver | Package pin | Declared variant | Launch arguments | Profile class |
|---|---|---|---|---|
| [playwright-mcp](https://github.com/microsoft/playwright-mcp) | `@playwright/mcp@0.0.83` | `playwright-default` | `--headless` | `driver-persistent` |
| [playwright-mcp](https://github.com/microsoft/playwright-mcp) | `@playwright/mcp@0.0.83` | `playwright-isolated` | `--headless --isolated` | `throwaway` |
| [chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp) | `chrome-devtools-mcp@1.11.0` | `chrome-devtools` | `--headless` | `driver-persistent` |
| [agent-browser](https://github.com/vercel-labs/agent-browser) | `agent-browser@0.39.1` | `agent-browser` | `` | `throwaway` |

Browser harness: `puppeteer@25.14.0`. Catalog tools: `playwright@1.64.1`, `typescript@7.0.2`.
<!-- generated:drivers:end -->

The [generated skill reference](../skills/browser-control-layer/references/drivers.md) carries the catalog pins. Benchmark runs use installed tools and record the actual environment in their rows. Missing tools produce vendor install instructions through [bench/detect.mjs](../bench/detect.mjs), leaving installation to you. See [BENCHMARK.md](BENCHMARK.md).

## Shared method

Read text with [aun-read](READER.md) before launching a browser. For public pages that need interaction, give aun-runner a brief with the goal, chosen driver, fixed profile class, ordered actions and done check. Batch predictable steps, re-observe stale references, verify the effect independently, and close the run's tabs in finally. Follow the [runner template](../skills/browser-control-layer/runners/aun-runner-browser.template.md) and [snapshot reference playbook](../skills/browser-control-layer/playbooks/snapshot-refs.md).

Cleanup needs a session stamp, not just a familiar executable name. The stamp includes host identity, driver id and a supplied pinned driver version. [Discovery](../src/hygiene/sweep.mjs) requires a readable process inventory, an absolute profile argument, a matching recipe and attribution to that stamp. A version that does not match the recipe leaves the process outside recipe ownership.

## Playwright MCP

Use the MCP browser tools through the host. The hook adapter recognizes `browser_*` tools on the Playwright, Playwright MCP and browser server names. Prefer the isolated variant for public work; its declared profile class is throwaway. The default variant uses a driver-persistent profile, which cleanup keeps after closing a proven browser.

The current recipe derives its profile class from the catalog's first variant: the persistent default. It matches a profile whose final path is an `mcp-*` directory under `ms-playwright` or `ms-playwright-mcp`, together with its expected browser executable and automation flag. The isolated variant is launch guidance and a benchmark variant; this source does not construct a separate isolated-profile recipe from it. Use aun-lease where the actual command accepts the required profile placeholder, or rely on the driver's own close and report the cleanup evidence you obtained.

For ordinary attribution, the process tree must connect the browser through a matching driver command to the stamped host. If its recorded launching parent disappears, orphan cleanup can send SIGTERM to the proven browser root. Persistent profile data stays on disk.

## Chrome DevTools MCP

The hook adapter recognizes the Chrome DevTools MCP server's tools. The local recipe expects the pinned driver, its automation flag and a `chrome-profile` or `chrome-profile-stable` directory under `chrome-devtools-mcp`. Its declared profile class is driver-persistent, so directory cleanup keeps it.

Use fresh observations and a batch brief for the interactive work, then close the run's targets through the driver. Process cleanup follows the same stamped ancestry, identity and parent checks as the Playwright recipe. For a remote browser, follow [aun-edge](../skills/browser-control-layer/playbooks/remote-browser.md): the local profile recipe is separate from ledger ownership of a recorded remote session id. Live remote endpoint verification remains pending in [remote.mjs](../src/hygiene/remote.mjs).

## agent-browser

Call the CLI directly through the host's shell tool. The hook matcher recognizes a command starting with a catalogued CLI name, and reads its explicit `--session` when present. Use a distinct named session and retain that session choice for the run. The daemon's session environment can also supply the session stamped by the hook.

The browser may be a child of a daemon that outlives the AI host, so ordinary host ancestry is insufficient. [Daemon attribution](../src/proc/ancestry.mjs) requires the browser's readable parent to match the daemon executable rule, and that parent's own `AGENT_BROWSER_SESSION` to match a session stamped for the pinned driver. The recipe also requires the expected browser executable, automation flag, and an `agent-browser-*` or `playwright_chromiumdev_profile-*` throwaway profile directory.

[Ownership](../src/proc/owns.mjs) repeats the saved daemon identity and session checks. For an orphan, the recorded AI host must be gone or replaced; an active host is left alone by orphan cleanup. [Cleanup](../src/hygiene/cleanup.mjs) sends SIGTERM to the verified browser root, then checks the daemon again and runs its session-specific close command. An unreadable environment or different session keeps the browser outside this ownership path. Throwaway profile removal still requires the process and path checks in [SECURITY-MODEL.md](SECURITY-MODEL.md).

## Explicit leases

Use `npx browser-control-layer lease -- <command> --user-data-dir={profile}` only with a command that accepts that exact argument. [lease.mjs](../src/hygiene/lease.mjs) substitutes a private throwaway path, starts a detached process group, records identity and injects the run token and profile path into the child's environment. Verified group ownership is a separate path from a driver recipe. A command that cannot pass inspection returns an unverified recovery record rather than gaining signal permission from its process id.

Aun-lease requires the verified process-group adapter and refuses Windows. Read-only inspection and the other commands follow the platform adapters described in [COMPATIBILITY.md](COMPATIBILITY.md). Always finish with the checked [cleanup line](HYGIENE.md#read-the-cleanup-line).

## Verify on your setup

Start with `npx browser-control-layer doctor --json`, then run a small public fixture through your installed host and driver. Inspect the recorded driver version, profile class, session attribution and cleanup result. Use `cleanup --session <session>` to preview before applying. Rerun `npx browser-control-layer bench hygiene` on installed drivers for reproducible evidence; [RESULTS.md](RESULTS.md) contains generated package results rather than a promise inferred from a recipe.
