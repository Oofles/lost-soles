---
id: 274
slug: run-page-s-back-arrow-pops-to-the-chronicle-when-the-run-was
title: Run page's back arrow pops to the Chronicle when the run was opened from it
type: bug
priority: low
status: open
size: s
capability: 13-home-plinth-and-chronicle
depends_on: []
blocked_by: []
source: agent
created: 2026-10-15T18:54:00Z
started: 2026-10-16T00:55:18Z
---

## Description

`/run/:id`'s `←` link always pushes `/`. For a run opened out of the Chronicle (D-321) the stack then
ends `/, /chronicle, /run, /`, so the arrow and the browser's back disagree, and back from `/` lands
on the run again. Found by the `0088` agent; the code is `0078`'s, which `0088` did not touch.

## Acceptance criteria

- [ ] For a run opened from the Chronicle, `←` behaves exactly as browser back: it returns to the
      Chronicle at its scroll position, and leaves no duplicate history entry.
- [ ] For a run opened any other way, `←` still goes to `/`.
- [ ] A test walks both paths through a fake history.

## Steps to reproduce

1. From `/`, click `RUNS`, then open any run.
2. Click the run page's `←`.
3. Press browser back.

## Expected vs actual

**Expected:** `←` returns to the Chronicle; back from there goes to `/`.

**Actual:** `←` pushes `/`; browser back then returns to the run.

## Notes

`lib/chronicle/return.ts` already knows whether the Chronicle is behind the run (D-321's popstate
check); reuse it rather than adding a second record.

## Operator validation

None expected: history order is fully testable.
