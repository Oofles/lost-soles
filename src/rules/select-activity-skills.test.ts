import { describe, expect, it } from "vitest"

import { runWithPurityTraps } from "@/src/purity/traps"

import { loadRuleSet } from "./load"
import { ACTIVITY_KINDS, type RuleSkill } from "./schema"
import { selectActivitySkills, type MatchableActivity } from "./select-activity-skills"

/**
 * Ticket 0029. Tests run against the REAL v1 registry wherever possible — a hand-built
 * fixture proves the matcher agrees with itself, not that it scores the shipped ruleset.
 * Synthetic rows appear only where the shipped file cannot express the case (a deliberate
 * tie, a meta row with a match block).
 */

const rules = loadRuleSet(1)

const activity = (
  kind: MatchableActivity["kind"],
  hasTrace: boolean,
  source = "gpslogger",
): MatchableActivity => ({ kind, hasTrace, source: { source } })

const ids = (skills: RuleSkill[]) => skills.map((s) => s.id).sort()

/** Skill ids appear in TEST files only — `no-skill-names.test.ts` exempts these by design. */
describe("the D-132 case, which is the whole point (D-141)", () => {
  it("selects Wayfaring for a run with a trace", () => {
    expect(ids(selectActivitySkills(activity("run", true), rules))).toEqual(["wayfaring"])
  })

  it("selects Vigil for the same run without one", () => {
    expect(ids(selectActivitySkills(activity("run", false), rules))).toEqual(["vigil"])
  })

  it("does it with no branch in the matcher naming either skill", () => {
    // The mechanical version lives in `no-skill-names.test.ts`, which greps all of src/. This
    // asserts the narrower thing directly: the matcher's own source names no skill.
    const src = readMatcherSource()
    for (const id of rules.skills.map((s) => s.id)) {
      expect(src, `matcher names ${id}`).not.toContain(`"${id}"`)
    }
  })

  it("selects Roving for a traced ride and Cadence for an indoor one (D-189)", () => {
    expect(ids(selectActivitySkills(activity("ride", true), rules))).toEqual(["roving"])
    expect(ids(selectActivitySkills(activity("ride", false), rules))).toEqual(["cadence"])
  })
})

describe("one skill per MEASURE, not one skill overall", () => {
  it("returns all three strength skills for one strength session", () => {
    // The failure this guards: a flat "best match" would return one skill and silently drop
    // two thirds of a strength session's XP, while every single-skill test kept passing.
    expect(ids(selectActivitySkills(activity("strength", false), rules))).toEqual([
      "endurance",
      "fortitude",
      "might",
    ])
  })

  it("returns exactly one distance skill for a run", () => {
    const selected = selectActivitySkills(activity("run", true), rules)
    expect(selected.filter((s) => s.match!.measure === "distanceKm")).toHaveLength(1)
  })

  it("never returns two skills sharing a measure, anywhere on the grid", () => {
    for (const kind of ACTIVITY_KINDS) {
      for (const hasTrace of [true, false]) {
        const selected = selectActivitySkills(activity(kind, hasTrace), rules)
        const measures = selected.map((s) => s.match!.measure)
        expect(new Set(measures).size, `${kind}/${hasTrace}`).toBe(measures.length)
      }
    }
  })
})

describe("the filters", () => {
  it("treats empty or absent `kinds` as ANY, not as none", () => {
    // Backwards would silently stop every skill matching, and a fixture that always sets
    // `kinds` explicitly would never notice.
    const anyKind = withRow({ ...distanceRow("catch-all"), match: { ...distanceMatch(), kinds: [] } })
    for (const kind of ACTIVITY_KINDS) {
      expect(ids(selectActivitySkills(activity(kind, true), anyKind))).toContain("catch-all")
    }
  })

  it("treats `sources: any` as matching any SourceId, enumerated or not", () => {
    // Deliberately not naming the MVP vendor: D-188 keeps test files inside the D-100 grep,
    // and this test has no need of that name — which is the point of the rule.
    for (const source of ["gpslogger", "health-connect", "garmin", "not-invented-yet"]) {
      expect(ids(selectActivitySkills(activity("run", true, source), rules))).toEqual(["wayfaring"])
    }
  })

  it("honours an explicit sources allowlist", () => {
    const narrowed = withRow({
      ...distanceRow("only-one-source"),
      match: { ...distanceMatch(), sources: ["gpslogger"] },
    })
    expect(ids(selectActivitySkills(activity("run", true, "gpslogger"), narrowed))).toContain(
      "only-one-source",
    )
    expect(ids(selectActivitySkills(activity("run", true, "manual"), narrowed))).not.toContain(
      "only-one-source",
    )
  })

  it('matches both hasTrace values on requiresTrace: "any"', () => {
    const both = withRow({
      ...distanceRow("either-way"),
      match: { ...distanceMatch(), requiresTrace: "any" },
    })
    expect(ids(selectActivitySkills(activity("run", true), both))).toContain("either-way")
    expect(ids(selectActivitySkills(activity("run", false), both))).toContain("either-way")
  })

  it("never returns a meta skill, even one wrongly given a match block", () => {
    // The validator rejects this shape, so it can only arrive from a hand-built registry —
    // but the matcher must not depend on the validator having run.
    const sneaky = withRow({
      ...distanceRow("pretend-meta"),
      kind: "meta",
      match: distanceMatch(),
    })
    expect(ids(selectActivitySkills(activity("run", true), sneaky))).not.toContain("pretend-meta")
  })

  it("never returns a disabled row", () => {
    const off = withRow({ ...distanceRow("switched-off"), enabled: false })
    expect(ids(selectActivitySkills(activity("run", true), off))).not.toContain("switched-off")
  })

  it("returns a row the moment it is enabled, and stops when it is not", () => {
    // Slayer is the shipped `enabled: false` row. Flipping it is not enough on its own — it is
    // `kind: meta` — so this uses a synthetic activity row to test the flag in isolation.
    const row = distanceRow("toggleable")
    expect(ids(selectActivitySkills(activity("run", true), withRow({ ...row, enabled: true })))).toContain("toggleable")
    expect(ids(selectActivitySkills(activity("run", true), withRow({ ...row, enabled: false })))).not.toContain("toggleable")
  })
})

describe("determinism and the tie-break", () => {
  it("breaks a tie at equal matchPriority on skillId ASCENDING", () => {
    // Asserted against BOTH input orders, so a pass cannot come from the array's order. That
    // is the difference between testing the tie-break and testing the fixture.
    const a = { ...distanceRow("aaa"), match: { ...distanceMatch(), requiresTrace: true as const } }
    const z = { ...distanceRow("zzz"), match: { ...distanceMatch(), requiresTrace: true as const } }

    const forwards = selectActivitySkills(activity("run", true), { skills: [a, z] })
    const backwards = selectActivitySkills(activity("run", true), { skills: [z, a] })

    expect(ids(forwards)).toEqual(["aaa"])
    expect(ids(backwards)).toEqual(["aaa"])
  })

  it("prefers higher matchPriority over the alphabetical tie-break", () => {
    const a = { ...distanceRow("aaa"), matchPriority: 1 }
    const z = { ...distanceRow("zzz"), matchPriority: 999 }
    expect(ids(selectActivitySkills(activity("run", true), { skills: [a, z] }))).toEqual(["zzz"])
  })

  it("runs with the clock and RNG stubbed to throw (02 §3.8 check 4)", () => {
    // Replay soundness (04 §7.4): a recomputation must select the same skills as the original
    // run. Reading a clock would make the answer depend on WHEN it ran.
    const selected = runWithPurityTraps("selectActivitySkills()", "test", () =>
      selectActivitySkills(activity("strength", false), rules),
    )
    expect(ids(selected)).toEqual(["endurance", "fortitude", "might"])
  })

  it("returns the same answer twice, in the same order", () => {
    const once = selectActivitySkills(activity("strength", false), rules)
    const twice = selectActivitySkills(activity("strength", false), rules)
    expect(once.map((s) => s.id)).toEqual(twice.map((s) => s.id))
  })
})

describe("totality across the whole grid", () => {
  for (const kind of ACTIVITY_KINDS) {
    for (const hasTrace of [true, false]) {
      it(`is total for ${kind} / hasTrace=${hasTrace}`, () => {
        // Total means it ANSWERS — never throws, never returns undefined — for every cell,
        // including the ones no skill claims. A matcher that throws on an unclassified
        // activity would take down ingestion for a kind nobody had thought about.
        const selected = selectActivitySkills(activity(kind, hasTrace), rules)
        expect(Array.isArray(selected)).toBe(true)
        for (const s of selected) expect(s.kind).toBe("activity")
      })
    }
  }

  it("measures NO DISTANCE for a traced `other` — a known, deliberate gap (D-190)", () => {
    // `other` is the catch-all kind. 02 §3.7 says an open-water swim gets its OWN row when
    // someone adds it, so no distance skill claims `other` today. Asserted so the gap is
    // visible rather than discovered later as a scoring bug.
    //
    // Note what it DOES return: the three strength skills, because their `kinds` includes
    // `other` and their `requiresTrace` is `any`. They will extract zero units from an
    // activity with no `sets`, so nothing is mis-scored — but "matches nothing" would have
    // been the wrong description of this gap, and writing it that way first is how a test
    // ends up asserting a fiction.
    const selected = selectActivitySkills(activity("other", true), rules)
    expect(selected.filter((s) => s.match!.measure === "distanceKm")).toEqual([])
    expect(ids(selected)).toEqual(["endurance", "fortitude", "might"])
  })
})

/* ── fixture helpers ───────────────────────────────────────────────────────────────────── */

function distanceMatch() {
  return { kinds: ["run" as const], requiresTrace: true as const, sources: "any" as const, measure: "distanceKm" as const }
}

function distanceRow(id: string): RuleSkill {
  return {
    id,
    name: id,
    kind: "activity",
    enabled: true,
    displayOrder: 999,
    logMode: "trace",
    unit: "km",
    match: distanceMatch(),
    matchPriority: 100,
    xpPerUnit: 1,
    softCapUnits: null,
    sanityCeilingUnits: null,
    minUnitsForCredit: 0,
    groundMultipliers: null,
    revealsGround: false,
    feeds: [],
  }
}

/** The shipped registry plus one synthetic row — real data, one controlled variable. */
function withRow(row: RuleSkill): { skills: RuleSkill[] } {
  return { skills: [...rules.skills, row] }
}

function readMatcherSource(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { readFileSync } = require("node:fs") as typeof import("node:fs")
  return readFileSync(new URL("./select-activity-skills.ts", import.meta.url).pathname, "utf8")
}
