import { describe, expect, it } from "vitest"

import { loadRuleSet } from "./load"
import { validateRuleSet } from "./validate"
import type { RuleSkill } from "./schema"

/**
 * Assertions about the SHIPPED v1 file, ticket 0028. Separate from `validate.test.ts`,
 * which tests the validator against deliberately broken input: one file proves the rules
 * are right, the other proves the checker works. A single file conflates "our data is
 * valid" with "the validator can tell", and 0123 established that a check which only ever
 * sees good input verifies nothing.
 */

const rules = loadRuleSet(1)
const byId = (id: string): RuleSkill => {
  const s = rules.skills.find((x) => x.id === id)
  if (!s) throw new Error(`no skill row ${id}`)
  return s
}

describe("the shipped v1 registry", () => {
  it("validates clean", () => {
    expect(validateRuleSet(rules)).toEqual([])
  })

  it("ships a non-trivial registry with exactly one disabled row, and one curve", () => {
    // NOT an exact count. Ticket 0030's proof showed that adding a workout type as a pure data
    // row turned this file red — which means the suite itself was violating D-031, the property
    // it exists to enforce. An assertion that must be edited when a row is added is a code
    // change disguised as a test.
    //
    // What is worth pinning is the INVARIANT: many skills, exactly one shipped disabled
    // (Slayer, D-122), one curve. Protection against an accidental DELETION is git's job, not
    // this file's, and it is not worth breaking D-031 to buy.
    expect(rules.skills.length).toBeGreaterThanOrEqual(10)
    expect(rules.skills.filter((s) => !s.enabled).map((s) => s.id)).toEqual(["slayer"])
    expect(rules.curve.stepFormula).toBe("4 * L^2") // D-130; D-131 rejected per-skill curves
    expect(rules.curve.maxLevel).toBe(99)
  })

  it("gives every activity row a match block with all four keys and a priority", () => {
    for (const s of rules.skills.filter((x) => x.kind === "activity")) {
      expect(s.match, s.id).not.toBeNull()
      expect(Object.keys(s.match!).sort(), s.id).toEqual([
        "kinds",
        "measure",
        "requiresTrace",
        "sources",
      ])
      expect(typeof s.matchPriority, s.id).toBe("number")
    }
  })

  it("gives every meta row a null match — meta skills are never matched", () => {
    for (const s of rules.skills.filter((x) => x.kind === "meta")) {
      expect(s.match, s.id).toBeNull()
    }
  })

  it("ships Slayer disabled (D-122, no combat in MVP)", () => {
    expect(byId("slayer").enabled).toBe(false)
  })
})

describe("D-141 — Wayfaring and Vigil are distinguishable by DATA alone", () => {
  const wayfaring = byId("wayfaring")
  const vigil = byId("vigil")

  it("differs in requiresTrace, which is the entire discriminator", () => {
    expect(wayfaring.match!.requiresTrace).toBe(true)
    expect(vigil.match!.requiresTrace).toBe(false)
    expect(wayfaring.match!.requiresTrace).not.toBe(vigil.match!.requiresTrace)
  })

  it("is no longer byte-identical: displayOrder and groundMultipliers differ too", () => {
    expect(wayfaring.displayOrder).not.toBe(vigil.displayOrder)
    expect(wayfaring.groundMultipliers).not.toEqual(vigil.groundMultipliers)
  })

  it("keeps the two rows MUTUALLY EXCLUSIVE, so equal matchPriority is safe", () => {
    // This is why they may share priority 100 without the tie-break ever firing: no
    // activity is a candidate for both. 0029's totality check asserts it across the whole
    // ActivityKind x hasTrace grid; here it is asserted of the data itself.
    expect(wayfaring.matchPriority).toBe(vigil.matchPriority)
    expect(wayfaring.match!.measure).toBe(vigil.match!.measure)
    expect([wayfaring.match!.requiresTrace, vigil.match!.requiresTrace].sort()).toEqual([
      false,
      true,
    ])
  })

  it("gives Vigil FULL activity XP, identical to Wayfaring (D-132) — not half", () => {
    // 05-fog-of-war.md §3.6/§9.1 provisionally suggested "treadmill = half Wayfaring XP".
    // D-132 overrides it: full XP into a SEPARATE skill.
    expect(vigil.xpPerUnit).toBe(100)
    expect(vigil.xpPerUnit).toBe(wayfaring.xpPerUnit)
  })

  it("scores Wayfaring on ground and Vigil on none", () => {
    expect(wayfaring.groundMultipliers).toEqual({ new: 1.0, rearmed: 0.5, recent: 0.5 }) // D-120
    expect(vigil.groundMultipliers).toBeNull()
  })

  it("carries no grantsDiscovery flag — D-132's third clause needs no field", () => {
    // hasTrace:false => traceRef:null => no trace => no H3 projection => no ExploredCell
    // write => no Cartography award (05 §3.6). A flag would be a second statement of the
    // same fact, and a place for the two to disagree.
    for (const s of rules.skills) {
      expect(Object.keys(s), s.id).not.toContain("grantsDiscovery")
    }
  })

  it("keeps Vigil's name a display string, never an identifier (D-132: provisional)", () => {
    // A rename must be an edit to one attribute. If the id were the name, it would be an
    // edit to every ledger row and every SkillState key.
    expect(byId("vigil").name).toBe("Vigil")
    expect(byId("vigil").id).not.toBe(byId("vigil").name)
  })
})

describe("groundMultipliers: null is NOT {1,1,1}", () => {
  it("keeps them distinct — one denies ground, the other makes a claim about it", () => {
    const neutral = { new: 1, rearmed: 1, recent: 1 }
    expect(byId("vigil").groundMultipliers).toBeNull()
    expect(byId("vigil").groundMultipliers).not.toEqual(neutral)
    // ...and the difference survives a JSON round trip, which is how it reaches T5.
    expect(JSON.stringify(byId("vigil").groundMultipliers)).not.toBe(JSON.stringify(neutral))
  })

  it("is explicit on every row that is not ground-scored, never merely absent", () => {
    // Absent and null mean the same thing to a parser but not to a reader. A pushup
    // happens nowhere on the map, and the file should say so.
    for (const s of rules.skills) {
      expect(Object.keys(s), s.id).toContain("groundMultipliers")
    }
    expect(rules.skills.filter((s) => s.groundMultipliers !== null)).toHaveLength(1)
  })
})

describe("Constitution's 1/3 is data on the feeder rows", () => {
  it("appears as feeds[].rate on every activity skill, and nowhere else", () => {
    const activities = rules.skills.filter((s) => s.kind === "activity")
    expect(activities.length).toBeGreaterThan(0)
    for (const s of activities) {
      const feed = s.feeds.find((f) => f.skill === "constitution")
      expect(feed, s.id).toBeDefined()
      expect(feed!.rate, s.id).toBeCloseTo(1 / 3, 3)
    }
  })

  it("feeds nothing itself — 04 §1.1, and the acyclicity check depends on it", () => {
    expect(byId("constitution").feeds).toEqual([])
  })
})

describe("the log page's exercises (D-061)", () => {
  it("nests under the skill that owns them, per 02 §3.2", () => {
    // 04 §1.3's YAML sample shows a TOP-LEVEL `exercises:` list with a `skill:` back
    // reference. 02 §3.2 nests them in the skill row and is named authoritative for this
    // schema by 04 §1.3 itself. Nesting also removes the second place the mapping could
    // disagree. Recorded as a divergence in the ticket; 0031 owns the doc amendment.
    expect(byId("might").exercises?.map((e) => e.id)).toEqual(["pushup"])
    expect(byId("fortitude").exercises?.map((e) => e.id)).toEqual(["situp"])
    expect(byId("endurance").exercises?.map((e) => e.id)).toEqual(["plank"])
    expect(rules).not.toHaveProperty("exercises")
  })

  it("names each skill's measure after an exercise it actually owns", () => {
    // The link that makes `reps:<exerciseId>` resolvable without a lookup table in code.
    for (const s of rules.skills) {
      const m = s.match?.measure
      if (typeof m !== "string" || !m.includes(":")) continue
      const exerciseId = m.slice(m.indexOf(":") + 1)
      expect(s.exercises?.map((e) => e.id), s.id).toContain(exerciseId)
    }
  })
})

describe("D-189 — only running opens the map", () => {
  it("has exactly one row with revealsGround: true", () => {
    // Asserted by FILTERING rather than by naming a skill: naming one here would be the
    // string literal `no-skill-names.test.ts` forbids, and would need editing every time
    // the registry changes. The count is the invariant.
    const revealing = rules.skills.filter((s) => s.revealsGround === true)
    expect(revealing).toHaveLength(1)
    expect(revealing[0]!.match!.kinds).toContain("run")
  })

  it("requires the field on every activity row and forbids it on every meta row", () => {
    // No default, deliberately: the map never re-fogs (D-020), so a cell revealed because a
    // line was forgotten is revealed for ever.
    for (const s of rules.skills) {
      if (s.kind === "activity") expect(typeof s.revealsGround, s.id).toBe("boolean")
      else expect(s.revealsGround, s.id).toBeNull()
    }
  })

  it("gives the cycling pair no map access at all", () => {
    const cycling = rules.skills.filter((s) => s.match?.kinds?.includes("ride"))
    expect(cycling).toHaveLength(2)
    for (const s of cycling) expect(s.revealsGround, s.id).toBe(false)
  })
})

describe("cycling is rated by session parity (04 §3.2, D-189 as amended by 0158)", () => {
  const TYPICAL_RIDE_KM = 15 // the operator's actual typical ride, 2026-09-04
  const TYPICAL_RUN_XP = 885 // 8.85 km fully new, 04 §3.2's own worked example

  it("pays both cycling skills the same rate", () => {
    // As D-132 gave Vigil full Wayfaring XP rather than half: the indoor variant is not a
    // lesser version of the effort, it just has no ground under it.
    const cycling = rules.skills.filter((s) => s.match?.kinds?.includes("ride"))
    expect(cycling).toHaveLength(2)
    expect(new Set(cycling.map((s) => s.xpPerUnit)).size).toBe(1)
  })

  it("puts a typical ride within 10% of a typical run", () => {
    // The assertion is the PRINCIPLE, not the number. If someone changes xpPerUnit without
    // revisiting what a typical ride is, this fails and says why — which is what 35 XP/km
    // needed and did not have: it was set against an assumed 25 km ride and nothing caught
    // that the real figure was 15.
    const ride = rules.skills.find((s) => s.id === "roving")!
    const sessionXp = ride.xpPerUnit * TYPICAL_RIDE_KM
    const drift = Math.abs(sessionXp - TYPICAL_RUN_XP) / TYPICAL_RUN_XP
    expect(
      drift,
      `a ${TYPICAL_RIDE_KM} km ride is ${sessionXp} XP against a typical run's ${TYPICAL_RUN_XP} ` +
        `(${(drift * 100).toFixed(1)}% off). 04 §3.2's anchor is session parity: one typical hard ` +
        "session of anything is worth about as much as one of anything else. Either the rate or " +
        "TYPICAL_RIDE_KM is now wrong.",
    ).toBeLessThan(0.1)
  })
})

describe("the four distance skills are pairwise mutually exclusive", () => {
  // The property that lets all four share measure `distanceKm` at equal matchPriority without
  // the tie-break ever firing. 0029's matcher makes this operational; here it is asserted of
  // the DATA, across the whole grid, so a badly-shaped row fails before any matcher exists.
  const KINDS = ["run", "walk", "hike", "ride", "strength", "other"] as const

  const distanceSkills = rules.skills.filter(
    (s) => s.kind === "activity" && s.enabled && s.match?.measure === "distanceKm",
  )

  it("covers enough distance skills for the grid below to mean something", () => {
    // A vacuity guard, not a content assertion: with fewer than two there is no exclusivity to
    // test and every case below would pass trivially. Deliberately a floor, so adding a fifth
    // distance skill needs no edit here.
    expect(distanceSkills.length).toBeGreaterThanOrEqual(4)
  })

  for (const kind of KINDS) {
    for (const hasTrace of [true, false]) {
      it(`matches at most one distance skill for ${kind} / hasTrace=${hasTrace}`, () => {
        const candidates = distanceSkills.filter((s) => {
          const m = s.match!
          const kindOk = !m.kinds || m.kinds.length === 0 || m.kinds.includes(kind)
          const traceOk = m.requiresTrace === "any" || m.requiresTrace === hasTrace
          return kindOk && traceOk
        })
        expect(candidates.map((s) => s.id).sort()).toHaveLength(candidates.length)
        expect(candidates.length, `${kind}/${hasTrace} matched ${candidates.length}`).toBeLessThanOrEqual(1)
      })
    }
  }

  it("documents whether the traced-`other` distance gap is still open (D-190)", () => {
    // Written to survive being CLOSED. D-190 exempted `other` from the totality check because
    // no distance skill claimed it; the day someone adds a pool-swim row that stops being true,
    // and this assertion must not turn red for it — closing the gap is the schema working, not
    // a regression. So: at most one, never "exactly zero".
    const candidates = distanceSkills.filter((s) => s.match!.kinds?.includes("other"))
    expect(candidates.length).toBeLessThanOrEqual(1)
  })
})
