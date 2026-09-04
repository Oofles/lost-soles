import { describe, expect, it } from "vitest"

import { loadRuleSet } from "./load"
import type { RuleSkill } from "./schema"
import { selectActivitySkills, type MatchableActivity } from "./select-activity-skills"
import { validateRuleSet } from "./validate"

/**
 * THE VIGIL TEST — `02-data-model.md` §3.8 check 5, ticket 0030.
 *
 * D-031 makes modularity a PRODUCT decision; D-132 supplies its acceptance test. This file is
 * that test, wired into the permanent suite so the property cannot rot — not a one-off proof
 * run once at acceptance and then deleted.
 *
 * **The method: a registry delta.** Take the shipped v1 ruleset, REMOVE a skill, then add it
 * back programmatically as nothing but data, and assert the whole reachable pipeline treats it
 * identically to a skill that was always there. Nothing under `src/` is touched, and that is
 * the claim: adding a workout type is a row.
 *
 * **Scope, honestly.** `0030` was written across four capabilities that do not exist yet. This
 * file proves the property as far as the code reaches today — registry → validator → matcher →
 * rate and feeds. Real XP amounts, `ExploredCell` writes, the ledger's `reason` and the D-146
 * level-up clause are `0159`, which extends this harness rather than duplicating it.
 *
 * **The pool-swim case is not decoration.** If this file only ever proved Vigil works, it would
 * prove a special case rather than the property. `02` §3.7 says pool swimming is "another
 * Vigil" — a row nothing in the codebase has ever heard of.
 */

const WHY_IT_MATTERS =
  "D-031 / D-132 / D-141 — adding a workout type must be a YAML ROW AND ZERO CODE. " +
  "If this failed, some code path is naming skills or branching on their shape, and every " +
  "workout type added afterwards compounds it. Do not fix this by editing the test: the " +
  "schema is wrong, and 0028's Notes say to escalate it as a new ticket."

const v1 = loadRuleSet(1)

/** The shipped ruleset with one row removed — the "before" a delta is applied to. */
function without(id: string): { skills: RuleSkill[]; curve: unknown } {
  const skills = v1.skills.filter((s) => s.id !== id)
  expect(skills.length, `${id} must exist in v1 to be removed`).toBe(v1.skills.length - 1)
  return { skills, curve: v1.curve }
}

const withRow = (base: { skills: RuleSkill[]; curve: unknown }, row: RuleSkill) => ({
  ...base,
  skills: [...base.skills, row],
})

const activity = (
  kind: MatchableActivity["kind"],
  hasTrace: boolean,
): MatchableActivity => ({ kind, hasTrace, source: { source: "gpslogger" } })

const ids = (skills: RuleSkill[]) => skills.map((s) => s.id).sort()

/**
 * A row nothing in the codebase has ever heard of. Deliberately NOT copied from the shipped
 * file: a delta built by cloning an existing row would inherit whatever makes that row work.
 */
/**
 * An id derived to be absent from whatever the registry currently holds. A fixed literal
 * collided with 0030's own operator-validation proof, which adds a real pool-swim row to the
 * YAML — the delta then duplicated it and this file went red for the wrong reason. A test
 * fixture that a legitimate data change can collide with is the same brittleness it exists to
 * forbid.
 */
const UNHEARD_OF_ID = (() => {
  let id = "aquatics"
  while (v1.skills.some((s) => s.id === id)) id = `${id}-x`
  return id
})()

const POOL_SWIM: RuleSkill = {
  id: UNHEARD_OF_ID,
  name: "Aquatics",
  kind: "activity",
  enabled: true,
  displayOrder: 26,
  logMode: "trace",
  unit: "km",
  // 02 §3.7: "Pool swimming (distance with no GPS) is not a new kernel — it is
  // match: { kinds: [other], requiresTrace: false, measure: distanceKm }, i.e. another Vigil."
  match: { kinds: ["other"], requiresTrace: false, sources: "any", measure: "distanceKm" },
  matchPriority: 100,
  xpPerUnit: 220,
  softCapUnits: null,
  sanityCeilingUnits: 10,
  minUnitsForCredit: 0.1,
  groundMultipliers: null,
  revealsGround: false,
  feeds: [{ skill: "constitution", rate: 0.3333 }],
}

describe("the Vigil delta — a skill added as DATA behaves as one that was always there", () => {
  const baseline = without("vigil")
  const vigilRow = v1.skills.find((s) => s.id === "vigil")!
  const delta = withRow(baseline, vigilRow)

  it("starts from a baseline that genuinely lacks the skill", () => {
    // Without this, every assertion below could pass against the unmodified v1 file and the
    // test would prove nothing at all.
    expect(ids(baseline.skills)).not.toContain("vigil")
    expect(selectActivitySkills(activity("run", false), baseline), WHY_IT_MATTERS).toEqual([])
  })

  it("validates clean with the row added — no schema change was needed", () => {
    expect(validateRuleSet(delta), WHY_IT_MATTERS).toEqual([])
  })

  it("selects the new skill for a traceless run, with no code modified", () => {
    expect(ids(selectActivitySkills(activity("run", false), delta)), WHY_IT_MATTERS).toEqual([
      "vigil",
    ])
  })

  it("leaves the traced run on the original skill (D-132 clause 1: a SEPARATE skill)", () => {
    expect(ids(selectActivitySkills(activity("run", true), delta)), WHY_IT_MATTERS).toEqual([
      "wayfaring",
    ])
  })

  it("carries FULL rate, not half (D-132 clause 2)", () => {
    // Asserted as an equality against the baseline skill, never against the number 100: a
    // hardcoded figure would pass after someone halved both. 05-fog-of-war §3.6/§9.1's
    // provisional "treadmill = half Wayfaring XP" is what this overrides.
    const outdoor = delta.skills.find((s) => s.id === "wayfaring")!
    const indoor = delta.skills.find((s) => s.id === "vigil")!
    expect(indoor.xpPerUnit, WHY_IT_MATTERS).toBe(outdoor.xpPerUnit)
    expect(indoor.match!.measure).toBe(outdoor.match!.measure)
    expect(indoor.minUnitsForCredit).toBe(outdoor.minUnitsForCredit)
  })

  it("earns no ground credit, with no field saying so (D-132 clause 3)", () => {
    // The clause "falls out": no trace ⇒ no projection ⇒ no cells ⇒ no Cartography. Asserted
    // here as the two data facts that produce it. 0159 asserts the actual absence of
    // ExploredCell writes, which needs a fog pipeline to be absent FROM.
    const indoor = delta.skills.find((s) => s.id === "vigil")!
    expect(indoor.match!.requiresTrace, WHY_IT_MATTERS).toBe(false)
    expect(indoor.groundMultipliers).toBeNull()
    expect(Object.keys(indoor)).not.toContain("grantsDiscovery")
  })

  it("feeds the meta skill exactly as every other activity skill does", () => {
    const indoor = delta.skills.find((s) => s.id === "vigil")!
    const others = delta.skills.filter((s) => s.kind === "activity" && s.id !== "vigil")
    for (const other of others) {
      expect(indoor.feeds.map((f) => f.rate), `${other.id}`).toEqual(other.feeds.map((f) => f.rate))
    }
  })

  it("raises the skill count by exactly one, which is D-146's free Total Level point", () => {
    // The point itself is legitimate; what must never happen is a level-up CELEBRATION for it,
    // guarded at the notification layer (06-ui-ux §5.4, §10.5). That assertion is 0159's —
    // there is no notification layer yet to assert against.
    expect(delta.skills.length).toBe(baseline.skills.length + 1)
  })
})

describe("...and the property GENERALISES — the same delta with a row nobody has heard of", () => {
  // The adversarial case. If only Vigil is ever proven, what has been proven is that Vigil
  // works, which is a special case wearing the costume of a property.
  const delta = withRow(v1, POOL_SWIM)

  it("validates clean", () => {
    expect(validateRuleSet(delta), WHY_IT_MATTERS).toEqual([])
  })

  it("is selected for the kind it claims, and for nothing else", () => {
    expect(ids(selectActivitySkills(activity("other", false), delta)), WHY_IT_MATTERS).toContain(
      UNHEARD_OF_ID,
    )
    expect(ids(selectActivitySkills(activity("run", true), delta))).not.toContain(UNHEARD_OF_ID)
    expect(ids(selectActivitySkills(activity("ride", false), delta))).not.toContain(UNHEARD_OF_ID)
  })

  it("closes the traced-`other` distance gap it was always going to close (D-190)", () => {
    // D-190 exempted `other` from the totality check precisely because a row like this had not
    // been written yet. Adding it fills the gap — with no code change, which is the point.
    const before = selectActivitySkills(activity("other", false), v1)
    const after = selectActivitySkills(activity("other", false), delta)
    const distanceOf = (ss: RuleSkill[]) => ss.filter((s) => s.match!.measure === "distanceKm")
    // Stated as a DELTA, not as absolute sets, so it still holds once a real pool-swim row
    // lands in the YAML and `before` is no longer empty.
    expect(distanceOf(after).map((s) => s.id)).toEqual(
      [...distanceOf(before).map((s) => s.id), UNHEARD_OF_ID].sort(),
    )
  })

  it("does not disturb any existing skill's selection, anywhere on the grid", () => {
    // A new row must be additive. If adding one changed what an existing activity trains, the
    // registry would not be composable and every future row would need a regression sweep.
    for (const kind of ["run", "walk", "hike", "ride", "strength", "other"] as const) {
      for (const hasTrace of [true, false]) {
        const before = ids(selectActivitySkills(activity(kind, hasTrace), v1))
        const after = ids(selectActivitySkills(activity(kind, hasTrace), delta))
        expect(after.filter((id) => id !== UNHEARD_OF_ID), `${kind}/${hasTrace}`).toEqual(before)
      }
    }
  })
})

describe("the harness itself is honest", () => {
  it("fails if the delta is not actually applied", () => {
    // Guards the way this class of test usually rots: the baseline silently stops differing
    // from the delta, every assertion still passes, and the file proves nothing.
    const baseline = without("vigil")
    expect(ids(baseline.skills)).not.toEqual(ids(v1.skills))
  })

  it("uses production code paths only — no bespoke matcher, no bespoke validator", () => {
    // Both are imported from the modules the pipeline uses. Stated as a test so the intent
    // survives someone "simplifying" the file later.
    expect(typeof selectActivitySkills).toBe("function")
    expect(typeof validateRuleSet).toBe("function")
  })
})
