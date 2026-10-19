# Snapshot references and the action ladder

A snapshot gives each element a reference. References are valid for the snapshot that produced them. This page covers the ladder to climb when an action is needed and the rule for stale references. Ideas from trycua/cua (MIT), adapted to browsers.

## Action ladder

Start at the lowest rung that does the job. Climb only when the rung below failed, and say which rung you used.

1. **Read it as text.** `read <url>` or a scoped extraction. Nothing is touched.
2. **Act on a reference.** Click or type through a snapshot reference or index. This is element-targeted and works in a background tab.
3. **Act through the page.** Run a short script that sets a value or triggers the control, when the reference route has no handle (for example a custom widget).
4. **Act by position.** Click at coordinates after a hit-test. Use it when nothing above works.
5. **Hand back.** Ask the user to do the step on a visible window.

Background-first: prefer rungs that work without bringing a window forward or taking over the user's pointer.

## Escalation

- A rung that returns `suspected_noop` earns one retry at most, with a fresh observation in between.
- Move up one rung at a time. Record each move in the report.
- Rung 5 is a normal ending for a step that needs the user's hands (a payment form, a confirmation control, a bot check).

## Re-observe on stale references

After any action that can change the page, the old references may no longer point where they did. Treat them as stale:

- Navigation, a submitted form, a dialog, an expanded section, an infinite-scroll load.
- An error that names a missing or detached element.

Take a new snapshot and choose again. The loop stop hook (aun-retry-guard) counts a fresh read as a reset, so re-observing is the cheapest way to leave a loop (`playbooks/stop-rules.md`).

## Batches and references

Within a batch, refer to an element by a reference only for steps that cannot change the page. After a step that can, end the batch and observe (`method/03-batch-first.md`).

## Effects

Each action gets an `effect` based on the available evidence; use `unverifiable` when the effect cannot be established (`method/07-verify-and-report.md`).
