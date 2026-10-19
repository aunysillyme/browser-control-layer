# Batch first

One call that does five steps costs one re-read of the conversation. Five calls cost five. When the next steps are predictable, send them together (aun-web-use).

## What goes in a batch

- A sequence whose later steps do not depend on what an earlier step shows: navigate, wait for an element, act, read.
- The read that ends the sequence: one script that returns every field the job needs (`playbooks/scoped-extraction.md`).
- A wait on an element between steps, never a sleep (`playbooks/wait-for-element.md`).

## What stays out

- A step whose target depends on what the page shows after the previous action. Send the batch up to that point, observe, then batch again.
- Anything after a step that can change the page layout. Once a page changes, element references from before it may be stale: observe again (`playbooks/snapshot-refs.md`).

## Where batches exist

- Playwright MCP and Chrome DevTools MCP accept several operations per call on most hosts; check `references/drivers.md` for the form your driver uses.
- agent-browser has a `batch` command (vercel-labs/agent-browser, Apache-2.0).
- trycua/cua offers `run_steps`, a list of steps in one call (MIT). The idea carries over: a batch is a list of small steps run in order, and the result reports each step.

Prior art credit lives in `docs/PROVENANCE.md`.

## The brief carries the batch

`runners/brief.template.md` has fields for the step list and the single read. Fill them before the run starts, so the runner opens with a batch rather than discovering one.

## The batch reminder

A hook (aun-batch-nudge) watches for a streak of single actions from a browser tool and reminds the AI to batch the next steps. The reminder is advice; the AI decides.

## Check

- Gate PK01: a predictable sequence went out as one batch.
- Gate PK02: one read returned all fields.
- Gate PK03: the brief fits its size budget and names the done check and the stop rules.
