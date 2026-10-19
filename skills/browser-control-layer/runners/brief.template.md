# Brief

Fill every field. Keep the brief short: the runner re-reads it at every step.

```text
Goal: <one sentence>
Pages: <public URLs, one per line>
Fields to return: <name: where it lives; what "missing" looks like>
Done check: <what the page or log must show>

Route: <read | runner batch | fan-out | remote>
Browser and profile: <driver; isolated or throwaway profile; fixed for this run>
Attach: <none | own tab only>

Batch: <numbered steps that go out together>
Single read: <the one script or call that returns all fields>
Waits: <the element each wait targets>

Caps: <wait, repeat-navigate, empty-read: values from references/defaults.md>
Stop and hand back: <login wall, bot check, human-confirmation control, secrets>

Return: report.template.md, ending with the cleanup line
```

## Notes

- Public pages only. A login wall ends the run with a hand-back.
- Name the browser and profile once; the run keeps them.
- List waits by the element they target.
- Put the done check where the main session can test it independently.
