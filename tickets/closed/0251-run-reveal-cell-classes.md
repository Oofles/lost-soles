---
id: 251
slug: run-reveal-cell-classes
title: Serve the run's own new and re-armed cell ids to /run/:id, so beat 1 knows what to reveal
type: feature
priority: high
status: closed
size: m
capability: 12-post-run-moment
depends_on: [78]
blocked_by: []
source: agent
created: 2026-10-08T19:31:14Z
started: 2026-10-13T12:05:24Z
closed: 2026-10-13T14:03:39Z
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

- [x] `RunSummary` (or a sibling payload on the same page load) carries the run's new and re-armed
      cell ids; no extra client fetch is needed to start beat 1.
      — `RunSummary.reveal: RunClasses`, read in `runById` during SSR and handed to the page as props.
- [x] The ids come from the server's own classification — the client derives no membership.
      — served verbatim from the stored verdict (0253, D-294); smoke: all 18 traced runs equal T3's counts.
- [x] A run whose cells were all explored before it returns an empty new set.
      — tested; three real runs (`0b1e21d0`, `ab00f078`, `0232ac74`) serve `new: []`.
- [x] An untraced activity returns empty sets, not an error.
      — tested (no S3 read at all); real untraced `130e1e59` serves empty sets.
- [x] Payload size for a 130-cell run is recorded in `## Resolution`.

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

**Result, 2026-10-13 — agent smoke against real AWS (nothing to look at; no operator check).**
- `tmp/0251/smoke.ts` (gitignored) scanned T3 and called the shipped `runById` with
  `defaultRunReadDeps()` for all 19 activities: **0 mismatches** — every traced run's
  `reveal.new`/`reveal.rearmed` sizes equal its stored `newCellCount`/`rearmedCellCount`
  (incl. the 5 re-armed runs, e.g. `2460ebe8` 14/63), the untraced one serves empty sets, and a
  foreign uid on a real id returns `null` (the 404).
- That smoke ran under my credentials, not the SSR role, so the role was checked separately:
  `iam simulate-principal-policy` on `LostSolesAmplifyComputeRole` for
  `users/u-x/cells/a-1.classes.json` → `s3:GetObject allowed`, `s3:PutObject implicitDeny`
  (`ReadExploredDeliveryLayerForTheBrowser`, unchanged).
- Not done: a request to the deployed `/run/:id` itself — it needs a signed-in session, and the
  two checks above cover the code path and the grant it runs under. `0080` is the first consumer
  that will show the set on screen.

## Resolution

Shrunk by `0253` to serving the stored verdict; that is what was built (`fbecae1`).

**Files.**
- `lib/runs/wire.ts` — `RunSummary.reveal: RunClasses` (type-only import from `src/domain`, so
  nothing reaches the browser bundle).
- `lib/runs/server.ts` — `runById` reads `objectKeys.runClasses(userId, row.id)` in parallel with
  the trace, only for a traced row and only after the ownership check; the key is rebuilt from the
  session uid like the trace key. Absent object → empty lists.
- `src/pipeline/explored-blob-store.ts` — the shape check split out of `readRunClasses` as
  `parseRunClasses(bytes, key)`, so the SSR reader (which reads through `lib/fog/server.ts`'s
  `getObject`, the module boundary the run-page tests stub) refuses exactly what the pipeline does.
- Tests: `lib/runs/run-page.test.ts` — six reveal-set cases (served under the session's prefix;
  all-familiar → empty new; untraced → empty with no read; traced-but-unclassified → empty, route
  still served; foreign uid reads nothing; malformed body refused). One existing test assumed the
  trace GET was the last `getObject` call and was made order-independent. Fixture in
  `run-moment.test.tsx` gained `reveal`. Full suite 3,008 green (1 skipped); boundaries gate green.

**Payload size.** Raw JSON in the RSC payload (the stored object is gzipped; the page payload
carries it as JSON): the operator's 130-cell run `7e1c7a17` (63 new, 67 familiar) → **1,156 B**.
A run with ~130 *revealed* cells is ~2.4 KB (117 new → 2,128 B; the largest, 293 + 29 → 5,817 B).
Each id costs ~18 B. Not worth a binary encoding (0253's reasoning holds).

**Decisions (no new D-xxx; within D-294).**
- *Absent object on a traced run reads as empty, not as an error.* It means "never classified",
  which since 0253's backfill should not occur; "reveal nothing" is the failure that cannot fog
  familiar ground (`06` §3.2), and the page still renders.
- *A malformed object throws* (page errors), the same as a corrupt trace JSON would. It can only
  come from a writer bug, and `repair-t3.ts` audits it.
- *No read for an untraced row* — no cells, so no object; the GET would be a certain 404.

**What went wrong.** Nothing material. The ticket's original "recompute from the archived trace"
wording was already superseded in Notes; not re-litigated.

