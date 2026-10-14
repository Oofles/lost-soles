import { describe, expect, it } from "vitest"

import { levelUpQueue, totalCards } from "@/lib/level-up/cards"
import {
  ACTIVITY_TABLE,
  JOB,
  LEDGER_TABLE,
  rig,
  SKILL_STATE_TABLE,
  TRACE,
  type Options,
} from "@/src/pipeline/__fixtures__/process-rig"
import { processActivity } from "@/src/pipeline/process-activity"
import { LEDGER_REASONS } from "@/src/scoring/ledger"
import { cumulativeXp, levelForXp, totalLevel } from "@/src/scoring/levels"
import { baselineOf } from "@/src/scoring/celebrate"

import { loadRuleSet } from "./load"
import type { RuleSet, RuleSkill } from "./schema"
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
 * **Scope.** `0030` proved the property as far as the code then reached — registry → validator
 * → matcher → rate and feeds. `0159` takes the SAME delta the rest of the way: through the real
 * `processActivity` on the shared pipeline rig (real XP, `ExploredCell` writes, the generation
 * bump, the ledger's `reason`, `SkillState`), and to the notification layer for D-146. It
 * extends this harness rather than adding a third: `app/new-workout-type.test.tsx` (`0072`) owns
 * "new data changes no screen and no code"; this file owns "a row added as data behaves as one
 * that was always there".
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

const WHY_D146 =
  "D-146 (with D-031 / D-132 / D-141) — a skill added as a row mints a free Total Level point, " +
  "and the notification layer must never celebrate it. Every future row pays this cost, so " +
  "this is not a Vigil quirk. The guard is `isMinted` in src/scoring/celebrate.ts; fix it " +
  "there, never in the scorer (06-ui-ux §5.4, §10.5)."

const v1 = loadRuleSet(1)

/** The version a delta ships in. A real row arrives in a NEW ruleset, stamped with it (D-146). */
const NEXT = v1.version + 1

/** The shipped ruleset with one row removed — the "before" a delta is applied to. */
function without(id: string): RuleSet {
  const skills = v1.skills.filter((s) => s.id !== id)
  expect(skills.length, `${id} must exist in v1 to be removed`).toBe(v1.skills.length - 1)
  return { ...v1, skills }
}

/**
 * The delta as it would really ship: the next ruleset version, with the row's `introducedIn`
 * stamped to it. `0030` appended the row under v1 unchanged, which the matcher cannot tell
 * apart — but the D-146 guard keys on `introducedIn`, so a delta that kept the row's original
 * stamp would test a row that was never new.
 */
const withRow = (base: RuleSet, row: RuleSkill): RuleSet => ({
  ...base,
  version: NEXT,
  skills: [...base.skills, { ...row, introducedIn: NEXT }],
})

/**
 * The registry with any row claiming the SAME selection space as `row` removed.
 *
 * A delta means "add something that is not there". If the baseline already contains an
 * equivalent row, adding one more is not a delta — it is a genuine ambiguity, and the
 * validator is right to reject it and the matcher right to drop the loser on the tie-break.
 * 0030's own operator proof adds a real pool-swim row to the YAML and hit exactly that.
 *
 * Removing by MATCH rather than by id, because a clashing row need not share an id to clash.
 */
function withoutSameSelection(row: RuleSkill): RuleSet {
  const m = row.match!
  return {
    ...v1,
    skills: v1.skills.filter((s) => {
      if (s.kind !== "activity" || !s.match) return true
      const o = s.match
      const sameKinds = JSON.stringify(o.kinds ?? []) === JSON.stringify(m.kinds ?? [])
      return !(o.measure === m.measure && o.requiresTrace === m.requiresTrace && sameKinds)
    }),
  }
}

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
  introducedIn: 1,
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
    // asserted at the notification layer in the end-to-end block below (0159).
    expect(delta.skills.length).toBe(baseline.skills.length + 1)
  })
})

describe("...and the property GENERALISES — the same delta with a row nobody has heard of", () => {
  // The adversarial case. If only Vigil is ever proven, what has been proven is that Vigil
  // works, which is a special case wearing the costume of a property.
  const baseline = withoutSameSelection(POOL_SWIM)
  const delta = withRow(baseline, POOL_SWIM)

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
    const before = selectActivitySkills(activity("other", false), baseline)
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
        const before = ids(selectActivitySkills(activity(kind, hasTrace), baseline))
        const after = ids(selectActivitySkills(activity(kind, hasTrace), delta))
        expect(after.filter((id) => id !== UNHEARD_OF_ID), `${kind}/${hasTrace}`).toEqual(before)
      }
    }
  })
})

/* ── 0159: the same delta, all the way down ───────────────────────────────────────────────
 *
 * Everything below runs the REAL `processActivity` on the shared pipeline rig
 * (`src/pipeline/__fixtures__/process-rig.ts`) with the delta as its registry. Every assertion is
 * an equality or an invariance between the added row and a row that was always there — never a
 * comparison against a constant. A test that proved "Vigil scores 1000 XP" would prove the
 * scorer, not the property (0159's Notes).
 */

/** One pipeline run, reduced to what this file asserts on. */
async function pipeline(registry: RuleSet, ingest: Options["ingest"]) {
  const r = rig({ ingest })
  await processActivity(JOB, { ...r.deps, registry })
  const items = r.transacts.flatMap((t) => t.TransactItems ?? [])
  const ledger = items
    .filter((i) => i.Put?.TableName === LEDGER_TABLE)
    .map((i) => i.Put!.Item! as { skillId: string; reason: string; xpAwarded: number })
  return {
    ledger,
    xpInto: (id: string) => ledger.filter((e) => e.skillId === id).reduce((s, e) => s + Number(e.xpAwarded), 0),
    reasonsOf: (id: string) => ledger.filter((e) => e.skillId === id).map((e) => e.reason),
    skillStates: items
      .filter((i) => i.Update?.TableName === SKILL_STATE_TABLE)
      .map((i) => String(i.Update!.Key!.skillId)),
    activity: items.find((i) => i.Put?.TableName === ACTIVITY_TABLE)!.Put!.Item!,
    cellWrites: r.cellWrites.length,
    aggWrites: r.aggWrites.length,
    generationBumped: r.calls.includes("generation"),
  }
}

const TEN_KM = 10_000

/** The kind an activity must have for `row` to select it, and the trace that row requires. */
const ingestFor = (row: RuleSkill, trace: boolean): Options["ingest"] => ({
  kind: row.match!.kinds![0]!,
  hasTrace: trace,
  ...(trace ? { trace: TRACE } : {}),
  distanceM: TEN_KM,
})

const DELTAS = [
  { name: "Vigil", row: v1.skills.find((s) => s.id === "vigil")!, baseline: without("vigil") },
  { name: "the pool-swim row", row: POOL_SWIM, baseline: withoutSameSelection(POOL_SWIM) },
]

describe.each(DELTAS)("$name, end to end — real XP, real writes, real notifications (0159)", ({ row, baseline }) => {
  const delta = withRow(baseline, row)
  // The always-there comparators, found by DATA so nothing here hardcodes which row they are.
  // D-189: exactly one row reveals ground — the traced outdoor distance skill.
  const traced = delta.skills.find((s) => s.revealsGround)!
  // An always-there ungrounded distance row: whatever reason the scorer gives IT is the one the
  // added row must get. Its own `requiresTrace: false` so the comparison is like for like.
  const peer = baseline.skills.find(
    (s) =>
      s.kind === "activity" &&
      s.match?.measure === row.match!.measure &&
      s.match.requiresTrace === false &&
      s.groundMultipliers === null,
  )!

  const runs = (async () => ({
    traceless: await pipeline(delta, ingestFor(row, false)),
    tracelessBefore: await pipeline(baseline, ingestFor(row, false)),
    traced: await pipeline(delta, ingestFor(traced, true)),
    peer: await pipeline(baseline, ingestFor(peer, false)),
    tracedBefore: await pipeline(baseline, ingestFor(traced, true)),
  }))()

  it("the comparators exist, and the baseline genuinely pays the row nothing", async () => {
    const { tracelessBefore, traceless } = await runs
    expect(traced, "no ground-revealing row to compare against").toBeDefined()
    expect(peer, `no always-there ungrounded ${row.match!.measure} row to compare against`).toBeDefined()
    expect(row.id).not.toBe(traced.id)
    expect(tracelessBefore.xpInto(row.id), "the baseline must lack the row, or nothing is proven").toBe(0)
    expect(traceless.xpInto(row.id), WHY_IT_MATTERS).toBeGreaterThan(0)
  })

  it("(b) pays the added row at FULL rate: XP per unit of rate equals the traced skill's on all-new ground", async () => {
    const { traceless, traced: t } = await runs
    // "Fully new ground" is the comparator's precondition, so it is asserted, not assumed.
    expect(new Set(t.reasonsOf(traced.id)), "the traced run must be all new ground").toEqual(new Set(["new_ground"]))
    // Normalised by each row's own declared rate, so it holds for a row priced differently
    // (pool swim) and catches any hidden discount for having no trace (the D-132 half-rate trap).
    expect(traceless.xpInto(row.id) / row.xpPerUnit, WHY_IT_MATTERS).toBe(t.xpInto(traced.id) / traced.xpPerUnit)
  })

  it("(b) …and where the registry prices them alike, the XP itself is equal", async () => {
    const { traceless, traced: t } = await runs
    const sameRate = { ...row, xpPerUnit: traced.xpPerUnit }
    const alike = await pipeline(withRow(baseline, sameRate), ingestFor(row, false))
    expect(alike.xpInto(row.id), WHY_IT_MATTERS).toBe(t.xpInto(traced.id))
    // For Vigil this is the shipped row unchanged — the exact clause (b) of 02 §3.8 check 5.
    expect(row.xpPerUnit === traced.xpPerUnit ? traceless.xpInto(row.id) : alike.xpInto(row.id)).toBe(
      t.xpInto(traced.id),
    )
  })

  it("(d) the traceless run writes no ExploredCell, bumps no generation, awards no discovery — and the traced one does all three", async () => {
    const { traceless, traced: t } = await runs
    // The skills that pay for cells, found from the traced arm's ledger rather than by name.
    const discovery = [...new Set(t.ledger.filter((e) => e.reason.startsWith("cells_")).map((e) => e.skillId))]

    // The traced arm FIRST: without it, "zero writes" passes vacuously (0159's Notes).
    expect(t.cellWrites, "the traced arm must write cells, or (d) proves nothing").toBeGreaterThan(0)
    expect(t.generationBumped, "the traced arm must bump the generation").toBe(true)
    expect(discovery.length, "the traced arm must award discovery XP").toBeGreaterThan(0)
    expect(Number(t.activity.cellCount)).toBeGreaterThan(0)

    expect(traceless.cellWrites, WHY_IT_MATTERS).toBe(0)
    expect(traceless.aggWrites, WHY_IT_MATTERS).toBe(0)
    expect(traceless.generationBumped, WHY_IT_MATTERS).toBe(false)
    for (const id of discovery) expect(traceless.xpInto(id), `${WHY_IT_MATTERS} (${id})`).toBe(0)
    // The row shape never varies: T3 still carries the field, at zero.
    expect(traceless.activity, WHY_IT_MATTERS).toHaveProperty("cellCount", 0)
  })

  it("records the award under the reason an always-there ungrounded row gets — no new reason is minted", async () => {
    const r = await runs
    const peerReasons = r.peer.reasonsOf(peer.id)
    expect(peerReasons.length).toBeGreaterThan(0)
    expect(r.traceless.reasonsOf(row.id), WHY_IT_MATTERS).toEqual(peerReasons)
    // The vocabulary the delta world writes is a subset of the baseline world's.
    const before = new Set([...r.peer.ledger, ...r.tracedBefore.ledger].map((e) => e.reason))
    for (const e of [...r.traceless.ledger, ...r.traced.ledger]) {
      expect(before.has(e.reason), `${WHY_IT_MATTERS} (new reason "${e.reason}")`).toBe(true)
      expect(LEDGER_REASONS as readonly string[], WHY_IT_MATTERS).toContain(e.reason)
    }
  })

  it("keeps the added row's total independent of the traced skill's, in both directions", async () => {
    const { traceless, traced: t } = await runs
    // Each arm writes its own skill's SkillState — so its absence from the other is meaningful.
    expect(traceless.skillStates).toContain(row.id)
    expect(t.skillStates).toContain(traced.id)
    expect(traceless.skillStates, `${WHY_IT_MATTERS} (traceless XP touched ${traced.id})`).not.toContain(traced.id)
    expect(t.skillStates, `${WHY_IT_MATTERS} (traced XP touched ${row.id})`).not.toContain(row.id)
    expect(traceless.xpInto(traced.id)).toBe(0)
    expect(t.xpInto(row.id)).toBe(0)
  })

  describe("D-146 — the free Total Level point, at the notification layer", () => {
    // Every consumer (`/log`, the run sequence) diffs one activity's gain under ONE registry, so
    // the free point cannot fire on an empty diff. Where it bites is the run that carries the
    // EARNED total to 99 while the minted point makes the displayed one read 100: judged on the
    // displayed total, that run would be congratulated for the operator's config change.
    const enabled = baseline.skills.filter((s) => s.enabled)
    const lead = enabled[0]!.id
    /** Every enabled skill at level 1 except `lead`: an earned Total Level of our choosing. */
    const standingAt = (earned: number) => ({ [lead]: cumulativeXp(earned - (enabled.length - 1)) })
    const toNextLevel = (xp: Record<string, number>) => cumulativeXp(levelForXp(xp[lead]!, delta.curve) + 1) - xp[lead]!
    const total = (xp: Record<string, number>, r: RuleSet) => totalLevel(new Map(Object.entries(xp)), r.skills, r.curve)

    it("raises Total Level by exactly 1", () => {
      const xp = standingAt(99)
      expect(total(xp, baseline)).toBe(99)
      expect(total(xp, delta) - total(xp, baseline), WHY_D146).toBe(1)
    })

    it("emits zero level-up notifications for it — not on its own, and not on the run it pushes past a milestone", () => {
      expect(levelUpQueue(standingAt(99), {}, delta), WHY_D146).toEqual([])
      const xp = standingAt(98)
      const gained = { [lead]: toNextLevel(xp) }
      // The displayed total really does cross 100 on this run…
      expect(total(xp, delta)).toBe(99)
      expect(total({ [lead]: xp[lead]! + gained[lead]! }, delta)).toBe(100)
      // …and only the earned skill level is celebrated, never the Total Level milestone.
      expect(levelUpQueue(xp, gained, delta).filter((c) => c.kind === "total"), WHY_D146).toEqual([])
    })

    it("…and the guard is what stops it: judged as if the row were not new, that run WOULD fire 100", () => {
      // The non-vacuity arm. Treat the delta's own version as the baseline, so nothing in it is
      // minted, and the identical diff produces the card the guard exists to suppress.
      const xp = standingAt(98)
      expect(totalCards(xp, { [lead]: toNextLevel(xp) }, delta, baselineOf(delta)), "the scenario must be one that can fire").toEqual([
        { kind: "total", milestone: 100 },
      ])
    })

    it("the milestone is late, never lost: the run that EARNS the 100th level fires it", () => {
      const xp = standingAt(99)
      expect(totalCards(xp, { [lead]: toNextLevel(xp) }, delta), WHY_D146).toEqual([{ kind: "total", milestone: 100 }])
    })
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
