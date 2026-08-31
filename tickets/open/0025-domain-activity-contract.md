---
id: 25
slug: domain-activity-contract
title: src/domain/activity.ts - Activity, Trace, GeoPoint, ActivityKind, transcribed from the canonical contract
type: feature
priority: high
status: open
size: m
capability: 04-domain-contract-and-rules
depends_on: [12]
blocked_by: []
source: operator
created: 2026-08-30T00:00:00Z
---

## Description

Land the domain boundary. **Nothing that touches an activity may be written before this file
exists.**

Transcribe `docs/contracts/ingestion-contract.md` §2 **exactly** into `src/domain/activity.ts`:
`SourceId`, `ActivityKind`, `GeoPoint`, `Trace`, `RawArchiveRef`, `SourceRef`, `WorkoutSet`,
`Activity`, `NormalizedIngest`. **That file wins over `01-architecture.md` §3 and
`03-integrations.md` §1 wherever they differ (D-140).** Do not reconcile them again; do not
invent variants; do not "improve" a field name.

The resolutions that will feel wrong if you have only read the other two docs, and are correct:

- `SourceId` is a **closed union widened with `(string & {})`** — enumerated for documentation
  value, widened so adding a source never edits the domain (D-100).
- `GeoPoint.t` is **absolute epoch milliseconds, UTC** — never seconds-since-start. Strava's
  `time` stream is relative and **the adapter converts**. Converting down is trivial; recovering
  up is not.
- **Three time fields**: `startedAt` (ISO 8601 with a real `Z`), `startedAtLocal` (naive local
  wall clock, **no offset, no `Z`**), and `timezone` (bare IANA id or `null`, never a
  `"(GMT-07:00) "`-prefixed string). An offset is not a timezone: it loses DST, so "which day did
  I run" breaks twice a year. **All game-day bucketing uses `startedAtLocal`.**
- `activityId` is `sha256(\`${userId}:${source}:${externalId}\`)` — deterministic, so re-ingest is
  idempotent for free. Not a ULID: a ULID mints a duplicate on every webhook replay, and Strava
  retries 3x. `revision` still tracks source-side edits.
- `SourceRef.externalId` is **always a string**, because vendor ids are int64 and `JSON.parse`
  silently corrupts them past 2^53.
- `Activity` carries `kind` (what it physically was) and **never `skill`** (a game decision that
  will change). The kind-to-skill map lives in the game layer.
- `Trace` carries all four of `gaps`, `simplified`, `bbox`, `pointCount`. `gaps` stops the
  renderer drawing a corridor through a tunnel and stops distance summing across a pause.
  `simplified` is a **standing guard against the `summary_polyline` trap** (D-121.4).
- `traceRef: null` and `hasTrace: false` are **normal outcomes** — treadmill, manual, strength —
  not error states.

## Acceptance criteria

- [ ] `src/domain/activity.ts` exports every type in contract §2 with identical names and
      identical field names.
- [ ] `tsc --noEmit` passes and `grep -n ": any\|<any>\| as any" src/domain/` returns nothing.
- [ ] A lint rule or CI grep fails the build on `any` anywhere under `src/domain/`.
- [ ] `SourceId` accepts an unlisted string literal without a type error (the `(string & {})`
      widening actually works, verified by a compile-time test).
- [ ] `Activity` has exactly three time fields and **no** `startedAtOffset` or single
      ISO-with-offset field.
- [ ] `GeoPoint.t` is documented in-file as absolute epoch milliseconds.
- [ ] A `computeActivityId(userId, source, externalId)` helper exists, is pure, and a unit test
      asserts the same three inputs always produce the same id and that changing any one input
      changes it.
- [ ] `Activity` has no `skill` field and no import from any game/rules module.
- [ ] `src/domain/` imports nothing from `src/adapters/` (dependency direction test).
- [ ] The file header points at `docs/contracts/ingestion-contract.md` as the authority (D-140).

## Notes

Transcription, not design. If something in the contract looks wrong while writing this, **file a
ticket against the contract**; do not fix it in the transcription. A domain that quietly disagrees
with the contract is worse than either one being wrong, because the disagreement is invisible.

`WorkoutSet` and `Activity.sets` are carried from day one even though D-062 defers the sets UI
from the MVP — the model carries them, the UI does not render them yet.

## Operator validation

None — this is a type-only module with no runtime behaviour and nothing on screen. The visible
proof arrives at 0037, when a real Strava run becomes an `Activity` whose local start date is the
day the operator actually ran. Verified here only by `tsc` and the tests above.
