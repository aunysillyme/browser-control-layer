# Security model

Aun-cleanup acts on recorded identity and fresh ownership proof. A process name, an old process id or an unreadable process is insufficient. Browser work uses public pages and an isolated or throwaway profile; the user's own browser and profile stay untouched. Start with [HYGIENE.md](HYGIENE.md) for commands and [SECURITY.md](../SECURITY.md) for reporting a vulnerability.

## Process identity and ownership

[src/proc/owns.mjs](../src/proc/owns.mjs) compares the recorded process id, start time, executable and user id with a readable live process. It requires the observed absolute profile argument to equal the recorded path. The profile must be a real directory, resolve to its declared path, and sit outside recognized user profile roots.

| Ownership class | Additional proof | Permitted close |
|---|---|---|
| Leased throwaway | Owner file, run token from the process environment, exact profile path and a group led by the recorded process | SIGTERM to a verified group; SIGKILL escalation only for that leased throwaway group when a finite grace is configured |
| Recipe orphan | Pinned version, executable, automation flag, profile pattern and recorded launching parent gone | SIGTERM to the verified browser root |
| Idle session | Recipe proof, unchanged parent identity and expired activity | SIGTERM to the verified browser root |
| Explicit session cleanup | Recipe proof and a recorded session key | SIGTERM to the verified browser root |
| Budget cleanup | Recipe or lease proof and an exceeded eligible budget | Same signal boundary as that ownership class |
| Daemon-hosted session | Recorded daemon identity and its own environment matching a stamped driver session | SIGTERM to the browser root, then the driver's close command for that session |
| Remote session | Fresh remote ledger row containing the exact session id and matching session key | Vendor close request for that id |
| Unproven process | Report only | Kept |

[signals.mjs](../src/proc/signals.mjs) keeps inspection adjacent to signaling and repeats ownership proof immediately before a browser signal. Group verification checks live member identity and profile tokens; a helper without a readable token qualifies only through its ancestry to the verified root. If a leased leader exits first, recorded surviving members need their own persisted identity and fresh group and lease proof before SIGTERM.

For agent-browser, [ancestry.mjs](../src/proc/ancestry.mjs) reads only the daemon session environment fields needed for attribution. A matching `AGENT_BROWSER_SESSION` must appear among the sessions stamped for that host and pinned driver. [owns.mjs](../src/proc/owns.mjs) checks the daemon again; an unreadable environment, replaced daemon or different session refuses ownership. Orphan eligibility follows the recorded AI host, since the daemon can outlive it. [cleanup.mjs](../src/hygiene/cleanup.mjs) repeats daemon proof before invoking its recorded executable with the session-specific close arguments.

## Profile classes and deletion

[profiles.mjs](../src/hygiene/profiles.mjs) recognizes default Chrome and Chromium user-data paths by platform using lexical path checks. This check does not open a browser profile or enumerate the user's profile list. Unknown profile classification defaults to `user`.

- **User:** never signalled or deleted by browser cleanup.
- **Driver persistent:** a matching recorded browser may close gracefully; its profile directory is kept.
- **Throwaway:** deletion requires the browser to be gone, a verified process inventory showing the profile and group unused, a valid lease or recipe, and a real path outside user profile roots.

Before deleting a throwaway directory, [cleanup.mjs](../src/hygiene/cleanup.mjs) checks the parent's real path, renames the exact directory to quarantine, verifies its inode and device, and repeats the process-use check. A changed or uncertain path remains in quarantine or at its original location and appears in the action result.

## Signal boundaries

Aun-cleanup never signals by process name. Recipe-owned persistent browsers receive only a root SIGTERM. Group signals and SIGKILL are restricted to leased throwaway ownership; uncertain process identity, profile mismatch, missing owner proof, replaced parent or an unverified inventory stops the action. Zombie members are excluded from leased group signaling.

The package's own idle timer has a separate identity boundary in [idle-timer.mjs](../src/hygiene/idle-timer.mjs): cancellation checks the saved identity, exact timer script and random timer token, then checks them again before SIGTERM. A new browser stamp cannot cancel an unrelated reused process id.

The current signal adapter uses inspection followed by a signal, rather than an operating-system process handle. The source records that stronger handle binding would further narrow this boundary.

## State files

[ledger.mjs](../src/hygiene/ledger.mjs) requires real owner-only directories, a matching state marker, and owner-only regular files with a single link. It refuses symlinked path components and uses no-follow file opens. Writes use exclusive temporary files, file sync and rename under an exclusive lock. Run ids are validated before path construction; an update cannot change its run id.

The ledger records process and profile identity, activity, budgets, tabs and remote session ids. Keep it private. [aun-meter](METER.md) reads local transcripts and emits aggregates; its output describes the user's setup and is separate from published package proof.

## Remote ownership

[remote.mjs](../src/hygiene/remote.mjs) reads `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` from the environment. The token is a bearer header, not a URL parameter. `doctor --remote` lists sessions read-only and marks whether their ids appear in the ledger. A close rereads the ledger before sending a request; unrecorded ids are never closed.

After closing, the package lists remote sessions again to confirm absence. Missing credentials, unexpected or incomplete response shape, or a failed request yields `UNVERIFIED`. The source labels the endpoint as mocked verification with a live endpoint trial pending. Local hooks and the idle timer set remote access off; use an explicit remote cleanup and vendor expiry for that route.

## Page content and host hooks

[aun-read](READER.md) applies URL policy, wraps web text as untrusted content and labels screening results. Web text is data, never permission to change host behavior. The [profile and site rules](../skills/browser-control-layer/method/06-profiles-and-site-rules.md) keep browser choice fixed at launch and stop at a login wall or a human-confirmation control.

Browser hook matching comes from [src/hooks/_event.mjs](../src/hooks/_event.mjs) and [hooks/hooks.json](../hooks/hooks.json). Hooks operate locally with remote access disabled. [src/hooks/cli.mjs](../src/hooks/cli.mjs) converts unsafe payload or state errors to an unverified message; a pre-tool failure denies the action. Review [HOOKS.md](HOOKS.md) for event-specific behavior and [EVALUATION.md](EVALUATION.md) for the safety fixtures.
