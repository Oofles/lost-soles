import { describe, expect, it } from "vitest"

import type { ActivityKind } from "@/src/domain/activity"

import { ACTIVITY_KINDS, LOG_MODES, type LogMode, type Measure } from "./schema"

/**
 * COMPILE-TIME assertions, ticket 0028. Checked by `tsc --noEmit`.
 *
 * `schema.ts` needs the closed vocabularies as RUNTIME arrays, because the validator checks
 * values, and `src/domain/activity.ts` is types-only by design (0025). That duplication is
 * only safe if something binds the array to the union — otherwise the domain gains a
 * `kind` one day and the validator silently keeps rejecting it. These are that binding.
 */

type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
type Expect<T extends true> = T

// If `ActivityKind` gains or loses a member and ACTIVITY_KINDS is not updated, this line
// stops compiling. That is the entire justification for the array living outside the domain.
type _KindsMatchTheDomain = Expect<Equals<(typeof ACTIVITY_KINDS)[number], ActivityKind>>
type _LogModesMatch = Expect<Equals<(typeof LOG_MODES)[number], LogMode>>

// The measure families stay OPEN by design: `reps:<exerciseId>` must accept an exercise id
// that does not exist yet, or adding Burpees would edit code — the failure D-031 forbids.
type _RepsIsOpen = Expect<Equals<Extract<Measure, `reps:${string}`>, `reps:${string}`>>
type _BurpeesAlreadyFits = Expect<"reps:burpee" extends Measure ? true : false>

describe("the schema's runtime vocabularies match the domain's types", () => {
  it("compiles — every assertion above is enforced by tsc --noEmit", () => {
    expect(true).toBe(true)
  })

  it("lists every ActivityKind, in the order the domain declares them", () => {
    expect([...ACTIVITY_KINDS]).toEqual(["run", "walk", "hike", "ride", "strength", "other"])
  })

  it("closes the logMode set at four kernels (02 §3.7)", () => {
    // A fifth is the one event that legitimately requires code. Asserting the count makes
    // adding one a deliberate act with a failing test attached, not a quiet edit.
    expect(LOG_MODES).toHaveLength(4)
  })
})
