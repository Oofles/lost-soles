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

- [x] For a run opened from the Chronicle, `←` behaves exactly as browser back: it returns to the
      Chronicle at its scroll position, and leaves no duplicate history entry.
      *(In browsers with the Navigation API — the same condition D-321's restore already uses as its
      primary test. Without it the entry behind the run cannot be seen, and `←` keeps pushing `/`,
      the old behaviour; see Resolution.)*
- [x] For a run opened any other way, `←` still goes to `/`.
- [x] A test walks both paths through a fake history.

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

## Resolution

**Files touched**

- `lib/chronicle/return.ts` — `ChronicleReturn.behind()`: true when the session-history entry
  directly behind the current one is the Chronicle entry a row was opened from. It reads the same
  `leftFrom` key that `take()` already keeps (D-321), so there is no second record of "opened from
  the Chronicle". `TraversalHost.navigation` widened to the Navigation API's `currentEntry.index`
  and `entries()`, which `window.navigation` already provides. New `backArrowClick(ret, back)`: the
  `←` link's click handler. A plain primary click with the Chronicle behind cancels the link's push
  and calls `back()`. Anything else is left to the link: no Chronicle behind, a modified or
  middle click (new tab), or a click the sequence's exit already swallowed (`defaultPrevented`).
- `app/run/[activityId]/run-moment.tsx` — `EndState`'s `<Link href="/">` gets
  `onClick={(e) => backArrowClick(browserChronicleReturn(), () => window.history.back())(e)}`.
  `window.history.back()` is exactly what Next's `router.back()` does. It is used directly so
  `EndState` stays renderable without an app-router context, as its tests render it. Next's `Link`
  skips its own navigation when `onClick` prevents the default.
- `lib/chronicle/return.test.ts` — the fake history's `navigation` now exposes `index` and
  `entries()`. A new `describe` walks the arrow through it. Opened from the Chronicle: `←` lands
  on `/chronicle` with its snapshot, pushes nothing, and the next browser back goes to `/` and then
  out of the app. The same holds from a cold-linked, seeded Chronicle, and after a Relive whose
  sentinel came off. Opened from the plinth, from a cold deep link, after a dismissed Chronicle, or
  with the Chronicle more than one entry back: `←` pushes `/`. Modified, middle and
  already-swallowed clicks never back. Without the Navigation API, `←` pushes `/`.

**Decisions made**

- **"Behind" means the entry directly behind, by key.** A dismissal also calls `leave`, but its
  entry sits forward of `/`, and the next push from `/` prunes it, so it can never be behind a run.
  Checking only the adjacent entry (not "somewhere back") keeps `←` from jumping several entries.
- **Without the Navigation API, `←` keeps pushing `/`.** No history API shows the entry behind,
  and guessing from the `popstate` fallback could back out of the app or onto the wrong page.
  This leaves such a browser exactly where it was before this ticket. It is not a new failure.
- No design doc change: D-321 already says Chronicle-opened runs back to the Chronicle and others
  to `/`. This makes the arrow agree with that.

**Verification:** all `amplify.yml` build-phase guards, `npm run typecheck`, `npm run lint`,
`npx vitest run` and `npm run build` pass in the worktree.
