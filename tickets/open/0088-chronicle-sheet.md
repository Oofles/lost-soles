---
id: 88
slug: chronicle-sheet
title: /chronicle — the run list as a sheet opened from the plinth
type: feature
priority: med
status: open
size: m
capability: 13-home-plinth-and-chronicle
depends_on: [86, 78]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
started: 2026-10-15T18:28:53Z
---

## Description

The Chronicle is the list of everything you have done. It renders as a **sheet over the map**,
opened from the plinth's handle, and it **exists as a route** (`/chronicle`) so that the browser
back button and deep links behave (`06-ui-ux.md` §1.2, §1.5).

That dual nature is the whole ticket: it must feel like a sheet and behave like a route. Opening it
pushes a history entry; back dismisses it to `/` rather than leaving the app; a cold deep link to
`/chronicle` renders the map underneath and the sheet already up, so back still lands on `/` and not
on a blank stack.

Rows are runs and logged workouts in reverse chronological order. A row carries the date, the
activity kind, its headline measure (distance for a run, the workout summary for a logged session)
and its new-cell count where it has one. Clicking a row opens `/run/:activityId` in **static end
state** with `⟲ Relive` — never auto-playing (0078's entry matrix).

Rules that follow from D-013 and `06-ui-ux.md` §2.3, and that this list will invite breaking:

- **No calendar view, no week grid, no gaps rendered.** A list has no holes in it; a calendar has
  nothing but holes, and every empty square is an accusation.
- **No aggregates by week or month.** Cumulative totals live on the plinth; period totals are one
  step from period goals (N2).
- **No filters, no search, no sort control** in v1. It is a list, newest first.
- Unseen runs may be marked, quietly, with the same gold treatment as the plinth line — and the mark
  disappears once seen (0084's per-device flag). It never becomes a count badge.

Paging: the list must survive a backfilled archive of years. Virtualise or page it; do not render
2,000 rows.

## Acceptance criteria

- [ ] Clicking (or dragging) the plinth handle opens the Chronicle sheet over the map, with the
      map still visible behind it.
- [ ] `/chronicle` exists as a route: navigating to it directly renders home beneath with the sheet
      open, and browser back dismisses to `/` without exiting the app.
- [ ] Back from a run opened out of the Chronicle returns to the Chronicle, and a second back to `/`.
      Three levels of back behave with no blank or duplicated entries.
- [ ] Rows are reverse chronological and include runs and manually logged workouts in one list.
- [ ] Clicking a row opens `/run/:id` in static end state — no auto-play, asserted by a test.
- [ ] An unseen run is marked in gold; the mark clears after the run is seen or skipped, and no
      numeric badge is ever rendered.
- [ ] A list of 2,000 activities scrolls at the §6.4 frame budget in the desktop browser; DOM node count
      stays bounded.
- [ ] No calendar, week grid, filter, search, sort or period-total UI exists — asserted by a
      repository test over the component tree.
- [ ] The sheet is dismissible by Esc, a close control and back, and dismissing it does not move the
      map camera.

## Notes

Depends on 0086 (the plinth and its handle) and 0078 (the run route it opens).

The screen map (§1.2) is deliberately seven routes and two of them are sheets. Keeping `/chronicle`
a route rather than local state is what makes the back button predictable at every depth, which is
the capability's own done-condition. Do not implement it as a modal held in component state.

Post-run sequences are never launched from here without an explicit `⟲ Relive` click — replays are
opt-in (§3.1). Getting this wrong turns browsing your history into being ambushed by animations.

- **Amended by D-313 (0187, 2026-10-15).** The Chronicle opens from the plinth's `RUNS` button only (no handle to click or drag), in the rail's column with no scrim and the map usable beside it — the §2.5 panel, not a sheet over the map. Below 1024px it takes the bottom card's place. It uses `lib/sheet/swipe-dismiss.ts` (D-314) where it is a bottom sheet.
- **Operator, 2026-10-15 (wave 1 of `13`), settling the open question above: back from a run opened out of the Chronicle returns to the Chronicle**, at the same scroll position, and a second back goes to `/`. Chronicle row links push rather than replace. A run opened any other way still goes back to `/`. This amends `06` §3.3's "Back returns to `/`": amend the doc and propose the decision as D-NEW-a.

## Operator validation

In the desktop browser: open the Chronicle from the plinth. Open a run from three months ago, then press back — you must be
back in the Chronicle at the same scroll position, not at the top and not on `/`.

Now the back-button sweep, which is this capability's done-condition: from `/`, open Chronicle → open
a run → hit `⟲ Relive` → skip → back → back → back. You should end on `/` having passed through the
Chronicle exactly once, with nothing blank in between.

Then scroll the whole list after a full Strava backfill. It must stay smooth to the bottom, and
nothing in it should make an unremarkable month look like a failure.

- 2026-10-08 (operator, during 0078 validation): **an open question to decide here, not a settled one.** Should back from a run opened from the Chronicle reopen the list instead of going to `/`? §3.3 says it goes to `/`, so today's links use `replace`. The other way costs little: the links push instead of replace. A run opened any other way would still go back to `/`. Ask the operator before building the sheet's dismiss behaviour.
