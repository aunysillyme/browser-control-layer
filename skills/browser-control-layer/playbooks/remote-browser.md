# Remote browser

Run the browser on Cloudflare's machine, and your machine spends no memory on it (aun-edge). Use your own Cloudflare account and token; public pages only. Sources: Cloudflare Browser Run docs (limits, "Using with MCP clients (CDP)"), read 2026-10-18 at developers.cloudflare.com/browser-rendering, and cloudflare/agents `docs/agents/browse-the-web.md` (MIT).

## When this route fits

Route 5 of `checklists/route.md`: heavy pages, many parallel pages, or `doctor` reporting headroom below the floor.

## Recipe: Chrome DevTools MCP against Browser Run

Point `chrome-devtools-mcp` at the Browser Run DevTools endpoint with `--wsEndpoint`, and pass the token in `--wsHeaders` as a bearer header. The endpoint takes your account id in its path and a `keep_alive` query value in milliseconds. Take the exact form from the vendor page.

- Create the API token with the `Browser Rendering - Edit` permission.
- Keep the token in the environment (`CLOUDFLARE_API_TOKEN`) or the host's secret store. Account id: `CLOUDFLARE_ACCOUNT_ID`. A committed config never holds either.
- Set `keep_alive` to the shortest value that covers your longest step. The vendor's own example uses ten minutes, which on the Free plan can use the whole daily browser-time allowance on one idle session (`method/05-resources.md`, dated figures).

## Other ways to drive it

- **Code mode over CDP**: the Agents SDK runs a short program against the browser, which fits multi-step jobs in one call.
- **Quick Actions**: single-purpose calls for common jobs (a page's content, a screenshot). Use one when the job is exactly that.
- **Live View**: a link where the user watches or takes over the session. It is the clean hand-back for a bot check, a confirmation control or any step that needs a person.

## Session modes (cloudflare/agents)

`one-shot` opens and closes a session per job. `reuse` keeps one for a sequence. `dynamic` varies with load. Default to one-shot; see `method/04-close-what-you-open.md`.

## Close, then audit

1. Close the session in a `finally` block with an explicit close call.
2. Read the session's recorded close reason from session management afterwards. A reason other than your deliberate close means it ended on its own: idle, limit or error.
3. Record the closed session ids; the cleanup line counts them as `sessions=<closed>/<owned>`.

## Ownership

`doctor --remote` lists sessions read-only when `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` are in the environment. The package closes only session ids its ledger recorded. Sessions that belong to your other apps on the same account stay up, and the vendor's idle timeout closes the rest.

## Check

- CL04: sessions closed by recorded id, short `keep_alive`, close reason read.
