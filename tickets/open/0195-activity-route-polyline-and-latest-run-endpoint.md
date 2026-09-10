---
id: 195
slug: activity-route-polyline-and-latest-run-endpoint
title: Persist the per-activity route polyline (S-7) and serve the latest run as GeoJSON
type: feature
priority: high
status: open
size: m
capability: 08-map-and-fog-renderer
depends_on: []
blocked_by: []
source: agent
created: 2026-09-10T22:06:02Z
started: 2026-09-10T22:08:01Z
---

## Description

**`0057` cannot be built, and neither can `0085`.** Both draw a run's route from "the stored
polyline object per activity". That object is designed and never written.

`02-data-model.md` §5.1 lists it as access pattern **S-7** — *"Trace polyline on activity detail →
`traces/<activityId>.polyline.gz` → one immutable GET"* — and §2.9's rebuild-drill step 4 writes it
alongside the cell set. Nothing implements either half:

- `src/adapters/strava/normalize.ts:492` sets `traceRef: null` with a comment saying the pipeline
  fills it in. `src/pipeline/persist.ts:167` passes `activity.traceRef` straight through, so the
  T3 column is null on every row ever written.
- No object is ever `PutObject`ed under `traces/`.
- No endpoint serves one. `app/api/` has fog, auth and ticket-capture routes only.
- The client cannot enumerate activities at all — `generateClient` appears nowhere in `app/`,
  `components/` or `lib/`, and `/chronicle` and `/run/[activityId]` are still `<Stub>`.

**No ticket in the backlog covers S-7.** This one does. It is `source: agent`, filed mid-session
while picking up `0057`, and it is deliberately the smallest thing that unblocks it: write the
artefact, and serve exactly one of them.

### The artefact is the SEGMENTS, and it is not called a polyline

`traceToCells` (`src/domain/fog.ts`) already computes precisely the geometry that should be
stored. §2.2 steps 1–3 split the trace on gaps, clean it, collapse dwells and split on implausible
jumps (D-212), leaving `segments: GeoPoint[][]` — and step 5 measures every candidate cell against
*those* segments. It is a local `const` today, thrown away after the filter runs.

Storing it has three properties worth having:

1. **The drawn route and the revealed ground come from one computation.** A second sanitisation
   path would drift, and the two would disagree about where the runner was.
2. **`0057`'s criterion 8 — "no chord drawn across the gap" — is true by construction.** The
   joining chords are not filtered out of this array; they never enter it. `fog.ts`'s own comment
   says so: *"Only the joining chords — the gaps and the implausible jumps — are absent from this
   list, which is exactly how 'the chord contributes no distance' is implemented: it is not
   skipped, it never exists."*
3. It is a GeoJSON `MultiLineString` with no conversion — one line per segment.

**The key in `02` §5.1 cannot be used as written.** `scripts/check-boundaries.mjs`'s STRICT tier
bans `/polyline/i` throughout `src/domain` and `src/pipeline` (D-121, D-100), in code *and* in
prose. A writer in `src/pipeline` holding the string `traces/<id>.polyline.gz` fails CI, and the
available dodges — defining the key in `lib/` and importing it, or an exemption — are the
"guard that has to be dodged is a guard that gets disabled" failure that `check-design-tokens.mjs`
and `.githooks/pre-commit` both warn about in their own comments.

**There is already a settled precedent for exactly this collision.** §2.2's pseudocode called
step 5's helper `distancePointToPolyline`; the gate caught it, and `05-fog-of-war.md` §2.2 *"was
corrected to match rather than the reverse"` — the argument is not a polyline, it is the list of
segments step 3 produced. The same correction applies here, and for the same reason: D-121's
substance is that a `summary_polyline` is a **degraded** trace which permanently corrupts a map
that cannot re-fog, so naming our own full-fidelity artefact after it is the confusion the guard
exists to prevent.

So the key is **`users/<uid>/traces/<activityId>.segments.json.gz`**, and `02-data-model.md` §5.1
is amended to match, with a `D-xxx` recording it. The `users/<uid>/` prefix is not a second
divergence: `explored-blob-store.ts:115-117` already records that everything the user owns lives
there *"(`02` §6.1, `05` §7.3, including `traces/`)"*, and the worker's S3 grant is scoped to it.

### Where the write goes

Between `blobs` and `persist`, as its own phase, for the reason `INGEST_PHASES` gives for `cells`
and `blobs` sitting where they do: above the transaction, so a failure leaves the receipt
`PROCESSING` with no `Activity` row, and redelivery repeats the whole set idempotently. A
deterministic key makes the `PutObject` naturally idempotent.

`traceRef` then reaches T3 the only way it can — `processActivity` hands `persistActivity` an
activity with the key set, rather than the null `normalize()` produced.

### What is served

**One endpoint, `GET /api/runs/latest`**, shaped exactly like `app/api/fog/route.ts`: `dynamic =
"force-dynamic"`, uid re-derived from the verified session via `currentUserId()` and **never** read
from the query string, body or a header (`08-security-privacy.md` §5.3), 404 byte-identical to
`middleware.ts`'s signed-out response.

It queries T3's `byUserAndStart` index (`ScanIndexForward: false`, `Limit: 1`) for the caller's most
recent activity with a non-null `traceRef`, GETs the object, and returns a GeoJSON
`FeatureCollection` with one `MultiLineString` feature carrying `activityId` and `startedAt`.

**The latest run only, not the whole history.** `0057`'s criteria 4 and 5 both name *"the latest
run"*, and `0085` owns the permanent accumulated web of every past route in capability 12. A list
endpoint built now would be built against no client that can page it.

## Acceptance criteria

- [ ] `src/domain/fog.ts` exports the sanitised segments — §2.2 steps 1–3 — and `traceToCells`
      consumes that same function rather than computing them a second time. A test asserts the
      cell set is byte-identical to what it was before the extraction.
- [ ] The word `polyline` appears nowhere under `src/domain` or `src/pipeline`, and
      `node scripts/check-boundaries.mjs` passes.
- [ ] The ingest pipeline writes `users/<uid>/traces/<activityId>.segments.json.gz` — gzipped
      GeoJSON `MultiLineString`, one line per segment — as its own phase between `blobs` and
      `persist`.
- [ ] A trace that produced a split writes more than one line, and no line joins two segments'
      endpoints. Asserted against `0045`'s split fixture.
- [ ] An activity with no trace (treadmill, manual, strength) writes no object and keeps
      `traceRef: null`. That is a normal outcome, not an error.
- [ ] `persistActivity` writes the object's key to T3's `traceRef` for a traced activity, and a
      test asserts a non-null value reaches the item — the column is null on every row today.
- [ ] Re-delivering the same message overwrites the same key and changes nothing observable.
- [ ] `GET /api/runs/latest` returns the most recent traced activity's geometry as a GeoJSON
      `FeatureCollection`, and 404s for a signed-out caller.
- [ ] The route derives the uid from the session only. A test asserts a uid supplied in the query
      string is ignored.
- [ ] A caller with no traced activity at all gets a well-formed empty `FeatureCollection`, not a
      404 and not a 500 — "no runs yet" is the first-load state, not an error.
- [ ] `02-data-model.md` §5.1's S-7 row names the key that is actually written, and a `D-xxx`
      records why it is not the one the doc shipped with.

## Notes

**Deliberately not in scope**, and each is someone else's ticket:

- The permanent trace layer of every past route — `0085`, capability 12.
- Any Amplify Data client on the browser, or a real `/chronicle` list. This endpoint is a server
  route precisely so that neither is needed yet.
- Backfilling `traceRef` on the rows already written. Those activities' raw bytes are archived and
  `0102`/`0103`'s rebuild drill is the mechanism; a one-off backfill script here would be a second
  one. **A consequence worth stating plainly: until a replay runs, `/api/runs/latest` answers with
  an empty collection on this account, because every existing row has `traceRef: null`.** The
  smoke test at close has to import an activity through the queue to have anything to serve.
- Compression choice beyond `gzip`. §5.1 says one immutable GET; the object is a few KB.

**Capability 08, not 06.** The write lands in capability 06's pipeline, which is closed and
audited — but the deliverable is "the map can draw a route", this is 08's discovered work, and
filing it into 06 would re-open an audited capability and fail its `capability-tickets-closed`
check. `AUDIT.md` §4's *"did this capability change anything an earlier one depends on"* is the
mechanism built for exactly this, and 08's audit is where it gets re-validated.

## Operator validation

TODO — written at close.
