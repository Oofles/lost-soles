import { describe, expect, it } from "vitest"

import { parseRuleSetFile } from "./load"
import { assertValidRuleSet, RuleValidationError, validateRuleSet } from "./validate"

/**
 * The validator against DELIBERATELY BROKEN input, ticket 0028, criterion 6.
 *
 * `xp-rules-v1.test.ts` proves the shipped data is right; this file proves the checker can
 * tell. A validator only ever run against valid input is a validator nobody has seen work —
 * the same discipline as `check-boundaries.mjs --self-test`.
 *
 * Each case starts from the REAL v1 file and breaks exactly one thing, so a passing case
 * cannot be an artefact of a hand-built fixture that was already wrong in some other way.
 */

const valid = parseRuleSetFile(1)
const clone = (): Record<string, unknown> => structuredClone(valid) as Record<string, unknown>

/** Mutate a copy of the real ruleset, and return the errors that produces. */
function broken(mutate: (r: Record<string, unknown>) => void) {
  const r = clone()
  mutate(r)
  return validateRuleSet(r)
}

const skills = (r: Record<string, unknown>) => r.skills as Record<string, unknown>[]
const find = (r: Record<string, unknown>, id: string) => {
  const s = skills(r).find((x) => x.id === id)
  if (!s) throw new Error(`fixture lost ${id}`)
  return s
}
const paths = (errs: { path: string }[]) => errs.map((e) => e.path)

/**
 * The index of a row, computed rather than written down. 0157 inserted two rows and every
 * hardcoded `skills[N]` in this file that sat after them broke — so the fixtures now derive
 * the index the same way the validator reports it.
 */
const at = (id: string): number => {
  const i = skills(clone()).findIndex((s) => s.id === id)
  if (i < 0) throw new Error(`fixture lost ${id}`)
  return i
}

describe("the real file is the baseline", () => {
  it("passes, so every failure below is caused by the mutation and nothing else", () => {
    expect(validateRuleSet(valid)).toEqual([])
  })
})

describe("criterion 6 — the seven rejections", () => {
  it("rejects an unknown measure", () => {
    const errs = broken((r) => {
      ;(find(r, "wayfaring").match as Record<string, unknown>).measure = "vibes"
    })
    expect(paths(errs)).toContain(`skills[${at("wayfaring")}].match.measure`)
    expect(errs[0]!.message).toContain("is not a measure")
  })

  it("accepts the open-ended measure forms, so a new exercise is still just a row", () => {
    // `reps:<id>` and `seconds:<id>` are extractor FAMILIES, not a fixed list — otherwise
    // adding Burpees would edit this validator, which is the failure D-031 forbids.
    const errs = broken((r) => {
      ;(find(r, "might").match as Record<string, unknown>).measure = "reps:burpee"
      ;(find(r, "might") as Record<string, unknown>).exercises = [
        { id: "burpee", label: "Burpees", entry: "count", quickValues: [10] },
      ]
    })
    expect(errs).toEqual([])
  })

  it("rejects a bare prefix with no exercise id", () => {
    const errs = broken((r) => {
      ;(find(r, "might").match as Record<string, unknown>).measure = "reps:"
    })
    expect(paths(errs)).toContain(`skills[${at("might")}].match.measure`)
  })

  it("rejects a kinds entry that is not an ActivityKind", () => {
    const errs = broken((r) => {
      ;(find(r, "wayfaring").match as Record<string, unknown>).kinds = ["run", "teleport"]
    })
    expect(paths(errs)).toContain(`skills[${at("wayfaring")}].match.kinds[1]`)
    expect(errs[0]!.message).toContain("is not an ActivityKind")
  })

  it("rejects a sources entry that is not a source id SHAPE", () => {
    const errs = broken((r) => {
      ;(find(r, "wayfaring").match as Record<string, unknown>).sources = ["Not A Source"]
    })
    expect(paths(errs)).toContain(`skills[${at("wayfaring")}].match.sources[0]`)
  })

  it("ACCEPTS an unenumerated source id, because SourceId is open (D-100)", () => {
    // The counterpart to the case above, and the more important of the two. Enforcing the
    // enumerated members would make adding a source a code change — precisely what the
    // `(string & {})` widening exists to prevent.
    const errs = broken((r) => {
      ;(find(r, "wayfaring").match as Record<string, unknown>).sources = ["garmin"]
    })
    expect(errs).toEqual([])
  })

  it("rejects requiresTrace outside {true, false, any}", () => {
    const errs = broken((r) => {
      ;(find(r, "wayfaring").match as Record<string, unknown>).requiresTrace = "maybe"
    })
    expect(paths(errs)).toContain(`skills[${at("wayfaring")}].match.requiresTrace`)
  })

  it("rejects a duplicate skillId, naming where it was first defined", () => {
    const errs = broken((r) => {
      find(r, "vigil").id = "wayfaring"
    })
    expect(errs.some((e) => e.message.includes("duplicate skillId"))).toBe(true)
    expect(errs.some((e) => e.message.includes(`skills[${at("wayfaring")}]`))).toBe(true)
  })

  it("rejects a feeds[].skill that resolves to nothing", () => {
    const errs = broken((r) => {
      ;(find(r, "wayfaring").feeds as Record<string, unknown>[])[0]!.skill = "nonesuch"
    })
    expect(paths(errs)).toContain(`skills[${at("wayfaring")}].feeds[0].skill`)
    expect(errs[0]!.message).toContain("does not resolve")
  })

  it("rejects a feeds[].skill that resolves to an ACTIVITY row", () => {
    // Check 1 is not merely "the id exists" — feeds may only target meta skills, or XP
    // would propagate sideways between activity skills.
    const errs = broken((r) => {
      ;(find(r, "wayfaring").feeds as Record<string, unknown>[])[0]!.skill = "might"
    })
    expect(errs[0]!.message).toContain("kind: activity")
  })

  it("rejects a cycle in feeds, naming the loop", () => {
    const errs = broken((r) => {
      find(r, "constitution").feeds = [{ skill: "cartography", rate: 1 }]
      find(r, "cartography").feeds = [{ skill: "constitution", rate: 1 }]
    })
    const cycle = errs.find((e) => e.message.includes("cycle"))
    expect(cycle).toBeDefined()
    expect(cycle!.message).toMatch(/constitution|cartography/)
  })

  it("catches a SELF-feed, which is the shortest cycle and the easiest to miss", () => {
    const errs = broken((r) => {
      find(r, "constitution").feeds = [{ skill: "constitution", rate: 1 }]
    })
    expect(errs.some((e) => e.message.includes("cycle"))).toBe(true)
  })
})

describe("D-189 — revealsGround is required, never defaulted", () => {
  it("rejects an activity row that omits it", () => {
    // The reason it is required rather than defaulted: the map never re-fogs (D-020), so a
    // cell revealed because a line was forgotten is revealed for ever. Whichever way a
    // default fell, it would be wrong for half the rows.
    const errs = broken((r) => {
      delete find(r, "wayfaring").revealsGround
    })
    expect(paths(errs)).toContain(`skills[${at("wayfaring")}].revealsGround`)
    expect(errs[0]!.message).toContain("no default")
  })

  it("rejects a non-boolean on an activity row", () => {
    const errs = broken((r) => {
      find(r, "roving").revealsGround = "sometimes"
    })
    expect(paths(errs)).toContain(`skills[${at("roving")}].revealsGround`)
  })

  it("rejects it being set on a meta row, which never matches", () => {
    const errs = broken((r) => {
      find(r, "cartography").revealsGround = true
    })
    expect(errs.some((e) => e.message.includes("must be null on a `kind: meta` row"))).toBe(true)
  })

  it("accepts a second revealing skill — this is data, not a hardcoded exception", () => {
    // Rucking, trail running, a walking skill split out of Wayfaring: any of them turns the
    // map on by setting one field. If this case failed, `revealsGround` would be a disguised
    // special case for running rather than a property of a skill.
    const errs = broken((r) => {
      find(r, "roving").revealsGround = true
    })
    expect(errs).toEqual([])
  })
})

describe("structural rules the schema depends on", () => {
  it("requires a match block on every activity row (D-141)", () => {
    const errs = broken((r) => {
      find(r, "wayfaring").match = null
    })
    expect(errs[0]!.message).toContain("requires a match block")
  })

  it("refuses a match block on a meta row — meta skills are never matched", () => {
    const errs = broken((r) => {
      find(r, "cartography").match = {
        kinds: ["run"],
        requiresTrace: "any",
        sources: "any",
        measure: "cells",
      }
    })
    expect(errs.some((e) => e.message.includes("must be null on a `kind: meta` row"))).toBe(true)
  })

  it("requires a matchPriority on every activity row", () => {
    const errs = broken((r) => {
      delete find(r, "wayfaring").matchPriority
    })
    expect(paths(errs)).toContain(`skills[${at("wayfaring")}].matchPriority`)
  })

  it("requires a feeds rate — a share is never a constant in the scorer", () => {
    const errs = broken((r) => {
      delete (find(r, "wayfaring").feeds as Record<string, unknown>[])[0]!.rate
    })
    expect(paths(errs)).toContain(`skills[${at("wayfaring")}].feeds[0].rate`)
  })

  it("rejects an unknown logMode — the four kernels are a closed set (02 §3.7)", () => {
    const errs = broken((r) => {
      find(r, "wayfaring").logMode = "vibes"
    })
    expect(paths(errs)).toContain(`skills[${at("wayfaring")}].logMode`)
  })
})

describe("reporting", () => {
  it("returns EVERY error, so a broken file takes one edit rather than three builds", () => {
    const errs = broken((r) => {
      ;(find(r, "wayfaring").match as Record<string, unknown>).measure = "vibes"
      ;(find(r, "vigil").match as Record<string, unknown>).requiresTrace = "maybe"
      find(r, "might").logMode = "nonsense"
    })
    expect(errs.length).toBeGreaterThanOrEqual(3)
  })

  it("throws with every path in the message, via the seeder's entry point", () => {
    expect(() => assertValidRuleSet({ skills: [], curve: undefined })).toThrow(RuleValidationError)
    try {
      assertValidRuleSet(clone3())
      expect.unreachable("must throw")
    } catch (err) {
      expect(err).toBeInstanceOf(RuleValidationError)
      expect((err as RuleValidationError).errors.length).toBeGreaterThan(0)
      expect((err as Error).message).toContain(`skills[${at("wayfaring")}].match.measure`)
    }
  })
})

function clone3(): Record<string, unknown> {
  const r = clone()
  ;(find(r, "wayfaring").match as Record<string, unknown>).measure = "vibes"
  return r
}
