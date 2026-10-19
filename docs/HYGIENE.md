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

User/unrecognized resources are report-only. Persistent directories stay. Throwaway removal needs verified exit, real path, quarantine, inode/device and process-use checks. [Path rules](../src/hygiene/profiles.mjs); [ownership rules](SECURITY-MODEL.md).

Leases need matching owner file/token/path/group/start. Recipes need executable/flags/profile plus parent exit or idle expiry; session cleanup can close active runs. Recipes get root TERM only. Daemons need a rechecked stamped session; remote closes use recorded ids. Unreadable ownership refuses signals.

## Process verification

[macOS inspection](../src/proc/platform/darwin.mjs) binds `ps` replies to kernel identities/state. Node drivers need absolute scripts or pinned titles verified with `ucomm` and `lsof`. Version, profile and stamped ancestry/session still apply. Unreadable identity refuses attribution.

[Group verification](../src/proc/signals.mjs): macOS/Linux require two matching live memberships within `GROUP_VERIFY_SNAPSHOTS = 6` inventories, including the first. Arrivals are inspected; final identities must match first observations. Roots need tokens; tokenless helpers need kernel ancestry to that root. Foreign tokens refuse, even after departure.

Positive `termGraceMs` caps retries after current reads/inspections. [Default grace](DEFAULTS.md) is unset; unset/zero uses the snapshot cap. Unstable groups refuse, dumping final members and marking membership changes `unstable`. All modes share TERM/KILL proof. Refused TERM prevents escalation; survivors are rechecked after environment reads.

macOS observes exit through each signal's grace. KILL needs sent TERM and fresh proof. Live/zombie survivors keep cleanup incomplete and profiles intact; `remainingMembers` lists them. Dumps omit tokens/environments. Check: `node --test`; CI: [browser.yml](../.github/workflows/browser.yml). Nothing separately monitors recipes.

## Activity and triggers

[Ledger](../src/hygiene/ledger.mjs): owner-only records, locked atomic writes, symlink refusal. Roots: `$XDG_STATE_HOME/browser-control-layer` (Linux; fallback `~/.local/state/browser-control-layer`), `~/Library/Application Support/browser-control-layer` (macOS), `%LOCALAPPDATA%/browser-control-layer` (Windows).

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

[Resource practices](../skills/browser-control-layer/method/05-resources.md).

## Read the cleanup line

`cleanup: browsers=<closed>/<owned> tabs=<closed>/<owned> sessions=<closed>/<owned> remaining=<n> checks=<ps|tabs|api>`

`checks` lists passed probes. Missing probes print `UNVERIFIED`; tabs need an injected probe. Leftovers/unverified state exit 3. Resolve the action reason, then rerun scoped cleanup.
