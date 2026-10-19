# Read public pages as data

Aun-read retrieves text from a public URL, wraps it as untrusted content, saves the complete result locally and prints a bounded JSON view. Aun-screen adds an explicit screening status. These are fresh package implementations; [PROVENANCE.md](PROVENANCE.md) records the upstream concepts.

```sh
npx browser-control-layer read https://example.com
npx browser-control-layer read https://example.com --screen rules
npx browser-control-layer read https://example.com --output ./page.txt
```

## Fetch order

The reader validates the requested URL, then fetches `/llms.txt`, `/docs/llms.txt` and `/.well-known/ai-instructions.json` concurrently from that origin. It next tries a `.md` form of the requested path, followed by the original URL. An existing `.md` or `.markdown` path is used directly. A non-retryable HTTP failure advances to the next candidate; policy failures, retryable failures and other retrieval errors stop the attempt. See [fetch-order.mjs](../src/read/fetch-order.mjs) and [sidecars.mjs](../src/read/sidecars.mjs).

The transport requests uncompressed text and accepts text responses plus the listed JSON and XML content types. It checks each redirect and enforces response-byte, request-time and redirect ceilings. [transport.mjs](../src/read/transport.mjs) is the source for those ceilings.

The current command reports route `pinned-http`. It probes whether `crwl` is executable on the user's path and reports `available-policy-unverified` or `absent`; it does not execute the crawler. See [the command](../src/read/cli.mjs) and [crawler detection](../src/read/fetch-order.mjs). For browser work, follow the [fetch-order playbook](../skills/browser-control-layer/playbooks/fetch-order.md).

## Public URL policy

The URL must be absolute HTTP or HTTPS with credentials omitted. Control characters and spaces are refused, fragments are stripped, and an HTTPS redirect must retain HTTPS. Local hostnames, private and reserved address ranges, and non-global address forms are refused. Each resolved address must pass the public-address check before the first address is pinned for the connection. See [url-policy.mjs](../src/read/url-policy.mjs).

Redirects repeat the validation and DNS checks. The pinned lookup supplies the validated address to the socket; the dispatcher checks the target origin, path and method, while TLS retains hostname verification. This binds the request to the checked destination rather than a fresh DNS lookup. See [transport.mjs](../src/read/transport.mjs).

## Wrapper, file and bounded view

The saved document contains a source URL, the page body and successfully retrieved sidecar content inside `<untrusted_web_content>` tags. A closer resembling the wrapper's closing tag is escaped inside the content. The displayed source URL drops its query string. Page and sidecar text remain data for the AI to inspect, including when a screen provider returns `clean`. See [reader command](../src/read/cli.mjs) and [wrap.mjs](../src/read/wrap.mjs).

Aun-keep's bounded-view contract appears as `head`, `path`, `bytes` and `truncated`, alongside `screen`, the full `screening` verdict, sidecar summaries, route and crawler availability. `--head-bytes` changes the preview budget within the command's accepted range. A truncated preview keeps the complete saved path available. See [save.mjs](../src/read/save.mjs) and [argument parsing](../src/read/cli.mjs).

By default the command chooses a unique temporary text file; `--output` selects a fresh destination. Saving creates an exclusive temporary file with owner read/write permissions, flushes it, and publishes the completed inode without overwriting an existing or racing destination. See [save.mjs](../src/read/save.mjs).

## Site sidecars

Aun-site-rules reports successful sidecar retrieval by path and byte length, or an optional retrieval failure by error code and `retryable`. Retrieved content is included in the untrusted wrapper. Ordinary missing or unavailable sidecars remain optional; an error outside the explicit optional-error set stops retrieval. Use site instructions only to tighten the run's existing rules, as taught in [profile and site rules](../skills/browser-control-layer/method/06-profiles-and-site-rules.md). See [sidecars.mjs](../src/read/sidecars.mjs).

## Screen providers

| Selection | Result |
|---|---|
| Default, or `--screen none` | `unscreened` with provider `none` and reason `provider_not_selected`. |
| `--screen rules` | Matches instruction overrides, role overrides and credential requests. A match returns `flagged`; an unmatched page returns `review` with `calibration_pending`. |
| `--screen command --screen-command /path/to/provider` | Sends the wrapped content to the selected executable's standard input with shell execution disabled and reads a JSON verdict from standard output. |

The command provider accepts `clean`, `review`, `flagged` or `unscreened` plus a bounded array of short reason identifiers. Missing providers, execution errors, unsuccessful exits, invalid responses, timeouts and excess output resolve to `unscreened`. Timeout or excess output terminates only the provider child created by that invocation and waits for it to close. See [screen/index.mjs](../src/read/screen/index.mjs), [rules.mjs](../src/read/screen/rules.mjs) and [command.mjs](../src/read/screen/command.mjs).

## Typed errors and checks

`ReadError` carries `code`, `retryable` and an exit classification. Usage errors identify incorrect arguments; URL and DNS errors identify policy or resolution failures; `FETCH_*` errors distinguish transport, response, redirect and body failures; `SAVE_*` errors identify destination and publication failures. Unknown retrieval failures become retryable `FETCH_FAILED` errors. The CLI prints the error code and message, includes `retryable` when present, and includes an available cause code. See [errors.mjs](../src/read/errors.mjs) and [CLI error output](../src/cli.mjs).

The [policy tests](../test/read-policy.test.mjs) and [output tests](../test/read-output.test.mjs) cover mocked policy, transport, wrapper, sidecar, save and screen behavior. Real loopback behavior runs separately through the browser workflow described in [BENCHMARK.md](BENCHMARK.md).
