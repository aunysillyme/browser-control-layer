# Paired browser evaluations

Run `bench e2 --harness codex --n 6 --dry-run` through the package CLI to inspect the plan. A live run also requires `--model <id> --driver <name@version>`. The command prints its run count and a spend preview and asks once before starting. Supply `--estimated-usd-per-run <amount>` from your own provider pricing; an omitted price is shown as UNVERIFIED. This estimate is informational, not a billing cap.

The native Codex adapter invokes the already installed `codex exec`, reads JSON events and grades task results against the local fixture server. Install and configure the browser driver in your host first. The native adapter records unavailable package-loading, global-instruction-isolation and process-ownership evidence as UNVERIFIED, so its runs cannot produce a published claim. It does not read a personal transcript or install a driver.

Each pair uses fresh project directories and the same model and driver. The package arm installs the skill and generated runner through the package installer. Arm order alternates between repetitions. The fixture server supplies public synthetic pages and records submissions, beacon requests and confirmation presses. The grader requires the task page to have been visited before either safety task can pass. Regression results remain in the raw run summary. The server closes in a finally block after either success or failure; nothing watches this directory.

## Instrumented harness

C2 needs exact tokenizer-measured context prefills, which native Codex usage events do not establish. C2 and C3 use `bench cost --harness codex --harness-command /absolute/path/to/your-adapter --model <id> --driver <name@version>`. Claude Code uses the same external adapter route for both suites. The package never starts a nested Claude Code session.

The supplied executable receives one JSON request on stdin and writes one JSON result on stdout. It receives no shell arguments. Request fields are `protocol`, `harness`, `model`, `driver`, `cwd`, `prompt`, `scenario`, `context_tokens`, `arm`, `repetition` and `requirements`. Keep model and driver identical across the pair. For C2, prefill both main conversations with exactly `context_tokens` tokenizer-measured synthetic neutral tokens; for the package arm hand the task to the installed fresh runner. For C3, compare one action per call with the installed brief's batch. A context-window rejection is a failed measurement, never a substitute curve point.

Return `protocol: 1`, the requested `harness`, `result` (the structured task answer), `elapsed_ms`, `loaded` (component loading evidence: `skill`, `hooks`, `runner` for the package arm, empty for baseline), `versions` (`harness`, `model_id`, `driver`) and `metrics` (`tokens`, `tool_calls`, `prefill_tokens`, `owned_processes_left`, `ownership_verified`, `reread_share`). Counts are nonnegative integers; `reread_share` is a fraction or null. The adapter owns host startup and shutdown. Measure leftovers from its own process ownership records and package ledger after closing; set ownership_verified false when either probe is unavailable. Never infer zero leftovers from a missing probe. Keep secrets out of its output.

Files remain in the chosen `--output` directory: per-run raw output, SHA-256 bindings, append-updated `runs.jsonl`, and `summary.json`. These are experiment records, not automatically published proof rows. `claim_eligible` requires at least equal success, passing installed safety runs, verified zero owned leftovers, and lower tokens or tool calls. An unverified native run always keeps that flag false. The package does not promote meter output into proof.

## Verification

Run `node --test test/meter.test.mjs test/cost.test.mjs test/e2.test.mjs`. These tests use synthetic usage and fake host/server adapters only. Live host instrumentation, exact prefill feasibility, installed hook activation and browser-driver cleanup require a user-run receipt. No scheduled job runs paid host experiments.
