# Browser hygiene

Aun-cleanup [verifies ownership](../src/proc/owns.mjs) and [closes ledger resources](../src/hygiene/cleanup.mjs).

## Inspect, then close

Run `npx browser-control-layer <command>`:

| Command | Behavior |
|---|---|
| `doctor` / `doctor --json` | Read-only inventory, ownership and headroom; JSON returns the full report |
| `top --json` | Ledger runs with ownership, idle age, resource samples and budgets |
| `cleanup --session <session>` | Preview cleanup |
| `cleanup --session <session> --apply` | Apply after fresh ownership checks |
| `reap --orphans --dry-run` | Preview runs whose owner is gone |
| `reap --idle` / `reap --budget` | Apply idle or resource-budget cleanup |

`cleanup` defaults to preview; `reap` defaults to apply and accepts `--dry-run`. Bare `--session` uses `AUN_SESSION_KEY`; no filter considers all ledger runs. [CLI arguments](../src/hygiene/cli.mjs).

## Profiles and ownership

User/unrecognized resources are report-only. Persistent driver directories stay; verified roots close gracefully. Throwaway directories are removed only after verified exit and path checks.

[profiles.mjs](../src/hygiene/profiles.mjs) recognizes user paths lexically. Removal verifies the real path, quarantines the directory, checks inode/device and process use again. Refusals appear in action results.

`lease -- <command> --user-data-dir={profile}` requires matching owner file, token, path, group and start. Pinned recipes require executable/flags/profile; orphans need parent exit, idle needs expiry. Session cleanup can close active records. Recipes get root SIGTERM only. Daemons need a stamped session, rechecked before close. Remote cleanup uses recorded ids; hooks rely on vendor expiry. Unreadable ownership refuses signals. [Full rules](SECURITY-MODEL.md).

## macOS process verification

[darwin.mjs](../src/proc/platform/darwin.mjs) reads `ps` identity/state. `-Eww` environment replies must name exactly the requested PID. Tokenless helpers need ancestry to the token-verified root. Conflicting tokens or live unreadable identities refuse group signals; zombies need none.

Node drivers need absolute entry scripts or the pinned title with `ucomm=node` and a first `lsof` text mapping to Node's real path. PID/start/user/parent/group and title must stay fixed across reads. Failed inspection refuses attribution. Version/profile/automation and stamped ancestry/session remain required. Owner exit needs a missing PID or changed start.

[signals.mjs](../src/proc/signals.mjs) rechecks ownership before signals, refreshes inventory and drops departed helpers. macOS inspects arrivals once; further arrivals, replacements or failed reads refuse the group. Linux refuses arrivals. Survivors are rechecked after environment reads.

macOS waits through TERM grace. Sent TERM plus fresh proof permit leased-group KILL and exit grace. Survivors, including zombies, keep cleanup incomplete and profiles intact; `remainingMembers` lists identities/reasons. [Grace evidence](DEFAULTS.md).

Dumps include member reasons and E1 command classification, excluding environments/tokens. Check: `node --test`; CI: [browser.yml](../.github/workflows/browser.yml). Nothing separately monitors recipes.

## Activity and triggers

[Ledger](../src/hygiene/ledger.mjs): owner-only identity/activity/budget/tab/remote records, locked atomic writes, symlink refusal. Roots: `$XDG_STATE_HOME/browser-control-layer` (Linux; fallback `~/.local/state/browser-control-layer`), `~/Library/Application Support/browser-control-layer` (macOS), `%LOCALAPPDATA%/browser-control-layer` (Windows).

Stamps renew matching session/host/driver records and leases. CLI: `AUN_SESSION_KEY`, `AUN_HOST_PID`, `AUN_DRIVER_ID`, `AUN_DRIVER_VERSION`. [Sweeps](../src/hygiene/sweep.mjs) without context report only.

| Trigger | Invocation chain |
|---|---|
| Browser completion or failure | Stamp, then discover attributable roots |
| `SessionStart` | Reap orphaned runs, then idle runs |
| `UserPromptSubmit` | Discover, then reap idle runs |
| `Stop` / `SubagentStop` | Idle sweep, close check, then timer while local runs remain |
| `SessionEnd` | Cancel timer, apply session cleanup |
| CLI metadata or `read` | Quick sweep with session context |
| Applying `cleanup` or `reap` | Discover session runs, then apply |
| `lease` | Sweep, launch, clean on exit or interruption |

[Hooks](../src/hooks/session-sweep.mjs), [stamp](../src/hooks/stamp.mjs) and [CLI](../src/cli.mjs) carry triggers. Close check blocks once for resources or unverified state; stamps reset it.

## Idle and resource budgets

[Idle expiry](../src/hygiene/idle.mjs) uses activity/lease renewal. The [timer](../src/hygiene/idle-timer.mjs) waits for its deadline and verified registration, checks generation/token, reaps locally, clears its record and exits. Pending registration gets bounded waits, then exits without reaping. Stamps cancel verified timers. Check: `node --test test/linux-idle.test.mjs`. Scheduled `reap --idle` is opt-in.

[Settings](../src/hygiene/defaults.json) need [evidence](DEFAULTS.md); null stays pending. [Headroom](../src/hygiene/headroom.mjs) needs thresholds; [budgets](../src/hygiene/budget.mjs) need finite caps and CPU window/samples. `top` has no monitor. Leases measure groups; recipes measure roots.

[Resource practices](../skills/browser-control-layer/method/05-resources.md) cover batching, isolated profiles, finally-close and measured limits.

## Read the cleanup line

`cleanup: browsers=<closed>/<owned> tabs=<closed>/<owned> sessions=<closed>/<owned> remaining=<n> checks=<ps|tabs|api>`

`checks` lists passed probes. Missing probes and incomplete `remaining` print `UNVERIFIED`. Tabs need an injected probe. Remaining resources or unverified state exit 3. Repair the action reason and rerun scoped cleanup.
