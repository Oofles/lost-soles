---
id: 36
slug: strava-normalize-pure
title: strava/normalize.ts - pure, no network, no clock, streams JSON to { activity, trace }
type: feature
priority: high
status: open
size: m
capability: 05-strava-adapter
depends_on: [25, 27, 35]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
---

## Description

The migration seam. `normalize(raw, ref, job): NormalizedIngest` turns archived Strava bytes into
the canonical `{ activity, trace }` and is **the only place in the codebase that understands
Strava's wire format**.

**It is PURE: no network, no AWS SDK, no clock, no randomness.** This is not a style preference —
**the rebuild drill depends on it** (`02-data-model.md` §8.3 step 2, roadmap §4.3). A drill
replays the S3 archive years later; it **cannot call Strava**, because by then the athlete cap
(D-102/D-121) may already have removed access. At migration, the client code dies and this
function survives. Every input it needs arrives in its three arguments: `raw` (the archived
bytes), `ref` (the `RawArchiveRef`, which carries `archivedAt` — use it instead of a clock), and
`job` (which carries `userId`, `source`, `externalId` and `fetchedAt`).

Transformations, each of which is a documented trap:

- **Trace points.** Zip the index-aligned `latlng`, `time` and `altitude` streams into
  `GeoPoint[]`. **Strava's `time` stream is relative (seconds since start); `GeoPoint.t` is
  absolute epoch milliseconds** (contract conflict 2) — **the adapter converts**, using
  `start_date`. Converting down is trivial; recovering up is not. `altM` is set only if the source
  gave it and is **never synthesised**; `accuracyM` absent means unknown, **not zero**.
- **Three time fields.** `start_date` is real UTC and trustworthy — that is `startedAt`.
  `start_date_local` is local wall-clock time **serialized with a `Z` suffix that is a lie**:
  `2026-03-14T07:30:00Z` in that field means 07:30 *local*. **Strip the `Z`** and store it naive
  in `startedAtLocal`; parsing it as UTC double-shifts it. `timezone` arrives as
  `"(GMT-08:00) America/Los_Angeles"` — **strip the `(GMT±HH:MM) ` prefix** and store the bare
  IANA id, or `null`.
- **Ids stay strings.** `externalId` is the wire id verbatim; `activityId` is
  `sha256(userId:source:externalId)`, computed with a pure hash, giving idempotent re-ingest for
  free.
- **`Trace` fields.** `pointCount`, `bbox` (`[minLng, minLat, maxLng, maxLat]`), `gaps` as
  `[startIdx, endIdx]` pairs where the inter-point interval exceeds `GAP_THRESHOLD_MS`, and
  `simplified: false` — Strava's **full stream** is not lossy. `simplified` must be `true` for any
  source known lossy; it is the standing guard against the `summary_polyline` trap.
- **`revision`** is taken from `job`, not invented; `ingestedAt` comes from `ref.archivedAt`.
- `dedupeKey` is the §2.7 composite: `sha256(userId | floor(start/60) | round(distanceM/50) |
  round(elapsedS/30))` — cross-source, not just intra-source.

Kind mapping, indoor/no-GPS handling and trace sanitation are **0037**; this ticket lands the pure
shape and the time/id/stream correctness.

## Acceptance criteria

- [ ] `normalize` is synchronous, takes `(raw, ref, job)` and returns `NormalizedIngest`.
- [ ] **The T4 purity harness from 0027 passes on it**: `fetch`, the AWS SDK, `Date.now`,
      `new Date()`, `Math.random` and `crypto.randomUUID` all stubbed to **throw**, and it still
      returns a correct result.
- [ ] `src/adapters/strava/normalize.ts` imports no AWS SDK module and no HTTP client — asserted
      by a static import check, not only by the runtime stub.
- [ ] Relative `time` values become **absolute epoch milliseconds** on `GeoPoint.t`; a fixture
      whose first `time` is `0` produces `t === Date.parse(start_date)`.
- [ ] `startedAtLocal` has **no `Z` and no offset**, and for a fixture in a negative-offset zone
      its date component differs from `startedAt`'s where it should.
- [ ] `timezone` is a bare IANA id with the `(GMT±HH:MM) ` prefix stripped; a fixture with the
      prefixed form asserts the stored value is `America/Los_Angeles`, not the full string.
- [ ] A DST-boundary fixture asserts `startedAtLocal`'s date is the day the operator actually ran
      — the failure this field exists to prevent.
- [ ] `simplified` is `false` for a full stream; a synthetic lossy fixture sets it `true`.
- [ ] `gaps` are emitted as index pairs for a fixture containing a 5-minute pause, and no gap is
      emitted for a continuous trace.
- [ ] `bbox` matches the min/max of the points in `[minLng, minLat, maxLng, maxLat]` order.
- [ ] `activityId` is deterministic: the same fixture normalized twice produces byte-identical
      output, and a snapshot test locks it.
- [ ] `altM` is absent where the altitude stream is absent, and is never interpolated or defaulted
      to 0; `accuracyM` is absent, never 0.
- [ ] `ingestedAt` derives from `ref.archivedAt` and no value in the output derives from the
      wall clock.
- [ ] Everything is under `src/adapters/strava/`; the 0027 T1 grep stays green.

## Notes

The determinism snapshot is worth more than it looks: it is what lets the rebuild drill assert
that replaying the archive reproduces the same cell count and the same Total XP. If `normalize`
is not byte-deterministic, the drill can only say "roughly the same", which is not a proof of
D-101 reversibility.

`GAP_THRESHOLD_MS` is a named constant with a comment. The `gaps` array is load-bearing twice
over: the fog renderer **must not** draw a corridor across a gap, and distance **must not** be
summed across one.

Resist the temptation to reach for `Date.now()` for `ingestedAt`. It is the single most common way
this function stops being pure, and it will not be caught by review once it is buried in a helper —
only by the T4 harness, which is why the harness runs on every build.

## Operator validation

None — a pure function with no rendered surface. Its real validation is the capability `16` rebuild
drill, whose done-condition is a **pasted result**: object count, `normalize()` failure count,
final `cellCount` against `manifest.json`, and final Total XP against the snapshot. If those four
numbers are not in the capability doc, the drill did not happen — and this function is the reason
the drill is possible at all.
