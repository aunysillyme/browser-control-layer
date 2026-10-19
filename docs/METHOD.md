# Method: why stage checklists with gate codes help

The skill runs a browser job as a short chain of stages: frame, route, pick, batch, run, read, verify, clean and report. Each stage has a checklist, and each line of a checklist has a gate code. This page explains why that shape helps an AI do the job and helps a person understand what happened afterwards.

## A stage holds one decision

A browser job mixes many decisions: which route, which profile, how to batch, when to stop, what to close. An AI that holds all of them at once drops some. A stage narrows the attention to one decision, so the AI loads only the file that decision needs and leaves the rest unread. That keeps the context small, which keeps every later step cheaper to read.

## A checklist makes the quiet steps visible

The steps most often skipped are the quiet ones: choosing a profile before the first action, looking again after an action, closing a tab nobody will miss. Nothing breaks loudly when they are skipped. A checklist names them in order, so the AI meets each one on purpose. Closing and verifying sit beside framing and routing, with equal standing.

## A gate code makes a failure attributable

Without a name, a bad run is a story: the page was slow, the batch was odd, the browser stayed open. With a code, the same run is a lookup. A leftover browser carries a clean-stage code. A claim nobody checked carries a verify-stage code. A report that ends without its cleanup line carries a report-stage code. The code points to a stage, the stage points to a file, and the file holds the fix. The fix then lands in one place and helps the next run.

## Codes let people and tools agree

A short code is something a person can say, a report can print and a test can check. The same label appears in the checklist, in the runner's report and in the package's tests, so a human reviewer, an AI and a script discuss one failure in one vocabulary.

## Checks fit the risk

A small, reversible job needs a light pass through the stages. A job that opens remote sessions or touches many pages earns every gate. Because each code is a one-line check, the AI scales the pass to the job instead of skipping the checklist or running all of it every time.

## A lean start

The method asks for a few steps and a clear order, and it begins work at once, with no menus, modes or questions up front. The AI frames the goal, follows the route table, and carries on. Install choices live in the README and the adapters, and the skill stays focused on the work.

## Evidence

The reasoning above is the case for the shape. The package backs its claims with its own benchmark rows, each with a date and a rerun command, and shows them in the README and in `RESULTS.md`. Measure your own setup with `meter` and the `bench` commands, and trust the numbers you produce.

## Where to read next

- `skills/browser-control-layer/checklists/run.md` lists the codes.
- `skills/browser-control-layer/method/` holds the seven topics the stages load.
- `docs/PROVENANCE.md` credits the ideas behind them.
