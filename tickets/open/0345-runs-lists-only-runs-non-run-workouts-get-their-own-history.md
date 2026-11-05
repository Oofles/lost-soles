---
id: 345
slug: runs-lists-only-runs-non-run-workouts-get-their-own-history
title: RUNS lists only runs; non-run workouts get their own history and a detail view without the run page's map
type: feature
priority: med
status: open
size: m
capability: 13-home-plinth-and-chronicle
depends_on: []
blocked_by: []
source: operator
created: 2026-11-05T16:45:47Z
---

## Description

The plinth's `RUNS` opens `/chronicle` (06 §2.5, D-313). That list currently holds **every**
activity, runs and logged workouts together. `lib/runs/server.ts` `chroniclePage` says so
deliberately: *"Runs and logged workouts in one list, because they are one table"*, and the list's
own label is "Runs and workouts, newest first". The operator found that this is wrong in two ways
(2026-11-05, desktop):

1. **The label lies.** `RUNS` should show runs only. The history of strength and other non-run
   workouts should exist, but somewhere else.
2. **A workout row opens the run page, and the run page has nothing to show for it.** Clicking a
   strength workout in the Chronicle goes to `/run/:id`, which:
   - flies the camera across the map to the last run's location;
   - carries the "Return from the Fog" title (§3), a sequence that §6.4 explicitly says does *not*
     happen for logged work ("no reveal sequence — there is no territory");
   - offers ⟲ Relive, which replays the skill-point award while the map does nothing.

   Each of these is the run page doing its job on an activity that has no trace. The fix is a
   different view, not patches to the run page.

The data to tell the two kinds apart already exists. Each Chronicle row carries `hasTrace`, or a
`traceRef` on a row from before `hasTrace` existed (`isTraced`, `lib/runs/server.ts`). "A run" in
this list means **an activity with a trace**, the kind that can change the map. It must never mean
a list of skill ids (D-031/D-141).

## Acceptance criteria

- [x] A recorded decision settles the open questions below, and `06` is amended to match
      **before** the UI work merges (D-152). — done 2026-11-05: **D-486**; `06` §1 route table,
      §2.2 wireframe, row 9 and keyboard order, §2.3, §2.5, new **§2.6 Workouts**, §3.1, §6.4.
- [ ] The plinth's destinations follow `06` §2.2 row 9 as amended: row one `+ ADD WORKOUT` full
      width; row two `SKILLS` · `RUNS` · `WORKOUTS` in equal thirds, all 40px, 8px gaps, 8px radii
      (`--radius-control`). Focus order matches §2.2's amended keyboard order. Below 1024px the two
      rows still fit the bottom card.
- [ ] `/chronicle` (opened by `RUNS`) lists only traced activities. The filter reads the row's trace
      data (`isTraced`), never a skill id. Adding a new non-run workout type is still a data row
      with an empty `.tsx` diff (D-031; the CI guard stays green).
- [ ] Paging still works on the filtered list. A page is never short because a filter removed
      rows after the `Limit`: either the query filters before the limit, or the reader keeps
      reading until the page is full or the history ends. A test covers a page boundary that falls
      in a run of consecutive workouts.
- [ ] `WORKOUTS` opens `/workouts` (§2.6): every traceless activity, newest first, paged, in the
      rail's column with the map live and unmoved beside it; Esc, close and back dismiss it; no
      unseen mark.
- [ ] A row opens `/workouts/:id` in the same column: a plain record of the date, what was logged
      (the split and its shares, or the count/seconds/minutes) and the XP each skill earned. No
      camera move, no "Return from the Fog", no ⟲ Relive. Back returns to the list.
- [ ] `/run/:id` for a traceless activity (an old link, a pasted URL) redirects to
      `/workouts/:id` instead of rendering the run page.
- [ ] A test proves that replaying or reopening a workout writes nothing. The ledger is untouched
      (D-135); any replay is display only. (Expected to be true already. Prove it, do not assume it.)
- [ ] The unseen mark keeps its rule: at most one row, the latest traced run (§2.5, D-324).
- [ ] (operator) On the desktop browser, the plinth's two button rows read well, `RUNS` shows only
      runs, and opening a strength workout from `WORKOUTS` reads as a record, not a broken run page.

## Notes

**Open questions, settled 2026-11-05 by D-486 (operator):**

1. *Where the workout history lives* → its own route, `/workouts`, behind a fourth plinth
   destination, `WORKOUTS`. Add workout moves to a full-width first row; `SKILLS · RUNS · WORKOUTS`
   sit below it. That `/workouts` opens in the rail's column like the Chronicle is the agent's
   reading, recorded in D-486 so it can be overturned.
2. *What a past workout shows* → a plain record (date, what was logged, XP earned). No replay. The
   operator may add more later.
3. *Do traced non-runs count as runs* → yes: "only things traced on the map count as runs". A mapped
   ride lists under `RUNS`.
4. *The label* → stays `RUNS` for now.

**Size:** filed `m`. With a new route, a record view and a redirect it is at the top of `m`; if it
grows past that while being worked, split the record view off rather than letting it sprawl.

**D-123:** no trigger. Single account, no share or export, no public URL.

**Code pointers:** `components/plinth/plinth.tsx` (the `RUNS` link), `app/(home)/chronicle/page.tsx`,
`components/chronicle/chronicle-rows.tsx` (the row link to `/run/:id`, and the list's aria-label),
`lib/runs/server.ts` `chroniclePage` / `isTraced`, `lib/chronicle/rows.ts`, `app/run/[activityId]/`.

## Operator validation

Perceptual, desktop browser: `RUNS` shows runs only; the workout history is where the decision put
it; a strength workout opens to its own record with no map motion. Smoke test (agent): page through
a filtered `/api/runs/chronicle` against live data and confirm full pages with no workouts in them.
