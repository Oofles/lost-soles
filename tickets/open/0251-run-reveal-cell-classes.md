---
id: 251
slug: run-reveal-cell-classes
title: Serve the run's own new and re-armed cell ids to /run/:id, so beat 1 knows what to reveal
type: feature
priority: high
status: open
size: m
capability: 12-post-run-moment
depends_on: [78]
blocked_by: []
source: agent
created: 2026-10-08T19:31:14Z
started: 2026-10-13T12:05:24Z
---

## Description

Found while building `0079`. `/run/:id` is only reachable after ingest has completed, and ingest
writes the run's `ExploredCell` rows — so by the time the page opens, every cell the run touched is
already in the persisted explored set. `0079`'s reveal set, as first worded (*"cells not yet in the
persisted explored set"*), is therefore empty for every run a user can actually open, and beat 1
would burn back nothing.

`0079` generalised the seam instead: `FogMaskLayer.setReveal(cells, progress)` takes cells with arc
positions **whether or not they are persisted**, and holds the persisted ones back below their arc.
What it cannot know is **which** cells to pass. The browser's explored blob carries ids only; it
cannot tell this run's discoveries from ground an earlier run already cleared. Passing every cell
the run touched (what `0079`'s dev scrub does) fogs familiar ground at `p = 0` — which `06-ui-ux.md`
§3.2's *Familiar: no bloom, silent* row forbids.

The server knows: T6 `ExploredCell` carries `firstRunId` (and `lastRunAt` for the re-armed class,
D-120), and `0048`'s `readCells` is one `BatchGetItem` over exact keys.

Add to what `/run/:activityId` loads, server-side and ownership-checked like the rest of
`RunSummary`:

- the run's cells, recomputed from the archived trace with the domain's own `traceToCells` (never a
  client-side guess), and
- for each, its class relative to THIS run: **new** (`firstRunId == activityId`), **re-armed**
  (0048's cold verdict, as written at ingest) or **familiar**.

`0080` then passes **new ∪ re-armed** to `setReveal` — re-armed ground is already clear on the
map, so whether it belongs in the reveal set or only gets the frost flush is 0080's call and must be
settled there, not here.

## Acceptance criteria

- [ ] `RunSummary` (or a sibling payload on the same page load) carries the run's new and re-armed
      cell ids; no extra client fetch is needed to start beat 1.
- [ ] The ids come from the server's own classification — the client derives no membership.
- [ ] A run whose cells were all explored before it returns an empty new set.
- [ ] An untraced activity returns empty sets, not an error.
- [ ] Payload size for a 130-cell run is recorded in `## Resolution`.

## Notes


**Blocked 2026-10-13 on 0253:** re-armed verdict is not persisted per cell; 0253 persists it at ingest and in the fold

Filed by `0079` (D-152 finding). `0080` should depend on this.

**2026-10-13 — blocked on `0253`.** Started, then stopped on a premise check: the re-armed
verdict is not stored per cell (only T3's count), and ingest's T6 write overwrites the `lastRunAt`
it was computed from, so it cannot be recovered at read time. Operator chose to persist it at
ingest (`0253`) over serving new-only or folding on every page load. This ticket shrinks to
serving that object: read `users/<uid>/cells/<activityId>.<classes>` server-side in `runById`,
behind the same ownership check, and put it on `RunSummary`. The "recomputed from the archived
trace with `traceToCells`" wording above is superseded — the classes come from the stored
verdict, and re-projecting would also re-derive under today's `fogAlgoVersion` (`05` §3.5's
reason `appendCellsToRun` exists). Check the SSR role's S3 grant reaches `users/*/cells/`.

## Operator validation

None expected: data plumbing with nothing to look at. Smoke test against the deployed endpoint for
a real recent run: the new-cell count matches the stored `newCellCount`.
