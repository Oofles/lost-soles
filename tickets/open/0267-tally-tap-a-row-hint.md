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

- [ ] The tally panel shows a quiet hint, right-aligned below the footer, reading `click a row for ⌄`
      on a pointer device (desktop, D-227) — `tap` only under `(pointer: coarse)`.
- [ ] It uses an existing muted text token, ≥ 12sp (§8.4), and does not shift layout while counts
      animate (no reflow, as `0081` measured).
- [ ] It is present in the static end state too, and is `aria-hidden` (the buttons already carry
      the semantics).
- [ ] It does not appear for an activity with no expandable rows.

## Notes

Filed by the capability-12 drift audit, 2026-10-15. Wording on desktop deviates from the mockup's
"tap" because the desktop is the viewing surface (D-227/D-251); the mockup was drawn for a phone.

## Operator validation

Desktop browser, `/run/:id`: does the hint read as a quiet affordance, or as clutter competing with
the totals? (Perceptual — two people could disagree.)
