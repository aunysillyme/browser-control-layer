# Verify and report

## A claim is not proof

A runner's DONE is a claim. The main session checks it against the page, a saved read or the submission log before it reports success (gate VF01). A tool that returns `ok` proves the call ran; it says nothing about whether the page changed (trycua/cua makes the same point).

## Effect statuses

Every action in the report carries an `effect` based on the available evidence:

- `confirmed`: a fresh observation shows the change the action was meant to make.
- `partial`: part of the intended change appears.
- `unverifiable`: available evidence cannot establish the action's effect.
- `suspected_noop`: the action ran, but a fresh observation suggests no change.
- `refused`: the action was declined or blocked before execution.

Only `confirmed` plus a passing postcondition check counts as done. For `unverifiable`, seek a fresh observation and update the status when evidence is available. Statuses use the vocabulary from [trycua/cua](https://github.com/trycua/cua) (gate VF02).

## What the evidence looks like

- Extracted values: the exact fields, with the URL they came from.
- A state change: the element or text that appeared, from a fresh read.
- A form: the confirmation text on the page, or the log the user's side can show.
- A saved read: its path and byte count (`playbooks/fetch-order.md`).

## Report shape

`runners/report.template.md` carries the fields:

1. Outcome in one line.
2. Evidence.
3. Actions with their `effect`.
4. The cleanup line (`method/04-close-what-you-open.md`).
5. A cost line from `meter` when it ran.

A report that ends without the cleanup line is unfinished (gate VF03). A probe that did not run prints `UNVERIFIED` in that line.

## When verification fails

- Re-observe once and compare. A page that settled late explains many mismatches.
- Re-run the failed step with a different method, per `playbooks/stop-rules.md`.
- Report the gap plainly: what was claimed, what the page showed, what remains.
