# Verify and report

## A claim is not proof

A runner's DONE is a claim. The main session checks it against the page, a saved read or the submission log before it reports success (gate VF01). A tool that returns `ok` proves the call ran; it says nothing about whether the page changed (trycua/cua makes the same point).

## Effect statuses

Every action in the report carries an `effect` that comes from looking again after the action:

- `confirmed`: a fresh observation shows the change the action was meant to make.
- `no-change`: a fresh observation shows the page as before.
- `partial`: part of the intended change appears.
- `unknown`: no fresh observation followed.

An action is not complete until its effect is `confirmed`. An `unknown` effect is a to-do: observe, then set the status. Statuses follow the effect idea in trycua/cua (gate VF02).

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
