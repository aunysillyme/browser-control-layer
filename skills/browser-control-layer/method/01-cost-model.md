# Cost model

Each browser step makes the AI re-read its whole conversation. A job costs roughly its number of steps times the size of the context each step re-reads. Three levers lower it: fewer steps, a smaller context per step, a smaller output per step.

## Fewer steps

- Read a page as text with `read <url>` when no click is needed.
- Batch a predictable sequence into one call (`method/03-batch-first.md`).
- Ask for every field in one read (`playbooks/scoped-extraction.md`).

## A smaller context per step

- Hand three or more actions to a fresh small runner (`runners/aun-runner-browser.template.md`). A runner starts with only its brief, so each of its steps re-reads far less than the main session does. The longer the main conversation, the larger the gain.
- Keep the main session for framing, picking, verifying and reporting. It decides; the runner drives.

## A smaller output per step

Bounded view, rest by path (aun-keep): print the head of a long result, the path of the full copy and its byte count, then open the rest only when the job needs it.

- `read` follows this contract on every page it saves.
- `doctor --json` carries the full detail while the default view stays short.
- rtk-ai/rtk applies the same idea to shell output. It is an opt-in companion (aun-squeeze): the installer prints its official install command and leaves running it to you.
- Screenshots and full page text are the largest outputs; `playbooks/scoped-extraction.md` replaces both with named fields.

## Measure your own cost

- `meter` (aun-meter) reads your own Claude Code transcripts on your machine and reports the per-step re-read share. It keeps aggregates only. The number describes your setup, so it belongs to you and never becomes a benchmark row.
- `bench cost` runs one fixed task with the main context prefilled at three sizes, once with the main session driving and once with the package's runner. It prints the planned spend and asks first.
- `bench hygiene` and `bench e2` measure cleanup and task outcomes, with the skill and without it.
- Count a saving as real when your own `meter` or `bench` run shows it.
