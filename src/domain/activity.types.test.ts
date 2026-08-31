import { describe, expect, it } from "vitest"

import type {
  Activity,
  GeoPoint,
  NormalizedIngest,
  RawArchiveRef,
  SourceId,
  Trace,
} from "./activity"

/**
 * COMPILE-TIME assertions, ticket 0025. These are checked by `tsc --noEmit`, not by
 * vitest — the runtime `it()` blocks below exist so the file is also a normal test file
 * and so a failure is legible in CI output. A `@ts-expect-error` that stops erroring
 * fails the typecheck, which is what makes these real tests rather than comments.
 *
 * 0123's lesson applies directly and is why this file exists: "matches the spec
 * verbatim" verifies transcription, not correctness. `contract-drift.test.ts` proves the
 * transcription is faithful; THIS file proves the transcribed types actually behave as
 * the contract's reasoning requires.
 */

/** True iff A and B are exactly the same type — not merely mutually assignable. */
type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
type Expect<T extends true> = T

/* ── SourceId: closed union, widened (contract conflict #1) ─────────────────── */

// An enumerated member exists and is assignable. Deliberately not the MVP source: the
// domain's own tests should not name a vendor, and check-boundaries.mjs enforces that.
const _known: SourceId = "gpslogger"
// ...and the `(string & {})` widening genuinely works: an unlisted source is accepted
// WITHOUT editing the domain. This is D-100's operational promise, asserted rather than
// assumed — if the widening were dropped, adding a source would require a domain edit
// and T2 ("zero lines in src/domain/") would silently become false.
const _unlisted: SourceId = "garmin"
const _future: SourceId = "whatever-comes-next"

// @ts-expect-error — widened to string, but still a string. A number is not a source.
const _notAString: SourceId = 42

/* ── Activity: exactly three time fields (contract conflict #3) ─────────────── */

// Exactly two `started*` fields, no more. If someone adds `startedAtOffset` — the
// single-ISO-with-offset shape the contract explicitly rejects, because an offset loses
// DST and "which day did I run" then breaks twice a year — this line stops compiling.
type _StartedFields = Expect<
  Equals<Extract<keyof Activity, `started${string}`>, "startedAt" | "startedAtLocal">
>

// ...plus `timezone`, making three. A bare IANA id or null.
type _Timezone = Expect<Equals<Activity["timezone"], string | null>>

/* ── Activity carries `kind`, never `skill` (contract conflict #7) ──────────── */

// Which skill an activity trains is a game decision that will change; what it
// physically was is a fact. Coupling them here would drag game rules into ingestion.
type _NoSkill = Expect<Equals<Extract<keyof Activity, "skill">, never>>

/* ── Nullability that is NORMAL, not an error state ─────────────────────────── */

type _TraceRefNullable = Expect<Equals<Activity["traceRef"], string | null>>
// Null ONLY for `manual` — but the type must permit it, so the pipeline is forced to
// handle the manual case rather than assuming an archive always exists.
type _RawNullable = Expect<Equals<Activity["raw"], RawArchiveRef | null>>

/* ── Trace carries all four of gaps/simplified/bbox/pointCount (conflict #5) ── */

type _TraceKeys = Expect<
  Equals<keyof Trace, "points" | "gaps" | "simplified" | "bbox" | "pointCount">
>
type _Bbox = Expect<Equals<Trace["bbox"], [number, number, number, number]>>

/* ── GeoPoint.t is absolute epoch ms (conflict #2) ──────────────────────────── */

type _GeoT = Expect<Equals<GeoPoint["t"], number>>
// Optional means ABSENT-is-unknown, not zero. Both must stay optional.
type _GeoOptional = Expect<Equals<Extract<keyof GeoPoint, "altM" | "accuracyM">, "altM" | "accuracyM">>
const _minimalPoint: GeoPoint = { lat: 39.7, lng: -104.9, t: 1_756_000_000_000 }

/* ── The adapter boundary hands over exactly this ───────────────────────────── */

type _IngestKeys = Expect<Equals<keyof NormalizedIngest, "activity" | "trace">>

describe("the domain types behave as the contract's reasoning requires", () => {
  it("compiles — every assertion above is enforced by tsc --noEmit", () => {
    // Referenced so no-unused-vars stays quiet and the values are genuinely constructed.
    expect([_known, _unlisted, _future].every((s) => typeof s === "string")).toBe(true)
    expect(_minimalPoint.t).toBeGreaterThan(0)
    expect(typeof _notAString).toBe("number")
  })

  it("a null traceRef is a normal outcome, not an error", () => {
    // Treadmill, manual and strength all legitimately produce this. Written as a test so
    // a future reader does not "fix" the nullability into a required field.
    const treadmill: Pick<Activity, "traceRef" | "hasTrace"> = { traceRef: null, hasTrace: false }
    expect(treadmill.hasTrace).toBe(false)
  })
})
