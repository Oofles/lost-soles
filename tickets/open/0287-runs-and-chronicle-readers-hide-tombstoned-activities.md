---
id: 287
slug: runs-and-chronicle-readers-hide-tombstoned-activities
title: Runs and Chronicle readers hide tombstoned activities
type: feature
priority: med
status: open
size: m
capability: 14-webhook-and-automatic-sync
depends_on: []
blocked_by: []
source: agent
created: 2026-10-18T13:09:34Z
started: 2026-10-18T23:15:47Z
---

## Description

`0282` (D-355) tombstones an activity that was deleted at its source: T3 `status = TOMBSTONED`,
and nothing else changes. The operator kept that ticket write-only (Q5), so **no reader filters on
`status` yet**. A deleted run still shows in `/api/runs/latest`, the runs trace web and the
Chronicle, while `02-data-model.md` §4.7 says a tombstoned activity leaves the list.

Make the readers honour it. By D-020 and D-135 the cells it revealed stay revealed and its XP
stays: only the *list* views drop it.

## Acceptance criteria

- [x] `lib/runs` (including `/api/runs/latest`) skips `TOMBSTONED` activities. *Amended: the
      list readers (`latestRun`, `chroniclePage`) skip them. `runById` (`/run/:id`) and
      `historyUpTo` (the Chronicle line's lifetime facts) deliberately do not. A direct link is not
      a list, and the lifetime facts count the same lifetime the XP total does (D-135). Proposed as
      D-358.*
- [x] The Chronicle does not list a `TOMBSTONED` activity.
- [x] The runs trace web leaves out a tombstoned activity's trace, or the ticket records why it
      keeps it (the cells stay revealed either way, D-020). *Kept; why is in Resolution.*
- [x] Map cells, the ledger and Total Level are unchanged by a tombstone, asserted by a test.
- [x] Tests cover each reader with one active and one tombstoned activity.

## Notes

Filed at the merge of capability 14's wave (tickets `0282`, `0286`), 2026-10-18. Read 02 §4.7
and D-355. A tombstone is sticky: persist never writes `ACTIVE` back over it.

## Operator validation

None expected beyond a smoke test: tombstone a synthetic activity in a throwaway user's T3 row,
or through `retractActivity` in a test, and read each endpoint.

**Result, 2026-10-18 (orchestrator, deployed stack, Amplify job 413; smoke test).**
- `chroniclePage` ran from the merged code against the real Activity table (`Activity-nog4xy2l7baqlhghpndh2565qe-NONE`). The data was two throwaway rows under user `smoke-0287-throwaway`: one `ACTIVE`, and one `TOMBSTONED` with a later `startedAt`. It returned only `smoke-0287-active`, so the newer tombstoned row was dropped at the head of the page. Both rows were then deleted. They were synthetic, under a user that does not exist, so D-020 is not involved.
- `latestRun`, the trace-web decision (D-358) and "cells, ledger and Total Level unchanged" are proven by `lib/runs/tombstone.test.ts`, which tombstones through the real `retractActivity`. No tombstoned row exists in production yet, so there is nothing more to read live.
- **Perceptual:** none.

## Resolution

A tombstoned activity (D-355) now leaves the two list readers. Nothing else changes for it.

**Files touched**

- `lib/runs/server.ts`: new `isTombstoned(row)`, keyed on `TOMBSTONED_STATUS` from
  `src/pipeline/persist`. A row with no `status`, written before the column existed, counts as
  ACTIVE.
  - `latestRun` skips tombstoned rows when it picks the newest traced row. The home map's last-run
    line and the plinth fall back to the previous run.
  - `chroniclePage` adds `status` to its projection and drops tombstoned rows. Dropping rows can
    empty a page, so it reads on through `ExclusiveStartKey` until it has at least one item or
    history ends, bounded by the new `CHRONICLE_MAX_READS = 4`. A page that is still empty after
    that comes back with its cursor, and the panel's existing effect asks again. The cursor is
    always the last key read, so no row is skipped or repeated.
- `lib/runs/server.test.ts`: `latestRun` skips a tombstoned run in front of an active one, and
  answers empty when the only traced run is tombstoned.
- `lib/runs/run-page.test.ts`: `chroniclePage` drops a tombstoned row and keeps the active one
  beside it, and projects `status`. A legacy row with no `status` lists. A fully tombstoned page
  reads on to the next one. The read bound holds.
- `lib/runs/tombstone.test.ts` (new): one stateful world with T3, the receipt table, T4 and the S3
  objects. One active run and one newer run that the shipped `retractActivity` tombstones. Before
  and after the tombstone it asserts:
  - the Chronicle lists only the active run;
  - `latestRun` falls back to the active run;
  - `traceWebRuns` is unchanged;
  - `runById` still resolves the tombstoned run;
  - the S3 objects (the cells' `classes` objects, the traces and the web) are byte-identical;
  - the T4 ledger rows are identical;
  - Total Level, computed with `totalLevel` over the XP that the shipped `xpBeforeRun` ledger
    reader returns, is identical;
  - the T3 row differs only in `status` and `updatedAt`.

**Decisions (proposed to the orchestrator; none allocated here)**

- **The permanent trace web keeps a tombstoned run's line.** The ticket allows this if the reason
  is recorded, so here it is:
  - The web is part of the map, and D-020 keeps the map permanent. The cells that run revealed stay
    revealed, so its line keeps drawing ground that is visibly explored. Removing the line would
    leave revealed ground with no route through it.
  - Removing it would also cost one of two things. Either the retract path rewrites the web object,
    which breaks D-355's "touches nothing but T3 status", or every web load runs a T3 query to
    filter by status. That is a new read on the map's hot path to hide one line.
  - The web's rebuild tool is untouched for the same reason.
- **`/run/:id` and `historyUpTo` do not filter.** `02` §4.7 says the activity "leaves the activity
  list", and the operator's framing was that only list views drop it.
  - `/run/:id` is a direct link, not a list. A post-run moment or bookmark already open on the run
    keeps working, and nothing in the lists links to it any more.
  - `historyUpTo` feeds the Chronicle line's lifetime facts and thresholds. These count the same
    lifetime as the XP total, which keeps the tombstoned run's XP (D-135). Leaving it out would also
    let a lifetime threshold be crossed twice.
- **The bounded read-on in `chroniclePage`.** Without it, a first page made up entirely of
  tombstoned rows would render "Nothing here yet" over an account that has runs.
- The backfill batch reader (`lib/backfill/store.ts`) already counted only ACTIVE rows, so it was
  left alone.

No design doc changed: `02` §4.7 already says what this implements.
