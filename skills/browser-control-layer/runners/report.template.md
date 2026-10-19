# Report

```text
Outcome: <DONE | HANDED BACK | STOPPED>: <one line>

Evidence:
- <field>: <value> (<url>)
- Saved read: <path> (<bytes>)

Actions:
| # | Action | Rung | Effect |
|---|---|---|---|
| 1 | <what was done> | <read | reference | script | position | hand back> | <confirmed | no-change | partial | unknown> |

Stop or hand-back: <rule that fired, what the page showed, what the user can do>

cleanup: browsers=<closed>/<owned> tabs=<closed>/<owned> sessions=<closed>/<owned> remaining=<n> checks=<ps|tabs|api>

Cost: <line from meter, when it ran>
```

## Fields

- **Effect** comes from a fresh observation after the action. An `ok` from a tool proves the call ran. `unknown` means no observation followed; observe, then set the status.
- **Rung** names the step of the action ladder (`playbooks/snapshot-refs.md`).
- **Cleanup line** comes last. Run {{CLEANUP_COMMAND}} first and copy its line. A probe that could not run prints `UNVERIFIED` in `checks`, and `remaining` above zero means the run is not clean.
- **Cost** appears when `meter` ran for this session.

## Reading a report

- DONE is a claim; verify it against the page or a saved read before you pass it on.
- A line with `remaining=0` and every check named is a clean close.
