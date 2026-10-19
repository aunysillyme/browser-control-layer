# Measure local re-read share

Aun-meter reads the user's Claude Code transcript files locally and emits token aggregates. It measures cache-observed repeated input in that selected setup. Its report is a local measurement, and never becomes a package proof row. See [the adapter](../src/meter/claude-code.mjs), [report implementation](../src/meter/report.mjs) and [benchmark claim rules](BENCHMARK.md).

```sh
npx browser-control-layer meter
npx browser-control-layer meter --path "$HOME/.claude/projects/project/session.jsonl" --json
```

## Select transcripts

The default root is `~/.claude/projects`. `--path` selects a transcript or directory inside that root; directories are traversed recursively and JSONL files are sorted before reading. Paths outside the root, symbolic links and paths whose real location differs from their selected location are refused with `METER_PATH`. A selection containing no JSONL transcript files is also refused. `--json` is accepted; the command prints JSON with or without that flag. See [report.mjs](../src/meter/report.mjs).

## Recognized records

The Claude Code adapter accepts typed JSONL records. It skips recognized user, system, summary, progress, file-history, queue and last-prompt metadata records. Assistant records require a message ID and valid nonnegative integer usage fields. Missing cache usage fields default to zero; input and output usage remain required.

Streaming fragments sharing a message ID count as one step. Their input usage must agree, and the largest cumulative output count is retained. Unknown record shapes, inconsistent duplicate usage, corrupt JSON and transcripts with no assistant usage records fail with `UNKNOWN_TRANSCRIPT`, including the source line and a shape diagnostic. See [claude-code.mjs](../src/meter/claude-code.mjs).

## What the fields mean

| Field | Meaning |
|---|---|
| `input_tokens` | Input tokens plus cache-creation input tokens plus cache-read input tokens. |
| `output_tokens` | The deduplicated cumulative assistant output usage. |
| `reread_tokens` | Cache-read input tokens. |
| `reread_share` | Cache-read input divided by total input; empty input gives zero. |
| `input_share` | Per-step input divided by input plus output; an empty total gives zero. |
| `per_step` | The same usage measures for each deduplicated assistant step. |
| `steps`, `files` | The number of parsed steps and selected transcript files. |

The aggregate re-read share divides summed cache-read tokens by summed input tokens. It is not an average of the step shares. Cache reads demonstrate repeated input; usage fields alone cannot identify uncached repeated input, so the report labels the measure a lower bound. See [aggregate](../src/meter/report.mjs).

## Local handling and verification

The meter reads local files through the filesystem APIs and prints aggregate and per-step counts. Message text, tool text, source paths and message IDs are absent from the successful report. Parsing errors report a line and diagnostic so a format change can be investigated. The implemented adapter is Claude Code; the [roadmap](ROADMAP.md) describes the format-receipt requirement for additional adapters.

Run `node --test test/meter.test.mjs` for exact synthetic aggregates, streaming deduplication, unknown-shape refusal and transcript path controls. The [test fixture](../test/fixtures/meter/known.jsonl) is synthetic and the tests check that its message content stays out of the aggregate report.
