# Indexed actions

Choose an index from a numbered list the page gave you. Never generate a selector from memory. This is the idea behind aun-index-runner, with techniques from browser-use/jev-ultrafast (MIT, techniques only, no code copied). The runner itself arrives in a later release; the concepts below work today as runner rules and brief fields.

## Choose an index

1. Take one snapshot of the interactive elements. Each gets an index.
2. Name the action by index: `click 14`, `type 7 "text"`.
3. Take the next snapshot after any action that can change the page.

An index points at a thing the page showed. A selector invented by the model points at a thing it hoped existed.

## One call per observation

Ask the operation and the target together, in one call, and consume only the matching answer. One observation that returns the snapshot and the chosen action avoids a second round trip (aun-jev packs questions the same way). Gate PK01 applies: a predictable sequence goes in one batch.

## The snapshot discipline

- **Atomic**: the snapshot is one moment of the page, taken at once.
- **Stable ids**: an index keeps its meaning until the next snapshot.
- **Freshness**: a snapshot older than the last page change is stale. Observe again (`playbooks/snapshot-refs.md`).
- **Hit-test**: before a click, confirm the element is visible and on top at its coordinates. A covered element means the click lands elsewhere.
- **Decide before acting**: read the snapshot, pick the index, then act. The decision is consumed once; a changed page needs a new decision.

## Process ownership comes with it

An indexed run starts its own throwaway profile with an owner file (aun-lease), so the run is closable by a sweep even if the AI stops early. See `method/04-close-what-you-open.md`.

## In the brief

Add three lines to `runners/brief.template.md`: the goal, the fields, the done check. The runner chooses indexes; it writes down each index it used and the effect it saw (`runners/report.template.md`).

## Verify

Indexed runs get the same independent check as any run: the main session confirms the result against the page (gate VF01).
