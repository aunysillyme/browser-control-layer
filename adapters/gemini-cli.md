# Gemini CLI

Gemini CLI loads the skill as text from its project context.

## Where it lives

- **Skill folder:** copy `skills/browser-control-layer/` into your project with `npx browser-control-layer`, or place it in the project skills folder your Gemini CLI version reads.
- **Context file:** add this block to `GEMINI.md`:

```text
For browser work on public pages, read skills/browser-control-layer/SKILL.md first and follow its steps. End each browser job with the cleanup line.
```

- **Commands:** `read`, `doctor`, `cleanup`, `reap`, `top`, `lease` and `meter` run from the terminal Gemini CLI uses.
- **Antigravity CLI:** it shares the `.agents/skills/browser-control-layer/` path described in [codex.md](codex.md).

## Hooks

Native hook loading on this host is awaiting a real-client trial. The check below confirms the result on yours. Meanwhile the commands carry the cleanup: `cleanup --session --apply` at the end of a job, and an optional recurring `reap --idle` from your own scheduler.

## Check that it loaded

1. Ask Gemini CLI which file it read for browser work and to name the eight steps of SKILL.md.
2. Run `npx browser-control-layer doctor`.
3. Give it a short public-page job and confirm the report ends with the cleanup line.
4. Note the host version and the date next to the result.
