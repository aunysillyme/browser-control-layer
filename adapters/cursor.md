# Cursor

Cursor loads the skill through a project rule that points at the skill folder.

## Where it lives

- **Skill folder:** `npx browser-control-layer` copies `skills/browser-control-layer/` into your project after one confirm.
- **Rule file:** create `.cursor/rules/browser-control-layer.mdc` with this content:

```text
---
description: Browser work on public pages: route the job, batch steps, use a fresh runner, close what you open
alwaysApply: false
---
Read skills/browser-control-layer/SKILL.md and follow its steps for any browser job. End each job with the cleanup line.
```

- **Commands:** `read`, `doctor`, `cleanup`, `reap`, `top`, `lease` and `meter` run from Cursor's terminal.

## Hooks

Native hook loading on this host is awaiting a real-client trial. The check below confirms the result on yours. The commands carry the cleanup in the meantime: `cleanup --session --apply` at the end of a job, plus an optional recurring `reap --idle` from your own scheduler.

## Check that it loaded

1. Ask Cursor's agent to read SKILL.md through the rule and name its eight steps.
2. Run `npx browser-control-layer doctor` in the terminal.
3. Give it a short public-page job and confirm the report ends with the cleanup line.
4. Note the host version and the date next to the result.
