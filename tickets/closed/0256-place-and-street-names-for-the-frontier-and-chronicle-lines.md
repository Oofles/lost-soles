---
id: 256
slug: place-and-street-names-for-the-frontier-and-chronicle-lines
title: Place and street names for the frontier and chronicle lines
type: feature
priority: med
status: closed
size: m
capability: 12-post-run-moment
depends_on: []
blocked_by: []
source: agent
created: 2026-10-13T21:54:04Z
started: 2026-10-14T15:38:10Z
closed: 2026-10-14T15:51:21Z
---

## Description

Found closing `0083`. Both of beat 4 and beat 5's design examples name a place —
*"Unclaimed ground 1.2 km north — **Millbrook**"*, *"You returned to **Ashgrove Lane** after two hundred
and eleven days"* — and **no design doc says where a name comes from.** `0083` shipped without them
(operator decision, 2026-10-13): the frontier line reads `◇ Unclaimed ground 1.2 km north`, and the
chronicle rows that need a name (`rearmed-returned-named`, `rearm-soon-named` in
`rules/chronicle.json`) sit in the table but are never selectable, because the selector skips a row
whose placeholders have no fact to fill them.

This ticket is a **decision first, code second.** Candidate sources:

- **The basemap's own label features**, read in the browser (`queryRenderedFeatures` /
  `querySourceFeatures` on the place and road label layers near a point). No new dependency, no
  request, no cost — but only names what the loaded tiles contain at the current zoom, and the
  adventure-mode labels sit *under* the fog for unexplored places (05 §5.2), which is the point of the
  discovery beat. Naming an unexplored place in the frontier line may spoil exactly that.
- **A reverse geocoder** (Amazon Location Service, in-account; or an OSM Nominatim instance). A new
  external call, a cost line, and a privacy question — coordinates of the operator's runs leave the
  browser (`08-security-privacy.md`).
- **Server-side at ingest**, stored beside the run's classes: names for the run's re-armed ground and
  its frontier, computed once, so a Relive reads the same name (the chronicle's determinism
  requirement).

The chronicle's street names additionally need **each re-armed cell's previous `lastRunAt`** (the
"after two hundred and eleven days" gap), which ingest has in hand (`ClassifiedCell.record`) but does
not persist; `rearmInDays` needs per-cell `lastRunAt` for cells near this run.

## Acceptance criteria

- [x] A `D-xxx` records the name source, its cost, and whether naming unexplored ground spoils the
      fog's discovery beat.
- [x] The frontier line names a real place when one is known — `◇ Unclaimed ground 1.2 km north —
      Millbrook` — and reads exactly as today when none is.
- [x] A run that re-armed ground can select `rearmed-returned-named`, with the street and the gap in
      days coming from stored facts, and the same activity selects the same line on every read.
- [x] No template or code change is needed to name a place in a new row: a name is a fact like any
      other (`{street}`, `{place}`).

## Notes

`0083`'s selector already treats a missing fact as "row not eligible", so this ticket supplies facts
and touches no selection logic. The forward-looking `rearm-soon-named` row is the only one permitted
in the app (`0083` Notes) — a second needs its own decision record.

## Resolution

**Decision: D-302.** Names come from our own basemap archive (D-226) — its `places` and `roads`
layers — through one shared lookup used by both the server and the browser. No reverse geocoder: no
new service, no cost line, and no coordinates leaving the account. Naming unexplored ground is
deliberate (operator call at the start of the ticket).

**Where it diverged from the plan I proposed.** I proposed computing names "server-side at ingest".
Reading the code showed that beat 5's frontier is recomputed in the browser from the *current*
explored set every time (`0083`, D-013). There is no ingest-time frontier to name, so the frontier's
place is looked up in the browser. The chronicle's names are looked up at SSR rather than stored:
the archive filename is immutable, so a name is already a deterministic function of the coordinate.
The fact that genuinely cannot be recovered later — each re-armed cell's previous `lastRunAt` — **is**
stored at ingest. D-302 records the reasoning, and the cost: a future archive build may rename a
street on an old run's line.

**Files**
- `lib/place-names.ts` (new): tile math (2×2 block around the point), nearest-named search
  (point → vertex, line → segment, ties by name), MVT layer decode, and `PlaceNames` with a
  per-instance tile cache that does not cache a failed fetch. `basemapPlaceNames()` is the shared
  instance over `BASEMAP_ARCHIVE`. Places: `locality`/`neighbourhood` at z12 within 3 km. Roads:
  anything named at z15 within 60 m except `highway` and `rail`.
- `src/domain/discovery.ts`: `RunClasses.rearmedSince` (optional; cell → previous `lastRunAt`),
  filled by `runClassesOf` from the record the classifier already carries. Keyed in sorted order,
  so the object stays a pure function of the verdicts. Ingest and the fold both go through
  `runClassesOf`, so both write it.
- `src/pipeline/explored-blob-store.ts`: writes `rearmedSince`, and `parseRunClasses` accepts it,
  validates it, and still accepts objects without it.
- `src/domain/chronicle.ts`: `returnedTo()` picks the street the most re-armed cells lie on (ties by
  name), with that street's *shortest* gap. `daysBetween()`. `chronicleFacts` now emits string facts
  `street` and `place`, plus `rearmGapDays`. The selector is untouched, as the ticket's Notes
  predicted.
- `lib/runs/chronicle-server.ts`: `namesFor(summary, names)` → `{ place, returned, rearmGapsDays }`.
  `chronicleFor` takes it as an optional third argument.
- `app/run/[activityId]/page.tsx`: the names lookup runs in parallel with the history read and is
  capped at 1.5 s; failure or timeout logs and renders without names.
- `lib/run-moment/frontier-line.ts` and `app/run/[activityId]/run-moment.tsx`:
  `frontierText(c, place?)` appends `— <place>`. The browser looks up the place for the chosen
  cluster, keyed by `parent` so a recomputed frontier never wears a stale name. The line reads
  unnamed until the lookup lands.
- `src/pipeline/t3-repair.ts`: `auditRunClasses` reports a `rearmedSince` mismatch for a set whose
  re-armed cells have no stored `lastRunAt`, so `repair-t3.ts` is the backfill for old runs.
- `rules/chronicle.json`: notes only. `package.json`: `@mapbox/vector-tile@3.0.0` and `pbf@5.1.2`
  are now declared directly. They were already installed as maplibre's dependencies, at the same
  versions.
- Docs: `06-ui-ux.md` §3.2 beat 4 ("Where a name comes from") and beat 5 ("The name"). `D-302`.

**Tests added**
- `lib/place-names.test.ts` (10): real MVT bytes from a small in-test encoder at Point Nemo
  (D-199). Covers nearest point and nearest segment, the radius, the tie rule, motorway and rail
  exclusion, place kinds, the tile cache, and that a failed fetch is not cached.
- `chronicle.test.ts` (+5):
  - `returnedTo`, including order independence and the tie rule;
  - the shipped `rearmed-returned-named` row selected with its exact text, on every read;
  - a gap with no street leaves the row waiting;
  - a new `{place}`/`{street}` row needs no code (criterion 4).
- `chronicle-server.test.ts` (+3): `namesFor` from stored facts through to the line; same line on
  every read; an object from before `0256` names nothing.
- `discovery.test.ts`, `explored-blob-store.test.ts`, `frontier-line.test.ts`,
  `xp-replay.test.ts`: `rearmedSince` is carried, round-tripped and validated; the frontier line is
  byte-identical when no place is known; the audit flags a pre-`0256` set and the fold's plan
  supplies it. One existing `xp-replay` fixture now carries `rearmedSince` so it keeps testing the
  thing it was written to test.

**What did not go to plan**
- **Old runs are not backfilled.** 5 of the operator's 19 reveal sets have re-armed cells (177 cells),
  all written before `rearmedSince` existed, so they cannot select the named row until
  `repair-t3.ts --user <sub> --confirm` rewrites them from the fold. This session's auto-mode
  classifier refused even the dry run of that tool against production. It is handed to the operator
  below rather than worked around.
- `rearm-soon-named` still waits. It needs `rearmInDays`, which needs the `lastRunAt` of cells
  *near* the run. The run's own cells were just re-run, so every one of them is 183 days out. Filed
  as `0262` rather than widening this ticket. The skill sheet's landmark street names are now
  possible too; filed as `0263`.
- **Local gate noise**: stale `tmp/0069`–`0085` fail typecheck, `next build`, the polyline guard and
  `check-design-tokens` in the working tree. That noise was there before this change. Every guard,
  typecheck, lint and `next build` passed on a clean copy without `tmp/`.

## Operator validation

**Smoke tests (agent):**
- `PlaceNames` against the live archive on CloudFront (`tmp/0256/smoke.ts`), at public downtown
  coordinates rather than an operator route:
  - a point by Lake Eola → `Orlando`;
  - Orange Ave & Central Blvd → `South Orange Avenue`;
  - mid-lake street → `null`;
  - an offshore place → `null`.
  - Timing: four cold lookups in 440 ms, inside the page's 1.5 s budget; a warm lookup ~1 ms.
- A read-only S3 sweep of the operator's reveal sets: 19 objects, 5 with re-armed cells, none with
  `rearmedSince` (expected — they predate it).
- Full suite: 3358 passed. The one failure is the pre-existing `tmp/` polyline-guard false positive.
- Clean copy: all `amplify.yml` guards, `tsc`, `eslint` and `next build` pass, and
  `check-bundle-leak` passes.

**Perceptual (operator, desktop browser) — still owed:**
- Open a run's `/run/:id` after the deploy and let beat 5 land. Does `◇ Unclaimed ground … — <place>`
  help, or does naming ground still under the fog spoil the discovery? That is the call D-302 rests
  on.
- After the backfill (`npx vite-node --config vitest.config.ts tools/xp-replay/repair-t3.ts -- --user
  <sub>`, then the same with `--confirm`), open one of the 5 re-armed runs. Does *"You returned to
  <street> after <n> days"* name a street you recognise?

**Operator, desktop browser — verified 2026-10-15 (at the `12` audit): all perceptual checks above good.**
