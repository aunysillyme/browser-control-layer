# Claude Code

Claude Code is the first-class host: the plugin carries the skill, the runner and the hooks.

## Where it lives

- **Plugin (recommended):** the repository root holds `.claude-plugin/`, `hooks/hooks.json` and `agents/aun-runner-browser.md`. The plugin loads the skill from `skills/browser-control-layer/`, registers the hooks and offers the runner.
- **Marketplace setup:** `claude plugin marketplace add https://github.com/aunysillyme/browser-control-layer`, then `claude plugin install browser-control-layer@browser-control-layer`.
- **Files only:** `npx browser-control-layer` copies the skill folder to `.claude/skills/browser-control-layer/` in your project after one confirm, and writes project-scoped hooks with a backup of any file it edits.
- **Commands:** `read`, `doctor`, `cleanup`, `reap`, `top`, `lease` and `meter` run from any terminal.

## Hooks

Through the plugin these run on Claude Code events:

- A stamp after each browser tool call, so idle time is measured per session.
- The loop stop (aun-retry-guard), the batch reminder (aun-batch-nudge) and the pick check (aun-pick-guard) around browser tools and known CLI drivers.
- The cleanup hooks (aun-cleanup): the close check on Stop and SubagentStop, the session sweep on SessionStart, UserPromptSubmit and SessionEnd, and the idle timer started by Stop.

Hooks match browser tools only: MCP browser tools plus Bash commands that start with a known CLI driver.

## Check that it loaded

1. Ask Claude Code to read `skills/browser-control-layer/SKILL.md` and name its eight steps.
2. Run `npx browser-control-layer doctor`. It prints the automation browsers running now and changes nothing.
3. Give it a short public-page job. At stop, the close check blocks once if a tab it opened is still open, then passes after the tab closes.
4. The report ends with the cleanup line.

Sources: [skills](https://code.claude.com/docs/en/skills) and [plugins](https://code.claude.com/docs/en/plugins).
