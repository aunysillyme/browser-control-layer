# Package results

The generated block renders eligible package measurements from [proof/results.json](../proof/results.json). Run the [benchmark](BENCHMARK.md) to produce a dated row with a raw-log hash; resource defaults are recorded separately in [DEFAULTS.md](DEFAULTS.md).

<!-- proof:start (generated; package rows only) -->
| Row | Measurement | Median | Date | Rerun |
|---|---|---|---|---|
| E1 | crash matrix | 0 processes | 2026-10-19T08:53:51.000Z | `npx browser-control-layer bench hygiene --suite E1 --n 3` |
| H4 | sentinel safety | 0 processes | 2026-10-19T08:49:58.776Z | `npx browser-control-layer bench hygiene --suite H --n 3` |
| S1 | screen quality | 0.5 fraction | 2026-10-19T08:49:50.153Z | `npx browser-control-layer bench hygiene --suite S --n 3` |
<!-- proof:end -->
