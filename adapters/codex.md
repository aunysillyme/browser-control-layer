# Codex

Codex reads the skill from the shared agent-skills path. Gemini via Antigravity CLI reads the same path, so one install serves both.

## Where it lives

- **Skill folder:** `.agents/skills/browser-control-layer/` in your project. `npx browser-control-layer` copies it there after one confirm.
- **Instruction file:** if your setup uses `AGENTS.md`, the block in [agents-md.md](agents-md.md) points the AI at the folder.
- **Commands:** `read`, `doctor`, `cleanup`, `reap`, `top`, `lease` and `meter` run from the terminal Codex uses. `meter` reads Claude Code transcripts, and a Codex format reader follows a trial with a real Codex transcript.
- **Runner:** `runners/aun-runner-browser.template.md` is plain text your AI can follow as the brief for a fresh session.

## Hooks

Native hook loading on this host is awaiting a real-client trial. The check below confirms the result on yours. Until then the same protection comes from the commands: end each job with `cleanup --session --apply`, and run `reap --idle` from your own scheduler if you want a recurring sweep.

## Check that it loaded

1. Ask the AI to read `.agents/skills/browser-control-layer/SKILL.md` and name its eight steps.
2. Run `npx browser-control-layer doctor` and read the browsers it lists.
3. Give it a short public-page job. The report should end with the cleanup line and `remaining=0`.
4. Note the host version and the date next to the result.
