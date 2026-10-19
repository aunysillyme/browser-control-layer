# Browser hooks

The plugin wires aun-pick-guard, aun-retry-guard, aun-batch-nudge and aun-cleanup through [hooks/hooks.json](../hooks/hooks.json). The dispatcher reads a host event from standard input and prints the host's JSON response. Use the [compatibility checks](COMPATIBILITY.md) to confirm loading in your client.

## Events and actions

| Event | Matcher | Hook and behavior |
|---|---|---|
| `PreToolUse` | Browser tools below | aun-pick-guard checks the launch choice, then aun-retry-guard checks retry counters. aun-cleanup delivers a pending idle-close notice. A refused choice or exceeded active cap denies the tool call. |
| `PostToolUse` | Browser tools below | aun-cleanup stamps activity and discovers attributable browser runs. aun-retry-guard updates observation counters, aun-batch-nudge updates the single-step streak, and aun-cleanup delivers a pending notice. |
| `PostToolUseFailure` | Browser tools below | The same post-call path records the failure and updates counters and activity. |
| `SessionStart` | Session event | aun-cleanup reaps local recipe orphans across sessions, then checks idle resources in this session. |
| `UserPromptSubmit` | Session event | aun-cleanup checks idle local resources and delivers a pending notice. |
| `Stop` | Session event | aun-cleanup checks idle resources, runs the close check, and starts a self-exiting idle timer when local resources remain recorded for the session. |
| `SubagentStop` | Session event | aun-cleanup reaps idle resources, checks the subagent's own records, and starts its idle timer when needed. |
| `SessionEnd` | Session event | aun-cleanup cancels the session timer and applies session cleanup. The event returns an empty response rather than blocking exit. |

Source: [dispatcher](../src/hooks/cli.mjs), [session sweep and timer scheduling](../src/hooks/session-sweep.mjs), [close check](../src/hooks/close-check.mjs).

## Browser tool matching

The plugin matcher accepts Playwright MCP `browser_` tools under the `playwright`, `playwright-mcp`, `playwright_mcp` or `browser` server names; Chrome DevTools MCP tools under the corresponding hyphenated or underscored server names; and `Bash`. The dispatcher then filters Bash calls using the installed CLI command names in [bench/drivers.json](../bench/drivers.json). Other tools return before ledger or process access.

A CLI browser command must start directly with a known driver executable, optionally with a path. The aun-pick-guard parser accepts quoted arguments and refuses shell expansions, command operators, redirects and multiline commands. Wrapping the command with another executable does not identify it as a browser command. See [event normalization and command parsing](../src/hooks/_event.mjs).

## Launch choice and retry checks

Aun-pick-guard requires an isolated profile or a declared absolute throwaway path outside the user's browser directory. It refuses attachment options, persistent profile selections, conflicting paths and changes to the recorded driver, browser, driver session or profile. A configured MCP launch choice can come from `AUN_BROWSER_CHOICES`; explicit unsafe tool arguments still get checked. See [pick-check.mjs](../src/hooks/pick-check.mjs).

Aun-retry-guard keeps per-driver, per-tab counters for waits, repeated navigation to the same target, empty reads and identical failures of the same action. A useful fresh read resets wait and navigation counters. Aun-batch-nudge resets its streak after a batch action or a steps array containing multiple steps. Their caps come from [the defaults source](../src/hygiene/defaults.json); unset caps collect counters without enforcing a threshold or emitting a streak reminder. See [loop-stop.mjs](../src/hooks/loop-stop.mjs) and [batch-reminder.mjs](../src/hooks/batch-reminder.mjs).

## Activity, cleanup and notices

Aun-cleanup stamps only an inspectable host identity, using a supplied host PID or a Claude Code ancestor. Activity is keyed by host and driver; daemon-backed drivers also carry the selected driver session. A successful stamp resets the close-check latch and discovers browser ancestry before launching parents can exit. An unverified host produces an `UNVERIFIED` context message. See [stamp.mjs](../src/hooks/stamp.mjs).

The close check inspects active records for the stopping session with a cleanup dry run. It blocks once when resources remain or verification is incomplete, prints the recorded run/browser/tab list and cleanup line, then allows the next stop. An active stop-hook flag also bypasses the repeat block. Subagent keys include the parent session and agent identity, so the check uses the subagent's records. See [close-check.mjs](../src/hooks/close-check.mjs) and [event keys](../src/hooks/_event.mjs).

An idle-close notice is consumed once. It reports whether temporary profile state is gone and asks for a fresh observation or state check before continuing. Hooks force local cleanup with `allowRemote: false`; remote cleanup uses the explicit CLI path described in [HYGIENE.md](HYGIENE.md). See [idle-notice.mjs](../src/hooks/idle-notice.mjs) and [session-sweep.mjs](../src/hooks/session-sweep.mjs).

## Failure reporting and verification

Aun-cleanup reports hook input or state errors using a safe error code and `UNVERIFIED`, without echoing the raw payload. Pre-call errors deny the browser call; session-end errors go to standard error; other events receive context. The command accepts `pre`, `post`, `failure`, `stop`, `subagent-stop`, `start`, `prompt` and `end` as event selectors. See [hook entry point](../src/hooks/cli.mjs).

Run `node --test test/hooks.test.mjs` for synthetic payload contracts, refusing cases and allowed controls. [The fixtures](../test/fixtures/hooks/contracts.json) identify their synthetic provenance; a real-client loading receipt is recorded separately through the [host gate](evaluation/host-gate.md).
