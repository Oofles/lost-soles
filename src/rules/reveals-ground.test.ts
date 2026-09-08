import { describe, expect, it } from "vitest"

import { loadRuleSet, rulesPath } from "./load"
import { matchable, revealsGround } from "./reveals-ground"
import type { RuleSkill } from "./schema"
import type { MatchableActivity } from "./select-activity-skills"

/**
 * D-189, ticket `0047`. The gate that decides whether an activity's cells are written at
 * all — and the one whose wrong answer cannot be taken back, because the map never
 * re-fogs (D-020).
 *
 * THE REGISTRY IS THE SHIPPED ONE, not a fixture. A stub would let this file assert that
 * the mechanism works while the actual YAML said something else, which is precisely the
 * failure D-189 describes: the field exists, nothing reads it, and nobody notices until
 * a ride has permanently revealed forty kilometres of road.
 */
const REGISTRY = loadRuleSet(1)

const activity = (over: Partial<MatchableActivity> = {}): MatchableActivity => ({
  kind: "run",
  hasTrace: true,
  source: { source: "gpslogger" },
  ...over,
})

describe("revealsGround — against the shipped v1 ruleset", () => {
  it("an outdoor run opens the map", () => {
    expect(revealsGround(activity({ kind: "run" }), REGISTRY)).toBe(true)
  })

  it("an outdoor walk and hike open it too — the same row matches all three", () => {
    expect(revealsGround(activity({ kind: "walk" }), REGISTRY)).toBe(true)
    expect(revealsGround(activity({ kind: "hike" }), REGISTRY)).toBe(true)
  })

  /**
   * THE ONE THE TICKET ASKS FOR BY NAME. A road ride has a real trace, real geometry and
   * would project to real cells; D-189 says it writes none of them, so the ground keeps
   * its full discovery value for the day it is run.
   */
  it("A TRACED RIDE DOES NOT — it has real cells and must write none", () => {
    expect(revealsGround(activity({ kind: "ride", hasTrace: true }), REGISTRY)).toBe(false)
  })

  it("an indoor run does not, even though it is a run", () => {
    // `requiresTrace` is the entire discriminator between the outdoor and indoor rows.
    expect(revealsGround(activity({ kind: "run", hasTrace: false }), REGISTRY)).toBe(false)
  })

  it("a strength session does not — a pushup happens nowhere on the map", () => {
    expect(revealsGround(activity({ kind: "strength", hasTrace: false }), REGISTRY)).toBe(false)
  })

  it("an activity matching nothing does not, without throwing", () => {
    // `some` over an empty list. A run from an unknown source matches no row today.
    const orphan = activity({ kind: "other", hasTrace: true })
    expect(revealsGround(orphan, REGISTRY)).toBe(false)
  })

  /**
   * The claim D-189 makes about the shipped file, asserted rather than trusted — and
   * asserted WITHOUT naming the skill, because `no-skill-names.test.ts` forbids that
   * outside the rules layer and the discipline is worth keeping here too.
   */
  it("exactly one activity row in v1 is true", () => {
    const revealing = REGISTRY.skills.filter(
      (s) => s.kind === "activity" && s.revealsGround === true,
    )
    expect(revealing).toHaveLength(1)
  })

  it("every activity row states the field, and every meta row is null (no default)", () => {
    for (const skill of REGISTRY.skills) {
      if (skill.kind === "activity") {
        expect(typeof skill.revealsGround, `${skill.id}`).toBe("boolean")
      } else {
        expect(skill.revealsGround, `${skill.id}`).toBeNull()
      }
    }
  })
})

describe("revealsGround — a missing field is a throw, never a guess (D-189)", () => {
  it("throws when a matched activity row carries no revealsGround", () => {
    const broken: RuleSkill[] = REGISTRY.skills.map((s) =>
      s.kind === "activity" && s.revealsGround === true
        ? { ...s, revealsGround: null as unknown as boolean }
        : s,
    )
    expect(() => revealsGround(activity(), { skills: broken })).toThrow(/D-189/)
  })

  it("does NOT throw for an unmatched row missing the field — only a matched one counts", () => {
    // A malformed row nobody's activity selects must not fail every ingest in the system.
    const broken: RuleSkill[] = REGISTRY.skills.map((s) =>
      s.kind === "activity" && s.match?.kinds?.includes("ride")
        ? { ...s, revealsGround: null as unknown as boolean }
        : s,
    )
    expect(revealsGround(activity({ kind: "run" }), { skills: broken })).toBe(true)
  })
})

describe("matchable", () => {
  it("lifts exactly the three fields the matcher reads, and nothing else", () => {
    const full = {
      kind: "run",
      hasTrace: true,
      source: { source: "gpslogger", sourceActivityId: "9001", sourceTypeRaw: "Run" },
      distanceM: 8369,
      elevationGainM: 120,
    } as never
    expect(matchable(full)).toEqual({
      kind: "run",
      hasTrace: true,
      source: { source: "gpslogger" },
    })
  })
})

describe("the generated JSON the Lambda reads (D-217)", () => {
  /**
   * `rules/xp-rules-v1.json` is what the ingest worker imports, because the YAML cannot be
   * read from inside a bundled Lambda and T5 does not exist until capability 09.
   * `scripts/build-rules-json.mjs --check` gates it in CI; this asserts the same thing in
   * `npm test`, so the drift is caught before the push rather than by it.
   */
  it("is byte-equivalent to the YAML it is generated from", async () => {
    const generated = (await import("@/rules/xp-rules-v1.json")).default
    expect(generated).toEqual(loadRuleSet(1))
  })

  it("sits beside its source, so the pair is obvious in a diff", () => {
    expect(rulesPath(1).replace(/\.yaml$/, ".json")).toMatch(/rules\/xp-rules-v1\.json$/)
  })
})
