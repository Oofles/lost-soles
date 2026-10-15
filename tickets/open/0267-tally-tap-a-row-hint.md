---
id: 267
slug: tally-tap-a-row-hint
title: Show the tap-a-row hint on the post-run tally
type: bug
priority: low
status: open
size: s
capability: 12-post-run-moment
depends_on: []
blocked_by: []
source: agent
created: 2026-10-15T13:20:51Z
started: 2026-10-15T13:31:03Z
---

## Description

`06-ui-ux.md` §3.2's tally mockup ends with a right-aligned `[ tap a row for ⌄ ]`. It never
shipped: rows are `<button aria-expanded>` with only an `aria-label`
(`app/run/[activityId]/run-ledger.tsx:156-163`), so nothing visible says a row can be expanded,
and the breakdown that makes the numbers *"accountable rather than dispensed"* is undiscoverable.
Found by the `12-post-run-moment` audit (§2); resolved toward the doc under D-051 (legibility beats
atmosphere).

## Steps to reproduce

1. Open `/run/:id` for any run in the desktop browser.
2. Look at the tally panel during beat 2 and in the end state.

## Expected vs actual

**Expected:** a quiet hint that a row expands, as in `06` §3.2's mockup.
**Actual:** no visible affordance; only an `aria-label` on each row button.

## Acceptance criteria

- [x] The tally panel shows a quiet hint, right-aligned below the footer, reading `click a row for ⌄`
      on a pointer device (desktop, D-227) — `tap` only under `(pointer: coarse)`.
- [x] It uses an existing muted text token, ≥ 12sp (§8.4), and does not shift layout while counts
      animate (no reflow, as `0081` measured).
- [x] It is present in the static end state too, and is `aria-hidden` (the buttons already carry
      the semantics).
- [x] It does not appear for an activity with no expandable rows.

## Notes

Filed by the capability-12 drift audit, 2026-10-15. Wording on desktop deviates from the mockup's
"tap" because the desktop is the viewing surface (D-227/D-251); the mockup was drawn for a phone.

## Operator validation

Desktop browser, `/run/:id`: does the hint read as a quiet affordance, or as clutter competing with
the totals? (Perceptual — two people could disagree.)

**Operator, desktop browser — verified 2026-10-15:** *"the hint reads fine"* — a quiet affordance,
not clutter.

**Agent:** Amplify job 395 (`a2e815b`) SUCCEED. A local build of that commit ships `a row for`,
`data-hint` and `pointer: coarse` in the run page's chunk. The unit tests cover the text, the
attributes, the 12px muted token, and absence with no rows. The full gate is green (3,419 passed).

## Resolution

**Files.** `app/run/[activityId]/run-ledger.tsx`: a new `ExpandHint`, rendered after the footers
when any line has `parts`. It is a right-aligned `<p aria-hidden data-hint="expand">` at `.75rem`
(12px, §8.4's floor) in `--text-muted`. It reads `click a row for ⌄`, or `tap` under `(pointer:
coarse)`, via `useSyncExternalStore` on `matchMedia`; the server snapshot is `click`, so SSR and the
desktop match. It is static, outside beat 2's stagger, so nothing reflows while the counts run. The
panel is `maxHeight: 55vh` rather than a fixed height, so the extra line fits.
`lib/run-moment/tally.test.tsx`: the hint's text, attributes, size and token; absent with no rows.

**Choice.** The mockup says "tap". The desktop is the viewing surface (D-227/D-251), so the
default word is "click", as the ticket's criterion specified.
