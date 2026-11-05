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
started: 2026-11-05T17:54:08Z
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
- [x] The plinth's destinations follow `06` §2.2 row 9 as amended: row one `+ ADD WORKOUT` full
      width; row two `SKILLS` · `RUNS` · `WORKOUTS` in equal thirds, all 40px, 8px gaps, 8px radii
      (`--radius-control`). Focus order matches §2.2's amended keyboard order. Below 1024px the two
      rows still fit the bottom card.
- [x] `/chronicle` (opened by `RUNS`) lists only traced activities. The filter reads the row's trace
      data (`isTraced`), never a skill id. Adding a new non-run workout type is still a data row
      with an empty `.tsx` diff (D-031; the CI guard stays green).
- [x] Paging still works on the filtered list. A page is never short because a filter removed
      rows after the `Limit`: either the query filters before the limit, or the reader keeps
      reading until the page is full or the history ends. A test covers a page boundary that falls
      in a run of consecutive workouts.
- [x] `WORKOUTS` opens `/workouts` (§2.6): every traceless activity, newest first, paged, in the
      rail's column with the map live and unmoved beside it; Esc, close and back dismiss it; no
      unseen mark.
- [x] A row opens `/workouts/:id` in the same column: a plain record of the date, what was logged
      (the split and its shares, or the count/seconds/minutes) and the XP each skill earned. No
      camera move, no "Return from the Fog", no ⟲ Relive. Back returns to the list.
- [x] `/run/:id` for a traceless activity (an old link, a pasted URL) redirects to
      `/workouts/:id` instead of rendering the run page.
- [x] A test proves that replaying or reopening a workout writes nothing. The ledger is untouched
      (D-135); any replay is display only. (Expected to be true already. Prove it, do not assume it.)
- [x] The unseen mark keeps its rule: at most one row, the latest traced run (§2.5, D-324).
- [x] (operator) On the desktop browser, the plinth's two button rows read well, `RUNS` shows only
      runs, and opening a strength workout from `WORKOUTS` reads as a record, not a broken run page.
      — verified 2026-11-05: passed, desktop browser ("looks great!")

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

## Resolution

Built 2026-11-05 in one session. The work stayed at the top of `m`, so the record view was not split
off.

**Reader (`lib/runs/server.ts`).** `chroniclePage(userId, deps, after, filter)` takes
`"traced" | "untraced"` (default `"traced"`) and keeps rows where `isTraced(row)` matches, which
reads `hasTrace`, or `traceRef` on an older row. It never reads a skill id or a kind, so a
traceless treadmill run is a workout and a mapped ride is a run. The row mapping moved into
`listItem()`, which `workoutById` also uses.
- **Paging (D-487, superseding D-359).** The reader keeps querying until the page holds 50 rows or
  history ends.
- **Cursor.** When a page fills partway through a query, the cursor is the last row *returned*, not
  `LastEvaluatedKey`, so nothing past it is skipped.
- **Read cap.** `CHRONICLE_MAX_READS` went from 4 to 20. D-359's "read until one row" rule would
  have given `RUNS` a one-run page after a week of workouts.
- **Rejected:** a DynamoDB `FilterExpression`, which applies after `Limit` and so does not fix
  short pages.

**New reads.**
- `workoutById` is `runById`'s owner-checked base-table `Query`, with a projection and no S3 read.
  It returns `null` for another user's id, a missing id, a traced activity and a tombstoned workout
  alike.
- `runById` now also returns `traced`. On `RunSummary` it is optional, so existing run fixtures
  read as runs.

**Routes.**
- `/api/runs/chronicle` passes `"traced"`. The new `/api/runs/workouts` passes `"untraced"` with the
  same posture: session uid only, 404 when signed out, 400 on a bad cursor, `withNoStore`.
- `app/(home)/workouts/page.tsx` and `app/(home)/workouts/[activityId]/page.tsx` sit under the
  `(home)` layout, so the map stays mounted and unmoved.
- `isHistoryPanel()` in `home-screen.tsx` hides the rail on `/chronicle`, `/workouts` and
  `/workouts/*`. Before, it checked only `/chronicle`.
- `/run/:id` calls `redirect(workoutHref(id))` when `summary.traced === false`, before any of the
  page's other reads start.

**UI.**
- `ChroniclePanel` takes `list: "runs" | "workouts"`. A config table sets the title, labels, page
  fetcher, row href and `marksUnseen`; the workouts list never asks for or draws an unseen mark.
  The list's aria-label is now "Runs, newest first" or "Workouts, newest first".
- `chronicleRow` takes an href builder.
- The plinth is a `repeat(3, minmax(0, 1fr))` grid with `+ ADD WORKOUT` spanning `1 / -1`. DOM
  order is Add workout → Skills → Runs → Workouts, which is §2.2's amended focus order.
- `/workouts/:id` is `components/workouts/workout-record.tsx`, drawn on the Chronicle's panel CSS.
  It shows the date and kind, a LOGGED list and an EARNED list (per skill, plus a total when more
  than one skill earned). Esc, × and swipe call `router.back()`. There is no Relive, no title
  sequence and no map code.
- The record's words come from `lib/workouts/record.ts`, which is pure. A split is recognised by
  its stored shape: more than one timed set, across more than one exercise. Each share is that
  set's part of the total time, so `apportionSplit`'s output reads back as "upper body 30:00 ·
  75%". Skill and exercise names come from the bundled ruleset. Nothing switches on an id.
- A failed ledger read shows one quiet line in place of the XP; the record itself still renders.

**Tests added.**
- `lib/runs/run-page.test.ts`: the filter, including old rows that only have `traceRef`, a ride,
  and a traceless run. Paging through a real fake that honours `Limit` and `ExclusiveStartKey`:
  50 runs, then 120 workouts in a row, then 30 runs gives pages of 50 and 30; an alternating
  history walked both ways gives full pages with no row lost or duplicated; a page that fills on
  the last row has `next: null`. Also `runById().traced` and `workoutById`'s four null cases.
- `app/(home)/workouts/[activityId]/page.test.tsx`: the record renders. It contains no
  Relive/⟲/"Return from the Fog"/map. Rendering it twice over a recording DynamoDB fake sends
  only `QueryCommand`s, which is the "writes nothing" proof (D-135). It returns 404 for another
  user's id, for a run and with no session. A ledger failure leaves the record standing.
- `app/run/[activityId]/redirect.test.ts`: a traceless summary redirects with no XP-before or
  history read; a traced summary, or one that predates the flag, renders.
- `lib/workouts/record.test.ts`: the record's words.
- `components/chronicle/chronicle-panel.test.tsx`: the workouts variant's labels, `/workouts/:id`
  hrefs and no unseen mark.
- `app/api/runs/workouts/route.test.ts`, the chronicle route test's filter assertion, the plinth's
  layout and order tests, and the offline contract's new endpoint.

**Changed tests.** Two existing tests encoded the old behaviour and were changed, not deleted:
- The "reads on past an all-tombstoned page" test now ends its fake history explicitly, because
  the reader fills the page.
- The "narrows a logged session's sets" test reads the `untraced` list, because a workout is no
  longer on the default list.

**Went wrong, briefly.** The first panel change derived the heading id from the list name, which
renamed `chronicle-title` and broke an existing test. The id now comes from the config.

**Below 1024px.** The bottom card gains one 48px row. It is `max-height: 55vh; overflow-y: auto`,
so it scrolls rather than breaks (D-251). It was not checked by eye: the operator check is
desktop-only (D-227).

## Operator validation

Perceptual, desktop browser: `RUNS` shows runs only; the workout history is where the decision put
it; a strength workout opens to its own record with no map motion. Smoke test (agent): page through
a filtered `/api/runs/chronicle` against live data and confirm full pages with no workouts in them.

**Agent smoke test, 2026-11-05, live T3 (`devault`, us-east-1), owner uid.** I walked
`chroniclePage` to the end in both directions with the code built for this ticket:
- `RUNS`: pages of 50, 50 and 13. 113 rows, every one traced, no duplicates.
- `WORKOUTS`: one page of 9, every one traceless.
- The two lists have 0 ids in common, and 113 + 9 = 122 activities.
- `workoutById` on the newest workout returned it (`strength`, a 30:00 yoga set).
- `runById` on the same id returned `traced: false`, so `/run/:id` redirects.
- `workoutById` on the newest run returned `null`.

**Build and guards** (clean copy): `next build` passes. `/workouts` and `/workouts/[activityId]`
are dynamic, and the prerender guard is green. Typecheck, lint, the full vitest suite (297 files,
4,842 tests) and every static guard in `amplify.yml` pass.

**Operator, desktop browser, 2026-11-05:** the two plinth rows, `RUNS` showing only runs, and a
strength workout opening from `WORKOUTS` as a plain record were all checked and passed ("looks great!").

