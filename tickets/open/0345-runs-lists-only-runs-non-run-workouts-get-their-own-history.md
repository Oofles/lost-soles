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

- [ ] A recorded decision (`D-xxx`) settles the open questions below, and `06` §2.5, §3.1 and §6
      are amended to match **before** the UI work merges (D-152).
- [ ] `/chronicle` (opened by `RUNS`) lists only traced activities. The filter reads the row's trace
      data (`isTraced`), never a skill id. Adding a new non-run workout type is still a data row
      with an empty `.tsx` diff (D-031; the CI guard stays green).
- [ ] Paging still works on the filtered list. A page is never short because a filter removed
      rows after the `Limit`: either the query filters before the limit, or the reader keeps
      reading until the page is full or the history ends. A test covers a page boundary that falls
      in a run of consecutive workouts.
- [ ] Non-run workouts have their own history, at the place the decision names, newest first,
      backfill and paging included.
- [ ] Opening a past non-run workout shows a view built for one: no camera move, no "Return from the
      Fog", no reveal sequence. Whatever it shows (date, the split or sets, the XP award) comes
      from the activity row.
- [ ] `/run/:id` for a traceless activity (an old link, a pasted URL) goes to that workout view
      instead of rendering the run page.
- [ ] A test proves that replaying or reopening a workout writes nothing. The ledger is untouched
      (D-135); any replay is display only. (Expected to be true already. Prove it, do not assume it.)
- [ ] The unseen mark keeps its rule: at most one row, the latest traced run (§2.5, D-324).
- [ ] (operator) On the desktop browser, `RUNS` shows only runs, the workout history is where the
      decision put it, and opening a strength workout from it feels like reading a record, not a
      broken run page.

## Notes

**Open questions, to be settled by the D-xxx before building:**

1. **Where the workout history lives.** Options:
   - (a) A second list in the Chronicle panel, e.g. `Runs | Workouts`, keeping one destination in
     the rail column.
   - (b) On `/log`, below the add buttons, next to where workouts are entered (§6). Note that
     `/log` is static by design (D-282) and must render offline, so a server-read history there
     needs care.
   - (c) Per skill, in the skill sheet on `/skills` (§5.5): Might's history under Might.
   - (d) A new plinth destination. The rail has three today (§2.3 limits what earns space).
2. **What opening a past workout shows.** Probably a static record: date, the split or sets, and
   the XP it earned. Does it keep a ⟲ replay of the award or level-up card at all, or is a replay
   with no map simply removed?
3. **Do traced activities that are not runs count as runs here** (a walk or a ride, if such skills
   exist)? This ticket assumes yes: the list is "what drew on the map", which is the data-driven
   definition. Confirm or amend.
4. **Does the plinth label stay `RUNS`?** With the filter, it becomes accurate.

**D-123:** no trigger. Single account, no share or export, no public URL.

**Code pointers:** `components/plinth/plinth.tsx` (the `RUNS` link), `app/(home)/chronicle/page.tsx`,
`components/chronicle/chronicle-rows.tsx` (the row link to `/run/:id`, and the list's aria-label),
`lib/runs/server.ts` `chroniclePage` / `isTraced`, `lib/chronicle/rows.ts`, `app/run/[activityId]/`.

## Operator validation

Perceptual, desktop browser: `RUNS` shows runs only; the workout history is where the decision put
it; a strength workout opens to its own record with no map motion. Smoke test (agent): page through
a filtered `/api/runs/chronicle` against live data and confirm full pages with no workouts in them.
