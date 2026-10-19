# Browser hygiene

Use aun-cleanup to inspect browser resources, close the resources the ledger proves belong to a run, and report the checks that actually ran. Use aun-lease when you want an explicit process group and a throwaway profile. The implementation lives in [src/hygiene/](../src/hygiene/) and the ownership boundary in [src/proc/owns.mjs](../src/proc/owns.mjs).

## Inspect, then close

| Command | Behavior |
|---|---|
| `npx browser-control-layer doctor` | Read-only browser inventory, ownership status and headroom policy |
| `npx browser-control-layer doctor --json` | Full browser inventory report, including RSS and CPU fields |
| `npx browser-control-layer top --json` | Ledger runs with ownership, idle age, resource samples and budget status |
| `npx browser-control-layer cleanup --session <session>` | Preview cleanup for the named session |
| `npx browser-control-layer cleanup --session <session> --apply` | Apply cleanup after fresh ownership checks |
| `npx browser-control-layer reap --orphans --dry-run` | Preview resources whose recorded owner is gone |
| `npx browser-control-layer reap --idle` | Apply idle cleanup |
| `npx browser-control-layer reap --budget` | Apply cleanup to eligible runs exceeding a configured resource budget |

`cleanup` previews by default. `reap` applies by default, and accepts `--dry-run`. Supplying `--session` without an explicit value uses `AUN_SESSION_KEY`; it requires a session context. Omitting the session filter lets cleanup consider the ledger's recorded runs. Read [src/hygiene/cli.mjs](../src/hygiene/cli.mjs) for accepted arguments.

## Profile classes

| Class | Process handling | Directory handling |
|---|---|---|
| User profile or unrecognized profile | Report only | Kept |
| `driver-persistent` | Close a verified browser root gracefully | Kept |
| `throwaway` | Close a verified root or leased group | Remove only after process inventory and path checks prove it is unused |

[profiles.mjs](../src/hygiene/profiles.mjs) recognizes default user profile paths lexically. [cleanup.mjs](../src/hygiene/cleanup.mjs) checks a throwaway directory's real path, moves it to a quarantine path, verifies its inode and device, and checks process use again before deletion. A refused check leaves the directory visible in the action result.

## Ownership classes

- **Leased:** aun-lease creates a private run directory, owner file, run token, exact profile path and detached process group. Ownership requires those records to agree with the live process. Use `lease -- <command> --user-data-dir={profile}` with a command that accepts that exact placeholder argument.
- **Recipe orphan:** the browser matches a pinned driver recipe and its recorded launching parent is gone. Cleanup sends SIGTERM to the browser root.
- **Idle or session run:** the browser matches its recorded recipe and process identity; idle cleanup also requires expired activity. Explicit session cleanup can close a recorded active run.
- **Daemon session:** agent-browser attribution requires its daemon's own `AGENT_BROWSER_SESSION` to match a session the host stamped. For orphan cleanup, the AI host being gone establishes owner exit even if the daemon remains. Cleanup sends SIGTERM to the verified browser root, then invokes that daemon's close command for the recorded session after checking its identity and environment again.
- **Remote:** aun-edge closes only remote session ids recorded in a remote ledger row. Local hooks and sweeps leave remote cleanup to explicit calls and the vendor's expiry.

See [SECURITY-MODEL.md](SECURITY-MODEL.md) and [DRIVERS.md](DRIVERS.md). The ownership check runs again immediately before a browser signal; unreadable state is a reason to report, never permission to signal.

On macOS, [darwin.mjs](../src/proc/platform/darwin.mjs) reads the process table with `ps` and requests environments with explicit `-Eww`. Each environment response must contain exactly the requested PID. The root's token, exact profile path, process group and saved start identity must agree with its owner file. Helpers with unreadable environments qualify only through ancestry to that token-verified root; a conflicting token refuses the group. Linux uses its existing `/proc` adapter.

Run `node --test test/darwin.test.mjs` to verify this boundary with fake process and filesystem adapters, including application paths with spaces, helper ancestry, environment refusal, PID reuse and a surviving sentinel. Real browser lifecycle and wrong-kill verification run through `browser.yml` in CI. No separate watcher monitors this adapter.

## Activity and triggers

The ledger stores run identity, profile class, host and parent identity, driver version, last activity, optional budgets, tabs and remote session ids. Its root follows the platform state location: `$XDG_STATE_HOME/browser-control-layer` or `~/.local/state/browser-control-layer` on Linux, `~/Library/Application Support/browser-control-layer` on macOS, and `%LOCALAPPDATA%/browser-control-layer` on Windows. [ledger.mjs](../src/hygiene/ledger.mjs) validates owner-only state directories and files, rejects symlinks and uses locked atomic updates.

A browser tool stamp renews only records with the same session, host identity and driver id. It also renews a leased run's activity. The CLI can stamp through `AUN_SESSION_KEY`, `AUN_HOST_PID`, `AUN_DRIVER_ID` and `AUN_DRIVER_VERSION`; a quick sweep without session context reports only. See [sweep.mjs](../src/hygiene/sweep.mjs).

| Trigger | Local action |
|---|---|
| Browser tool completion or failure | Stamp activity and discover attributable browser roots |
| `SessionStart` | Reap orphaned ledger runs, then sweep idle runs for this session |
| `UserPromptSubmit` | Discover and reap this session's idle runs |
| `Stop` | Idle sweep, close check, then schedule an idle timer while local runs remain |
| `SubagentStop` | Idle reap, close check, then schedule an idle timer while local runs remain |
| `SessionEnd` | Cancel the session timer and apply session cleanup |
| CLI metadata or `read` | Quick sweep when a session context is available |
| Applying `cleanup` or `reap` | Discover current session runs before applying the selected operation |
| `lease` | Quick sweep before launch, cleanup when the child exits or the lease receives interruption |

[session-sweep.mjs](../src/hooks/session-sweep.mjs), [stamp.mjs](../src/hooks/stamp.mjs), [src/cli.mjs](../src/cli.mjs) and [src/hygiene/cli.mjs](../src/hygiene/cli.mjs) define these triggers. The close check blocks a stop once while recorded resources remain or verification is incomplete; the next browser stamp resets that block state.

## Idle timer and resource budgets

[Idle expiry](../src/hygiene/idle.mjs) uses the last activity stamp, or a lease renewal when available. The local default and its dated source are in [DEFAULTS.md](DEFAULTS.md). The [idle timer](../src/hygiene/idle-timer.mjs) reserves a timer per session, sleeps to its deadline, checks the activity generation and token, runs local idle cleanup, then clears its timer record and exits. A new stamp cancels a matching timer after fresh identity checks.

You can arrange `npx browser-control-layer reap --idle` in your own scheduler. Scheduling remains opt-in; the installer prints the command rather than scheduling it.

Resource policies follow [defaults.json](../src/hygiene/defaults.json). RSS, sustained CPU, headroom thresholds and signal grace remain pending where their values are null. [headroom.mjs](../src/hygiene/headroom.mjs) reports `UNSET` until explicit thresholds are supplied. [budget.mjs](../src/hygiene/budget.mjs) enforces finite caps; sustained CPU also needs a configured observation window and sufficient history. `top` reports these samples; it does not create a background resource monitor. Leased groups aggregate group members, while recipe runs measure the recorded browser root.

## Keep CPU and memory use bounded

Use [aun-read](READER.md) before opening a browser for text. Batch predictable actions through aun-runner, extract the needed fields, wait for elements, and close tabs and sessions in finally. Prefer isolated profiles for public jobs. Choose browser and tab concurrency from measurements, and use the shortest remote keep-alive that covers the job. The [resource method](../skills/browser-control-layer/method/05-resources.md) connects each practice to its source or pending benchmark row.

## Read the cleanup line

`cleanup: browsers=<closed>/<owned> tabs=<closed>/<owned> sessions=<closed>/<owned> remaining=<n> checks=<ps|tabs|api>`

`checks` lists successful probes. A count whose probe did not run says `UNVERIFIED`; incomplete process, tab or remote verification also makes `remaining` unverified. Tab verification requires an injected tab probe, so the CLI can report an unverified tab count even when process cleanup succeeds. An applied cleanup with remaining resources or incomplete verification returns the incomplete-result exit status. The implementation and exact result fields are in [cleanup.mjs](../src/hygiene/cleanup.mjs).
