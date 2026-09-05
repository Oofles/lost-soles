---
id: 36
slug: strava-normalize-pure
title: strava/normalize.ts - pure, no network, no clock, streams JSON to { activity, trace }
type: feature
priority: high
status: closed
size: m
capability: 05-strava-adapter
depends_on: [25, 27, 35]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
closed: 2026-09-05T23:16:53Z
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
`job` (which carries `userId`, `source`, `externalId` and the adapter-private `meta`).
**Amended at close:** `IngestJob` carries neither `fetchedAt` nor `revision` — see
`## Resolution` and D-196 for where those two actually come from.

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

- [x] `normalize` is synchronous, takes `(raw, ref, job)` and returns `NormalizedIngest`.
- [x] **The T4 purity harness from 0027 passes on it**: `fetch`, the AWS SDK, `Date.now`,
      `new Date()`, `Math.random` and `crypto.randomUUID` all stubbed to **throw**, and it still
      returns a correct result.
- [x] `src/adapters/strava/normalize.ts` imports no AWS SDK module and no HTTP client — asserted
      by a static import check, not only by the runtime stub.
- [x] Relative `time` values become **absolute epoch milliseconds** on `GeoPoint.t`; a fixture
      whose first `time` is `0` produces `t === Date.parse(start_date)`.
- [x] `startedAtLocal` has **no `Z` and no offset**, and for a fixture in a negative-offset zone
      its date component differs from `startedAt`'s where it should.
- [x] `timezone` is a bare IANA id with the `(GMT±HH:MM) ` prefix stripped; a fixture with the
      prefixed form asserts the stored value is `America/Los_Angeles`, not the full string.
- [x] A DST-boundary fixture asserts `startedAtLocal`'s date is the day the operator actually ran
      — the failure this field exists to prevent.
- [x] `simplified` is `false` for a full stream; a synthetic lossy fixture sets it `true`.
- [x] `gaps` are emitted as index pairs for a fixture containing a 5-minute pause, and no gap is
      emitted for a continuous trace.
- [x] `bbox` matches the min/max of the points in `[minLng, minLat, maxLng, maxLat]` order.
- [x] `activityId` is deterministic: the same fixture normalized twice produces byte-identical
      output, and a snapshot test locks it.
- [x] `altM` is absent where the altitude stream is absent, and is never interpolated or defaulted
      to 0; `accuracyM` is absent, never 0.
- [x] `ingestedAt` derives from `ref.archivedAt` and no value in the output derives from the
      wall clock.
- [x] Everything is under `src/adapters/strava/`; the 0027 T1 grep stays green.

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

## Resolution

**Files touched — all new work under `src/adapters/strava/`**, so criterion 14 held as written.

| File | What |
|---|---|
| `normalize.ts` | **new**, 330 lines — the whole seam |
| `normalize.test.ts` | **new**, 45 tests |
| `__fixtures__/` | **new** — 9 archived-envelope fixtures + a README explaining the geometry |
| `__snapshots__/normalize.test.ts.snap` | **new** — the determinism lock |
| `adapter.ts` | `normalize` wired up; `revision` added to `StravaIngestMeta`; a stale registration note corrected |
| `adapter.test.ts` | the "normalize is not built yet" assertion inverted |

Plus `docs/decisions/DECISIONS.md` (**D-195**, **D-196**). **739 passing**, `tsc`, `eslint`,
`check-boundaries` and `check-skills` all clean.

**Four things the ticket asked for that the codebase could not supply, and what was done.**

**1. `GAP_THRESHOLD_MS` had never been given a value — D-195.** The contract,
`01-architecture.md` §3 and `src/domain/activity.ts` all name it and describe what it protects;
none of them says how long a gap is. It had been carried as a symbol through three documents and
two reconciliations, because a symbol reads as settled. Set to **30 s** and then *measured*
against six real traces (below), which turned out to make the choice nearly free: the real
distribution is bimodal.

**2. `revision` is not on `IngestJob` — D-196.** The ticket says it is *"taken from `job`, not
invented"*, which is the right principle, but `IngestJob` (0026, contract §3) has no such field
and a pure function cannot look up how many times an activity has been edited. It went into
`StravaIngestMeta` — the same call `hasGpsHint` already gets — because only the re-ingest path
has anything to say about it, and a field on the generic job type would put one adapter's
concern into the shape every adapter's queue messages share. Absent means 1.

**3. `SourceRef.fetchedAt` is not on the job either — D-196.** The ticket describes `job` as
carrying it; the job carries `enqueuedAt`, which is the moment the job was *queued*, before
anything was fetched. Taken from `ref.archivedAt` instead: the archive PUT happens immediately
after the fetch and strictly before `normalize` runs (0039), so it is the closest true fetch
instant a pure function can see. Adding a real `fetchedAt` to `RawArchiveRef` was considered and
rejected — it changes the domain contract, 0035 and 0039 for a distinction measured in
milliseconds.

**4. The kind mapping was brought forward from 0037, by operator decision.** Asked at the start
of the session whether to emit a placeholder `other` or do the §2.6 mapping now; the operator
chose now. So `SPORT_TYPE_TO_KIND` lands here as a data table, and **0037 keeps everything
else**: indoor/no-GPS signal handling, the ignore policy (which kinds enter the ledger at all),
trace sanitation, and the end-to-end matcher test. Two rows in that table are judgement calls
worth naming — `Workout` maps to `other` rather than `strength`, because it is Strava's
catch-all for 19 modern sport types and `strength` would be a claim rather than a classification;
and `Ride` maps to `ride` rather than being dropped, because §2.6's *(ignored)* column is about
ingest policy, not physics, and letting the rules layer award nothing is the D-141 shape.

**Two things that went wrong.**

The `no-skill-names` gate (D-031) failed on a **comment**: a sentence describing the streams a
treadmill run returns named one of Strava's stream keys, which is also a skill id. The gate was
right and the comment was reworded. Worth recording because it is the second time that check has
fired on legitimate English rather than on code, and it was correct both times.

A test asserting the `dedupeKey` buckets absorb small disagreements **failed**, and the failure
was the interesting part: 3310 m and 3330 m are 20 m apart and land in different 50 m buckets.
These are buckets, not tolerances, so two recordings of one run collide only when every component
lands in the same bucket — which I-22 assumes and §2.7 does not deliver. The test now asserts the
miss explicitly rather than being tuned until it passed, and the defect is filed as **`0169`**.

**Also filed: `0170`.** While looking for a free decision number I found **`D-194` is assigned to
two different decisions** — 0032's OAuth routes and 0035's archive envelope. Six citations across
the docs and closed tickets now point at an ambiguous number. Not fixed here (renumbering a
settled decision is not this ticket's to do); the ticket proposes renumbering the later one and
adding a uniqueness check, which nothing currently has.

**On the fixtures.** All nine are real Strava response *shapes* carrying synthetic geometry, and
every coordinate is within a few km of **Point Nemo** — the oceanic pole of inaccessibility. This
repo is public (`0168`), so the guard in the test suite is an **allowlist**, asserting every
committed point is inside that box. The denylist version — "no coordinate near where the operator
runs" — cannot be written without committing where the operator runs, which is the leak, written
into the repo to prevent the leak. `0168` should probably adopt this shape; its criterion as
written asks for the denylist.

## Operator validation

**None required.** Everything here was reachable with AWS credentials and the live 0033/0034
stack, and is recorded below as smoke tests (D-181). The ticket's own text already said "None —
a pure function with no rendered surface", and deferred the real proof to capability `16`'s
rebuild drill. That is still true of the *drill*; it is not a reason to close this with nothing
checked, so `normalize()` was run against a real archived activity instead.

**1. `normalize()` on a REAL activity, end to end through `listSince` → `fetchRaw` → `normalize`.**
A 69-minute outdoor run from 2026-09-03. **No coordinates are printed** — every line is a count,
a span, a hash or a boolean.

```
envelope bytes             164977 application/json
T4 purity harness          PASS (clock, network and randomness all trapped)
kind / sourceTypeRaw       run / Run
startedAt   (real UTC)     2026-09-03T01:55:18.000Z
startedAtLocal (naive)     2026-09-02T21:55:18   Z present: false
  local date vs UTC date   2026-09-02 vs 2026-09-03      <- criterion 5, on real data
timezone (bare IANA)       America/New_York   GMT prefix present: false
ingestedAt == archivedAt   true          fetchedAt == archivedAt   true
pointCount                 4036          simplified                false
first point t == startedAt true          t is absolute epoch ms    true
trace span                 4155s vs elapsed 4155s
monotonic in time          true
bbox contains every point  true
bbox span                  1221 m N-S x 1176 m E-W   (position withheld)
points carrying altM       4036 / 4036
points carrying accuracyM  0 / 4036      (Strava sends none — absent, never 0)
byte-identical on replay   true
same activityId 5y later   true          same trace 5y later       true
ingestedAt moved with ref  true
```

The line that matters most is the third block: **a real run whose local date and UTC date differ**.
Criterion 5 asks a fixture to show that; production data shows it on the operator's most recent
run, which is how often this would have been wrong.

The last four lines are the rebuild drill in miniature — the same bytes, replayed with an
`archivedAt` of 2031, produce the identical activity and the identical trace, and only
`ingestedAt` moves.

**2. `GAP_THRESHOLD_MS` measured against six real traces, rather than asserted (D-195).**

```
points   maxΔ    p99Δ   gaps  simplified  Δ>5s  Δ>10s  Δ>30s
  3054      2s      2s     0       false     0      0      0
  1233      2s      2s     0       false     0      0      0
  1081    102s      2s     1       false     1      1      1
  3866      2s      2s     0       false     0      0      0
   640      2s      2s     0       false     0      0      0
  4036      2s      2s     0       false     0      0      0
```

**The real distribution is bimodal**, which is a better result than the threshold being
well-chosen: every normal interval is ≤2 s, and the one gap in 13,910 points is 102 s. There is
**nothing at all between 3 s and 100 s**, so any threshold in that range gives an identical
answer on real data. 30 s is safe by a wide margin in both directions, and §9.5's instruction to
measure before tuning is satisfied six runs early rather than twenty late.

Two incidental confirmations: `simplified` is `false` on every live full stream, so the
`summary_polyline` guard is not firing spuriously; and the sample rate is ~0.5 Hz, not the ~1 Hz
`05-fog-of-war.md` §2.2 states — worth knowing for the `densifyGeodesic` step, though it does not
change anything here.

**Left for the operator, in a later capability.** The one thing no script can check is whether a
trace with a real gap *renders* as a break rather than a corridor. That is capability `08`'s
first map screen, and it is already on `0037`'s operator list.
