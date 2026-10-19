# Browser hygiene

Use aun-cleanup to inspect and close ledger-owned resources. Use aun-lease for an explicit process group and throwaway profile. [owns.mjs](../src/proc/owns.mjs) defines ownership; [cleanup.mjs](../src/hygiene/cleanup.mjs) implements close and verification.

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

`cleanup` previews by default; `reap` applies by default and accepts `--dry-run`. A bare `--session` uses `AUN_SESSION_KEY`. Omitting the filter considers all ledger runs. [cli.mjs](../src/hygiene/cli.mjs) defines accepted arguments.

## Profiles and ownership

| Profile class | Process handling | Directory handling |
|---|---|---|
| User or unrecognized | Report only | Kept |
| `driver-persistent` | Graceful close of a verified root | Kept |
| `throwaway` | Close a verified root or leased group | Remove after verified exit and path checks |

[profiles.mjs](../src/hygiene/profiles.mjs) recognizes user profiles lexically. Removal verifies the real path, quarantines the exact directory, checks inode and device, and checks process use again. Refusal leaves the directory reported in the action result.

- **Leased:** `lease -- <command> --user-data-dir={profile}` creates a private run directory, owner file, token and detached group. Live token, profile, group and start identity must match.
- **Recipe orphan:** a pinned recipe matches executable, automation flags and profile pattern; its recorded launching parent is gone. Cleanup sends root SIGTERM only.
- **Idle or session:** a recorded recipe and identity match. Idle also requires expired activity; explicit session cleanup can close active records.
- **Daemon:** agent-browser's daemon environment must name a session the host stamped. Host exit establishes orphan eligibility. Cleanup sends root SIGTERM, then checks daemon identity and session again before invoking its recorded-session close command.
- **Remote:** aun-edge closes only ids in remote ledger rows through explicit calls. Local hooks leave remote expiry to the vendor.

Ownership is rechecked immediately before signals. Unreadable state authorizes no signal. See [SECURITY-MODEL.md](SECURITY-MODEL.md) and [DRIVERS.md](DRIVERS.md).

## macOS process verification

[darwin.mjs](../src/proc/platform/darwin.mjs) reads `ps` identity and kernel state. `-Eww` environment responses must name exactly the requested PID. Tokenless helpers require ancestry to the token-verified root. Conflicting tokens and live unreadable identities refuse a group signal; zombies need no signal.

Driver attribution uses an absolute entry script, including extensionless `.bin` entries. Recognized non-evaluating Node switches may precede it. Process titles, JSON and paths in other arguments establish no ownership. Version, profile, automation and stamped ancestry or daemon session checks still apply. Owner exit requires a missing PID or changed start time. Linux retains its `/proc` adapter, attribution and timing.

[signals.mjs](../src/proc/signals.mjs) refreshes inventory after inspection and omits departed helpers. macOS inspects arrivals once, then refreshes again. Further arrivals, replacements or failed inventory refuse the group. Linux refuses new arrivals. Survivor signals recheck identity after environment inspection.

macOS cleanup observes the whole leased group during the configured TERM grace. A sent TERM and fresh leased-group proof permit KILL; exit observation then uses at most the same grace. Any remaining row, including a zombie awaiting reap, keeps cleanup incomplete and the profile intact. `remainingMembers` reports PID, parent, group, state and inspection reason. The shipped grace stays unset pending its [DEFAULTS.md](DEFAULTS.md) binding.

Dumps retain member verdicts and reasons without environments or token values. E1 also records command classification. Fake verification: `node --test test/darwin.test.mjs test/darwin-recipes.test.mjs test/darwin-exit.test.mjs test/group-races.test.mjs test/group-diagnostics.test.mjs`. These cover spaced paths, attribution, races, timing, refusals and sentinel survival. [browser.yml](../.github/workflows/browser.yml) checks real lifecycle, E1 and H4 in CI. No separate watcher monitors recipes.

## Activity and triggers

[ledger.mjs](../src/hygiene/ledger.mjs) stores identities, ownership, activity, budgets, tabs and remote ids in owner-only directories and files, using locked atomic updates and symlink refusal. State roots: `$XDG_STATE_HOME/browser-control-layer` (Linux, falling back to `~/.local/state/browser-control-layer`), `~/Library/Application Support/browser-control-layer` (macOS), `%LOCALAPPDATA%/browser-control-layer` (Windows).

Browser stamps renew records matching session, host identity and driver id, including leased activity. The CLI accepts `AUN_SESSION_KEY`, `AUN_HOST_PID`, `AUN_DRIVER_ID` and `AUN_DRIVER_VERSION`. A sweep without session context reports only. [sweep.mjs](../src/hygiene/sweep.mjs) handles discovery and reap.

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

[Session hooks](../src/hooks/session-sweep.mjs), [stamp](../src/hooks/stamp.mjs) and [CLI](../src/cli.mjs) carry these triggers. The close check blocks a stop once while resources remain or verification is incomplete; a browser stamp resets it.

## Idle and resource budgets

[Idle expiry](../src/hygiene/idle.mjs) uses activity or lease renewal. The [timer](../src/hygiene/idle-timer.mjs) sleeps to its deadline, checks generation and token, reaps locally, clears its record and exits. New stamps cancel it after identity checks. Scheduling `npx browser-control-layer reap --idle` remains opt-in.

[defaults.json](../src/hygiene/defaults.json) and [DEFAULTS.md](DEFAULTS.md) bind settings to evidence. Null settings stay pending. [Headroom](../src/hygiene/headroom.mjs) reports `UNSET` until explicit thresholds exist. [Budgets](../src/hygiene/budget.mjs) require finite caps; sustained CPU also requires a window and sufficient samples. `top` reports samples without starting a monitor. Leases aggregate group members; recipes measure the root.

Use [aun-read](READER.md) for text, batch actions through aun-runner, extract needed fields, wait for elements, and close resources in finally. Use isolated profiles, measure concurrency and choose the shortest remote keep-alive covering the job. The [resource method](../skills/browser-control-layer/method/05-resources.md) cites each practice's evidence.

## Read the cleanup line

`cleanup: browsers=<closed>/<owned> tabs=<closed>/<owned> sessions=<closed>/<owned> remaining=<n> checks=<ps|tabs|api>`

`checks` lists successful probes. Missing probes print `UNVERIFIED`; incomplete verification also marks `remaining` unverified. Tabs need an injected probe. Applied cleanup with remaining resources or incomplete verification exits 3. Inspect action reasons, repair the named ownership or inspection failure, then rerun the scoped cleanup. Real-browser verification runs through CI.
