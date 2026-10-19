# Route by job

Pick the cheapest capability that does the job. The route comes from two facts: what the job needs (a text read, clicks, scale) and what the data is (public pages in this version). The table to apply is `checklists/route.md`; this page gives the reasons (aun-web-use).

## The six routes

1. **One known URL or a doc site.** `read <url>`. Pages that serve `llms.txt` or a Markdown twin come back as text, and no browser starts. Order and policy: `playbooks/fetch-order.md`.
2. **Several public static reads.** One batched session of a second CLI agent you already have, or one runner batch. One call carries all the URLs and all the questions.
3. **More static reads than one session handles.** Parallel fan-out. The split between route 2 and route 3 is the concurrency knee on your machine: `references/defaults.md` holds the value, and `doctor` shows your headroom. Merge every branch into one result and name each conflict between branches, so a branch is never dropped silently.
4. **A public page that needs clicks, scripts or a form.** A fresh small runner on an isolated or throwaway profile (`runners/aun-runner-browser.template.md`). Three or more actions go here.
5. **Heavy, parallel, or headroom below the floor.** A remote browser on your own account (`playbooks/remote-browser.md`). The memory is spent on the vendor's machine.
6. **Framing, picking, verifying, reporting.** The main session. It writes the brief, reads the result and checks it against the page. Screen work belongs to the runner.

## Why first match wins

The routes run from cheapest to most involved. A job that fits route 1 never needs a browser; a job that reaches route 4 has already ruled out text. Stating the matched route in one line before work starts (gate RT04) makes the choice reviewable.

## Reading the data class

Version one covers public pages. A page that asks for a login ends the run with a hand-back. The package and the skill leave logged-in browsing to a later version.

## Picking the browser

Route 4 and route 5 need a browser. The main session picks it once, before the runner starts, and writes the choice into the brief (`method/06-profiles-and-site-rules.md`). The runner executes inside that choice.
