# Roadmap

This release teaches your AI browser work on public pages, in isolated or throwaway profiles, and leaves your own Chrome profile untouched. Each later version below says what it adds and the gate that ships it. A version ships when its gate passes, and a gate that passes is recorded with its date and a rerun command.

## Next: version 1.1

| Adds | Ships when |
|---|---|
| **`meter` reads Codex transcripts.** The per-step re-read share works on Codex sessions as it does on Claude Code sessions today | A receipt from a real Codex transcript confirms the field layout the reader expects |
| **More screen providers for `read`.** [StackOneHQ/defender](https://github.com/StackOneHQ/defender) installed by you, and a hosted screening service with your own key, sit beside the built-in `rules` and `command` providers | Each provider has screen rows measured on the same corpus of planted and clean pages |
| **A Cloudflare Agents Worker template.** A ready Worker that runs a remote browser on your own account with a short keep-alive and a close-reason audit. It lives outside the npm package | One live receipt from a test account |
| **The Claude Code arm of the with-and-without benchmark.** `bench e2` records Claude Code runs next to the Codex runs | A real Claude Code session run with a spend preview first, published with its raw logs |

## Version 1.2

| Adds | Ships when |
|---|---|
| **aun-index-runner as an optional runner.** A runner that chooses an index from the page's own numbered list, with its own throwaway profile and owner file. The concepts already ship in this release as [indexed actions](../skills/browser-control-layer/playbooks/indexed-actions.md), and the runner turns them into one agent you can hand a job to | It beats the template runner on the with-and-without benchmark at equal or better success on public synthetic fixtures |

## Later: logged-in browsing

| Adds | Ships when |
|---|---|
| **Logged-in browsing through a launch-time grant.** You name the origins, an expiry and an idle limit before the run starts, and the grant is read once per session. It brings a granted-browser route, tab rules for a granted browser and aun-chrome guidance | The maintainers bring it in, and its grant tests plus the benchmark's safety tasks pass on a logged-in fixture |

Until then every run works on public pages, and a login wall stops the run and hands back to you.

## Version 2: native app control

| Adds | Ships when |
|---|---|
| **Native app control as aun-desk-use.** Native wrappers, a desktop aun-runner and the native tools of [trycua/cua](https://github.com/trycua/cua)'s `cua-driver`, with the same close-what-you-open contract. A Windows `lease` joins the hygiene commands | Native cleanup is measured on a real machine first |

## Defaults fill in as rows land

[DEFAULTS](DEFAULTS.md) lists every setting with its source. A setting gets its value when its benchmark row is recorded, and a refreshed row replaces an expired one. The hooks that depend on a setting pick it up in the release that records it.
