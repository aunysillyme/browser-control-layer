# Wait for an element

A fixed sleep wastes time when the page is ready and fails when it is slow. An element wait ends the moment the page is ready and gives up at a cap you set. Bench row R4 compares both.

## Rule

Wait for the thing the next step needs: a selector, a text, a count of results. Name the cap from `references/defaults.md` and report a timeout as a result, never as a reason to wait longer.

## Snippet: wait for a selector

Run it inside the page with your driver's evaluate call:

```js
new Promise((resolve, reject) => {
  const sel = '<selector>';
  const found = () => document.querySelector(sel);
  if (found()) return resolve(true);
  const obs = new MutationObserver(() => {
    if (found()) { obs.disconnect(); clearTimeout(t); resolve(true); }
  });
  const t = setTimeout(() => { obs.disconnect(); reject(new Error('timeout: ' + sel)); }, <cap-ms>);
  obs.observe(document.documentElement, { childList: true, subtree: true });
});
```

## Snippet: wait for a count

```js
new Promise((resolve, reject) => {
  const ready = () => document.querySelectorAll('<selector>').length >= <n>;
  if (ready()) return resolve(true);
  const obs = new MutationObserver(() => { if (ready()) { obs.disconnect(); clearTimeout(t); resolve(true); } });
  const t = setTimeout(() => { obs.disconnect(); reject(new Error('timeout')); }, <cap-ms>);
  obs.observe(document.documentElement, { childList: true, subtree: true });
});
```

## When the wait times out

1. Observe the page once: is the element absent, renamed or behind a step?
2. Count the timeout toward the loop caps in `playbooks/stop-rules.md`.
3. Change the selector, the step or the method. Repeating the same wait repeats the result.

## Driver built-ins

Playwright, Puppeteer and Chrome DevTools MCP expose their own selector and text waits. Prefer them when your driver has one, with the same cap. Their forms are listed in `references/drivers.md`.

## In a batch

Put a wait between the step that triggers a change and the step that reads it (`method/03-batch-first.md`).
