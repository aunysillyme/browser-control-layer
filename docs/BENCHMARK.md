# Benchmark

The benchmark separates package behavior from browser settings. Run a dry plan first, read the detected versions, and use a disposable browser environment for live runs. The package uses installed drivers and prints vendor install guidance when a pin is unavailable; it does not install them. Sources: [runner](../bench/run.mjs), [driver detection](../bench/detect.mjs), [driver catalog](../bench/drivers.json).

```text
npx browser-control-layer bench hygiene --dry-run
npx browser-control-layer bench hygiene
```

## Suites

<!-- generated:reference:start (sources: bench/scenarios.mjs, bench/cost.mjs) -->
| Suite | What it measures | Subject | Rerun |
|---|---|---|---|
| H hygiene | Owner interruption against baseline, sweep and lease arms; idle timer; run-created tabs; sentinel safety; hook and doctor overhead | `package` | `npx browser-control-layer bench hygiene --suite H` |
| R resources | Shell, headless and headed launch; tabs versus separate browsers; blocked media; sleeps versus element waits and loop-stop calibration; scoped fields versus text or screenshot; concurrency; idle, blank and closed tabs | `default` | `npx browser-control-layer bench hygiene --suite R` |
| S screen | aun-screen rules-provider recall on planted injection and false alarms on clean synthetic fixture pages, with fetched page hashes | `package` | `npx browser-control-layer bench hygiene --suite S` |
| Deterministic hygiene evaluation | Leased and unleased owner endings, idle close, resource-budget close and installed-hook paths | `package` | Included in H and the complete hygiene run |
| C cost | Tokenizer-measured main-context curve versus the installed fresh aun-runner; individual form actions versus the installed batch brief | Experiment records about the package | `npx browser-control-layer bench cost --harness codex --dry-run` |
| Paired task evaluation | Fixture-graded task success, safety, tool calls, tokens and owned leftovers, baseline against installed package | Experiment records about the package | `npx browser-control-layer bench e2 --harness codex --dry-run` |
<!-- generated:reference:end -->

Scenario definitions and measurements live in [bench/scenarios.mjs](../bench/scenarios.mjs) and [bench/run.mjs](../bench/run.mjs). The hygiene suite includes the deterministic evaluation before its comparison rows. Its overhead arm times browser hooks and doctor against a process inventory supplemented with synthetic entries; it is not a measurement of an arbitrary workstation. The screen corpus currently comes from the local [fixture server](../bench/server.mjs), rather than a web-wide corpus.

Live cost and paired-task runs require `--model <id> --driver <name@version>`, print a spend preview and ask before calling a host. Cost runs require `--harness-command <absolute-executable>` for exact context instrumentation; Claude Code uses that external adapter route for paired tasks too. The estimate comes from optional `--estimated-usd-per-run <amount>` and is informational. See [evaluation design](EVALUATION.md) and the [instrumented harness contract](../evals/e2/README.md).

## Row contract

[bench/schema/result.schema.json](../bench/schema/result.schema.json) defines published benchmark rows; [validateRow](../bench/run.mjs) checks their runtime shape.

<!-- generated:reference:start (source: bench/schema/result.schema.json) -->
| Fields | Meaning |
|---|---|
| `id`, `subject`, `claim`, `unit` | Scenario identity, `package` or `default`, measured claim and unit |
| `n`, `median`, `p25`, `p75` | Sample count, median and interpolated quartiles |
| `arms`, `ratio` | Per-arm aggregates and the second-to-first median ratio when defined |
| `measured_at`, `expires_at` | Measurement time and freshness boundary |
| `machine` | Operating system, CPU description and RAM |
| `versions` | Node, Chrome, driver, harness and model conditions |
| `command` | Reproduction command |
| `raw.path`, `raw.sha256` | Raw JSONL location and its SHA binding |
<!-- generated:reference:end -->

The hygiene writer retains `raw.jsonl`, `raw.sha256` and `results.json` in its output directory. `--out <directory>` chooses that directory; `--n <count>` controls repeated resource measurements. Owner-ending and idle cases follow their own evaluation matrix. Failed scenarios remain in raw evidence and are excluded from summary rows. Runtime paths are normalized before hashing. Sources: [writer and argument handling](../bench/run.mjs), [aggregation](../bench/scenarios.mjs).

## Publication and freshness

Only current `package` rows render into public proof blocks. Resource rows explain defaults in [DEFAULTS.md](DEFAULTS.md). A local aun-meter report describes its user's transcript and stays separate from proof. Expired proof warns and is omitted from generated blocks; it does not block a check or release. Paired experiment summaries require review and row binding before publication: the experiment runner does not add them to `proof/results.json`. Sources: [proof renderer](../src/build/pack.mjs), [gates](../src/build/validate.mjs), [experiment writer](../bench/cost.mjs).

## Execution and evidence

Real-browser, network and loopback jobs run through [browser.yml](../.github/workflows/browser.yml). It includes the baseline invalidation probe, lifecycle and sentinel checks, hygiene/resource/screen runs, deterministic outcomes and reader transport integration. Local unit tests use fake process and filesystem adapters. A successful unit test establishes its contract, while a live browser claim needs the matching saved browser receipt.

For a checkout, run `node scripts/check.mjs` and `node --test`. These do not replace live host loading or a live browser evaluation. Use [RESULTS.md](RESULTS.md) for bound rows and [host-gate.md](evaluation/host-gate.md) for host activation evidence. Nothing schedules paid experiments; live experiment resources close in a `finally` block. Sources: [workflow](../.github/workflows/browser.yml), [experiment lifetime](../bench/cost.mjs), [deterministic lifetime](../evals/e1/run.mjs).
