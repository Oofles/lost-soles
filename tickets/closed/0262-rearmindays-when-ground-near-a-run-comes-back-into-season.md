---
id: 262
slug: rearmindays-when-ground-near-a-run-comes-back-into-season
title: rearmInDays: when ground near a run comes back into season
type: feature
priority: low
status: closed
size: m
capability: 12-post-run-moment
depends_on: []
blocked_by: []
source: agent
created: 2026-10-14T15:47:35Z
started: 2026-10-14T19:47:30Z
closed: 2026-10-14T20:13:40Z
---

## Description

Found closing `0256`. The forward-looking chronicle row `rearm-soon-named` (*"Ashgrove Lane comes
back into season in nineteen days"*, `06-ui-ux.md` §3.5 rule 4) has a street source now (D-302) but
still no `rearmInDays` fact, so it is never selectable.

It cannot come from the run's own cells: the run just re-ran them, so every one of them is 183 days
from season. It needs the `lastRunAt` of cells **near** the run that it did not touch — a T6 read
the run page does not make today, or a value ingest computes and stores beside the run's classes
(`rearmedSince`'s neighbour). Determinism matters: a Relive must read the same line, so a value
computed against *today's* T6 state is wrong; it has to be as-of the run.

## Acceptance criteria

- [x] `rearmInDays` is a chronicle fact computed as of the run, never `now()`, and stored or
      derivable so the same activity selects the same line on every read.
- [x] `{street}` for this row names the street of the cell that comes back into season soonest, via
      `lib/place-names.ts` (D-302).
- [x] A no-new-ground run with such a cell within the chosen radius can select `rearm-soon-named`;
      the row stays the only forward-looking one (`0083` Notes).

## Notes

Decide the radius and whether ingest stores the fact (preferred: one T6 read at ingest, which
already holds the neighbourhood's records for classification) before writing code.

## Resolution

**What it does.** Ingest reads the cells within 4 rings of the run (~170 m, res 11), minus the
run's own cells. That happens in the **same** `readCells` call that classifies the run, so before
the run's own write. Of the nearby cells that were cooled as of `startedAt`, the one that re-arms
soonest is stored on the run's classes object as `rearmSoon: { cell, lastRunAt }`. On the run page,
`namesFor` turns it into `rearmInDays` (days from `startedAt` to `lastRunAt + 183d`) and a street
for that cell via `names.street` (D-302). Both come only from stored facts and the pinned archive,
so a Relive reads the same line. Recorded as **D-305**. `06` §3.5 rule 4 now cites it.

**Decisions, agreed with the operator before code:** k = 4. Store the cell, not a day count, and
derive days and street when the page is read. A nearby cell whose `lastRunAt` is after the run
(out-of-order ingest, state unknown) is skipped. A soonest cell with no street name means no line,
with no fallback. **Changed mid-ticket, with the operator's OK:** my first plan was that replay
would *keep* a stored `rearmSoon`. Reading the code showed both rewrite paths (`xp-replay.ts`
step 3 and `repair-t3`) rebuild the object from `foldActivities`, and the fold knows every cell's
state before each run exactly. So `onActivity` gained a third argument, a reader of the fold's
before-map, and both paths compute `rearmSoon` with the same `rearmSoonOf` that ingest uses. That
is exact for any history, needs no extra S3 reads, and backfills older runs when a replay touches them.

**A finding, not in the plan: the ticket's Notes were wrong.** They said ingest "already holds the
neighbourhood's records". It held only the run's own cells. The nearby read adds about 8 keys per
run cell to a BatchGet that was already there. That's roughly a tenth of a cent per run, and still
one read phase before any write.

**Template changed:** the row's text is now `{soonStreet} comes back into season in …`, no longer
`{street}`. `street` is already the fact `returnedTo` fills ("You returned to …"). A run can return
to one street and pass near another, and a shared fact name would make the forward-looking line
name the wrong street. Criterion 2's intent (the street of the soonest cell, via `lib/place-names.ts`)
holds, under a different fact name.

**Files.**
- `src/domain/discovery.ts`: `NEAR_RING_K`, `RearmSoon`, `rearmsAt`, `nearCells`, `rearmSoonOf`.
  Also `RunClasses.rearmSoon`, and `runClassesOf(classified, rearmSoon?)`.
- `src/domain/fold.ts`: `onActivity`'s third argument, `before(cell)`.
- `src/pipeline/process-activity.ts`: the combined read and the `rearmSoon` write.
- `src/pipeline/xp-replay.ts` and `src/pipeline/t3-repair.ts`: compute `rearmSoon` from the fold.
- `src/pipeline/explored-blob-store.ts`: serialise `rearmSoon`, and refuse a malformed one on parse.
  Objects with no `rearmSoon` serialise to the same bytes as before.
- `src/domain/chronicle.ts`: `ChronicleRun.rearmSoon`, which produces the facts `rearmInDays` and
  `soonStreet`.
- `lib/runs/chronicle-server.ts`: `namesFor` gains the `rearmSoon` lookup.
- `rules/chronicle.json`: the row's text and note.
- `docs/decisions/DECISIONS.md` (D-305) and `docs/06-ui-ux.md` §3.5.

**Tests.**
- `discovery.test.ts`, 6 tests: the ring; soonest-wins; skips re-armed, unknown and future cells;
  skips anything under a day; instants not strings (an ISO string with and without milliseconds),
  with the tie on cell id; `runClassesOf` carries the field. All run under the file's clock-refusal stub.
- `fold.test.ts`: the before-map reads neighbours as they were before the run applies.
- `process-activity.test.ts`: ingest stores a nearby cell (never one of its own) at the seeded
  `lastRunAt`, and stores nothing when nothing nearby has been run.
- `xp-replay.test.ts`: the fixture's `seedByIngest` now stores `rearmSoon` the way ingest does, so
  every existing "replay rewrites exactly what ingest wrote" test covers it. A new test adds a run
  ~110 m off an earlier line. Its `rearmSoon` reads `a-again`'s 02-01 time, not `a-late`'s 09-01:
  as-of, not today. Replay and `planT3Repair` both reproduce it.
- `explored-blob-store.test.ts`: round-trip and refusal.
- `chronicle-server.test.ts`: 13 days → *"Kelp Street comes back into season in thirteen days."*
  It is the same on a second read, waits without a street, waits at 51 days, and gives nothing on a
  pre-0262 object.

**Went wrong along the way.**
- `process-activity.test.ts` asserted "exactly one `cellsRead`". The nearby ring makes the read
  span several 100-key batches. The assertion now checks what it was protecting: every batch lands
  before the first write, and there are fewer batches than cells.
- One of my own test dates was wrong (a cell that re-armed before the run).
- Locally, `adapter.test.ts`'s polyline guard fails on gitignored `tmp/00NN/seed.ts` leftovers.
  It is green on a clean copy.

**Not done, deliberately:** no `repair-t3 --confirm` over the operator's account. The dry run
(below) shows no stored run would select the line, because each run's fact is fixed as of that run
and none is within 30 days. Writing the objects would change nothing anyone can see. A future
replay supplies them anyway.

## Operator validation

**Agent smoke test, 2026-10-14, read-only against prod.** I ran `tmp/0262/rearm-dry.ts`, which is
`planT3Repair` (the fold) over the operator's 19 ground-scored runs, plus the real basemap street
lookup. Results:
- `T3 rows that would rewrite: 0`, so the fold agrees with the stored awards.
- **17 of 19** runs get a `rearmSoon` with real streets (Outlook Drive, 20 Mile Road, Stone Ridge
  Drive, Legacy Crossing Drive), and two land on unnamed ground. The other two have nothing nearby:
  the first run ever (2025-08-04), and the 2026-08-13 run, whose nearby ground had re-armed by then.
- **0 eligible.** The soonest is 144 days out. Every cell is from August 2026 or later, so nothing
  comes within 30 days of re-arming until a run in about mid-January 2027. That is correct
  behaviour, and it is why the perceptual check below cannot happen yet.

**Deployed:** Amplify job 387 (`f890263`) SUCCEED, and `gate`, `tickets` and `secret-scan` are
green. The `processactivity` Lambda (LastModified 2026-10-14T20:06:52Z) was downloaded and its
`index.mjs` contains `rearmSoon` and `nearCells`, so the next real ingest writes the field. I did not
force an ingest: sending a synthetic activity through the prod queue would permanently reveal
cells on the operator's map (D-020). The pipeline tests cover that path end to end with the real
`processActivity`.

**Not yet possible: the perceptual check.** No run, real or stored, can select the line before about
January 2027. The sentence itself is table text, already reviewed against N2 and §3.5 rule 4's
forbidden shapes in `0083`. The tests prove it renders: *"Kelp Street comes back into season in
thirteen days."* When the first no-new-ground run after mid-January 2027 shows it, the operator's
look is the one planned below.

Planned at ticket-write: In the desktop browser, open a no-new-ground run that selects the line and judge whether it reads
as an invitation, never a deadline (N2).
