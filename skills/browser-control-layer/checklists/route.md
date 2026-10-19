# Route table

First match wins. Version one covers public pages. A login wall ends the run with a hand-back.

| Job | Capability class | Data |
|---|---|---|
| One known URL or a doc site | `read` (text first, no browser) | public |
| Several public static reads | One batched session of a second CLI agent the user has, or one runner batch | public |
| More public static reads than one session handles within the concurrency cap (`references/defaults.md`) | Parallel fan-out; every branch merged into one result, conflicts named | public |
| Public page needing clicks, scripts or a form | Fresh small runner on an isolated or throwaway profile | public |
| Heavy, parallel, or headroom below the floor | Remote browser on the user's own account | public |
| Framing, picking, verifying, reporting | The main session; it hands screen work to the runner | public |

## Reading the table

- Stop at the first row that fits. State it in one line (RT04).
- "Several" versus "more than one session handles" is the concurrency knee on this machine; `doctor` shows the headroom and `references/defaults.md` holds the value.
- Fan-out merges its branches into one result and names each conflict between them. A branch is never dropped silently.
- Reasons for each row: `method/02-route-by-job.md`.
