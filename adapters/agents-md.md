# AGENTS.md

Any host that reads an `AGENTS.md` file can load the skill with a short block.

## Where it lives

1. Copy the skill folder into your project with `npx browser-control-layer`, which confirms once before it writes.
2. Add this block to your `AGENTS.md`:

```text
## Browser work
For any browser job on public pages, read skills/browser-control-layer/SKILL.md and follow its steps.
Load only the file the current step needs. End each job with the cleanup line.
```

3. The commands `read`, `doctor`, `cleanup`, `reap`, `top`, `lease` and `meter` run from the host's terminal.

## Hooks

Hook loading depends on the host. Where it is awaiting a real-client trial, the check below confirms it on yours, and the commands carry the cleanup: `cleanup --session --apply` at the end of a job, plus an optional recurring `reap --idle` from your own scheduler.

## Check that it loaded

1. Ask the AI which file it read for browser work and to name the eight steps.
2. Run `npx browser-control-layer doctor`.
3. Give it a short public-page job and confirm the report ends with the cleanup line.
4. Note the host and version next to the result.
