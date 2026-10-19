# Scoped extraction

Ask the page for the fields the job needs and nothing else. Full page text and screenshots are the largest outputs a browser step returns; named fields are the smallest (bench row R5 compares all three).

## One read for all fields

Frame the fields before the run: names, where each lives, what a missing value looks like. Then send one script that returns them together:

```js
(() => {
  const text = (sel) => document.querySelector(sel)?.textContent.trim() ?? null;
  const all = (sel) => [...document.querySelectorAll(sel)].map((e) => e.textContent.trim());
  return {
    title: text('<title-selector>'),
    price: text('<price-selector>'),
    items: all('<item-selector>'),
    url: location.href,
  };
})();
```

The result is a small JSON object. Missing fields return `null`, which is itself a finding.

## Choosing selectors

- Start from the page's own structure: landmarks, headings, labelled controls, `data-` attributes.
- Check each selector once against the live page before you batch (a single observation).
- For lists, return the list and a count so a truncated page shows itself.

## When text is the better answer

Use the visible text of one region instead of the whole page:

```js
document.querySelector('<region-selector>').innerText;
```

## When a screenshot earns its place

Only when the answer is visual: a layout, a chart, an image. Crop to the region and say what you will look for.

## Pair with the brief

`runners/brief.template.md` has a field list and a single-read slot. Fill it so the runner opens with the extraction script ready (`method/03-batch-first.md`).

## Check

- PK02: one read returned all fields.
- UC04: output bounded; long values saved by path.
