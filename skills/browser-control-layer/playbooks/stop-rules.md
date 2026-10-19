# Stop rules

A loop that repeats itself costs steps and browser time and teaches nothing new. Stop rules end the loop and change the approach. A hook (aun-retry-guard) enforces four of them; the runner holds the rest.

## Loop stops (hook)

The hook blocks the next call and prints the reason when a counter passes its cap. Caps are in `references/defaults.md`.

| Counter | What it counts |
|---|---|
| Wait cap per tab | Waits on one tab without progress |
| Repeat-navigate cap | The same address opened again and again |
| Empty-read cap | Reads that returned nothing useful |
| Identical-error cap | The same error text repeated |

A fresh observation resets the counters. A new snapshot after a page change (`playbooks/snapshot-refs.md`) is the cheapest reset, because it replaces a guess with a look.

## When a stop fires

1. Read the message. It names the counter.
2. Look at the page once: a login wall, a bot check, a changed layout, a missing element, a slow network?
3. Change one thing: the selector, the step, the rung of the action ladder, or the route. Repeating the same input repeats the same result.
4. Hand back when the page needs a person.

## Runner stop rules (always)

- A login wall stops the run and hands back. Public pages only in this version.
- A bot check stops the run and hands back. Solving it is the user's decision.
- A control marked `data-agent-requires="human-confirmation"` stops the run and hands back with its label.
- A site rule that asks for less is followed (`method/06-profiles-and-site-rules.md`).
- A request that needs a secret typed into a page stops the run.
- A tool error that names a missing browser stops the run; the main session picks again.

## What a stop report holds

- The rule that fired, in the report's outcome line.
- What the page showed, in one sentence.
- What the user can do to continue.
- The cleanup line (`method/04-close-what-you-open.md`).

## Gate

CL01 covers the runner side: the stop was reported and its tabs were still recorded for cleanup.
