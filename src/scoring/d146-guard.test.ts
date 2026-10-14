import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

import { describe, expect, it } from "vitest"

import { BASELINE, BASELINE_VERSION, levelUpQueue, skillCards, totalCards } from "@/lib/level-up/cards"
import { skillsPanel } from "@/lib/skills/panel"
import { NEW_SKILL_ID, withNewWorkoutType } from "@/src/rules/__fixtures__/new-workout-type"
import { loadRuleSet } from "@/src/rules/load"
import type { RuleSet } from "@/src/rules/schema"
import { BUNDLED_RULES } from "@/rules/xp-rules.bundled"

import { earnedMilestonesCrossed, earnedTotalLevel, isMinted } from "./celebrate"
import { cumulativeXp, levelForXp, totalLevel } from "./levels"

/**
 * Ticket `0082` — THE D-146 GUARD, at the notification layer. D-146, D-297.
 *
 * *"Waking up to `TOTAL LEVEL 272` because a YAML row was added is the app congratulating you for
 * the operator's config change."* A new ruleset row mints a level 1 nobody earned. The scorer keeps
 * telling the truth about it; the card queue must never celebrate it.
 *
 * "Reprocessing" is the replay's contract, in memory: the same activities scored under a ruleset
 * with one more row differ by exactly that row (0065's `celebrate.test.ts` proves the scoring half).
 * A row that matches none of them adds no ledger XP — so the reprocessed standing is the old XP under
 * the new registry, and the notification layer is asked what that diff deserves.
 */

const LATEST = Math.max(...Object.keys(BUNDLED_RULES).map(Number))
const V: RuleSet = loadRuleSet(LATEST)
const NEXT: RuleSet = withNewWorkoutType(V)
const enabled = V.skills.filter((s) => s.enabled)
const lead = enabled[0]!.id

/** Every enabled skill at level 1 except `lead`, which sits at `leadLevel`: a Total Level of our choosing. */
function standingAt(total: number): Record<string, number> {
  const leadLevel = total - (enabled.length - 1)
  return { [lead]: cumulativeXp(leadLevel) }
}

describe("adding a skill row and reprocessing produces zero level-up cards (criteria 7, 8)", () => {
  // 99 earned under V: 100 under NEXT, purely from the minted row.
  const xp = standingAt(99)
  const before = new Map(Object.entries(xp))

  it("the new row really is minted, against the baseline", () => {
    expect(BASELINE_VERSION).toBe(1)
    expect(isMinted(NEXT.skills.find((s) => s.id === NEW_SKILL_ID)!, BASELINE)).toBe(true)
    // Minted = added after v1, or present in v1 but not counted by it (enabled since, D-300).
    const countedInV1 = new Set(loadRuleSet(1).skills.filter((s) => s.enabled).map((s) => s.id))
    for (const s of V.skills) expect(isMinted(s, BASELINE), s.id).toBe(s.introducedIn > 1 || !countedInV1.has(s.id))
  })

  it("the notification layer, run over the reprocessed diff, yields an empty queue", () => {
    // Reprocessing under NEXT: no activity matches the new row, so it adds no XP anywhere.
    const reprocessedGain: Record<string, number> = {}
    expect(levelUpQueue(xp, reprocessedGain, NEXT)).toEqual([])
    // Nor does replaying any one past run as-of produce a NEW card for the minted point: a run that
    // crossed no level before the row was added crosses none after it.
    const aRun = { [lead]: 10 }
    const crossesNothing = levelForXp(xp[lead]! + 10, NEXT.curve) === levelForXp(xp[lead]!, NEXT.curve)
    expect(crossesNothing).toBe(true)
    expect(levelUpQueue(xp, aRun, NEXT)).toEqual([])
  })

  it("…while Total Level DOES go up, and the new skill IS on the skills panel at level 1", () => {
    expect(totalLevel(before, V.skills, V.curve)).toBe(99)
    expect(totalLevel(before, NEXT.skills, NEXT.curve)).toBe(100)
    const standing = Object.entries(xp).map(([skillId, x]) => ({ skillId, xp: x }))
    const panel = skillsPanel(NEXT, standing)
    expect(panel.totalLevel).toBe(100)
    const tile = [...panel.activity, ...panel.meta, ...panel.untrained].find((t) => t.skillId === NEW_SKILL_ID)
    expect(tile).toMatchObject({ level: 1, xp: 0 })
  })
})

describe("a Total Level milestone crossed only by a minted point fires no card; earned later, it does (criterion 9)", () => {
  const xp = standingAt(99)

  it("the earned total is the displayed one less the minted row", () => {
    const m = new Map(Object.entries(xp))
    expect(earnedTotalLevel(m, V, BASELINE)).toBe(99)
    expect(earnedTotalLevel(m, NEXT, BASELINE)).toBe(99)
    expect(totalLevel(m, NEXT.skills, NEXT.curve)).toBe(100)
  })

  it("the run after the row ships, earning no level, fires nothing — not even at 100", () => {
    expect(totalCards(xp, { [lead]: 5 }, NEXT)).toEqual([])
  })

  it("the run that EARNS the 100th level fires the 100 card", () => {
    const toNext = cumulativeXp(levelForXp(xp[lead]!, NEXT.curve) + 1) - xp[lead]!
    expect(totalCards(xp, { [lead]: toNext }, NEXT)).toEqual([{ kind: "total", milestone: 100 }])
  })

  it("without the guard the same diff would have nothing to cross either — the card is late, never early", () => {
    // Judged on the DISPLAYED total, 100 was already reached by the mint and the earned run crosses
    // 100 → 101: no milestone. That is the "never celebrated at all" failure the earned total fixes.
    const m = new Map(Object.entries(xp))
    const toNext = cumulativeXp(levelForXp(xp[lead]!, NEXT.curve) + 1) - xp[lead]!
    const after = new Map([[lead, xp[lead]! + toNext]])
    const displayed = [totalLevel(m, NEXT.skills, NEXT.curve), totalLevel(after, NEXT.skills, NEXT.curve)]
    expect(displayed).toEqual([100, 101])
    expect(earnedMilestonesCrossed(m, after, NEXT, BASELINE, [100])).toEqual([100])
  })
})

describe("a minted skill's own EARNED levels still get cards", () => {
  it("its first real XP crossing 1 → 2 is a card: ledger-derived transitions are celebrated", () => {
    expect(skillCards(NEW_SKILL_ID, 0, cumulativeXp(2), NEXT.curve)).toMatchObject([{ kind: "skill", from: 1, to: 2 }])
  })
})

describe("the guard is one named predicate, in one place (criterion 10)", () => {
  const ROOT = join(import.meta.dirname, "..", "..")
  const files: string[] = []
  const walk = (p: string) => {
    if (statSync(p).isDirectory()) {
      for (const f of readdirSync(p)) if (f !== "node_modules" && f !== "__fixtures__") walk(join(p, f))
    } else if (/\.tsx?$/.test(p) && !/\.test(-d)?\.tsx?$/.test(p)) files.push(p)
  }
  for (const d of ["src", "lib", "app", "components", "amplify"]) walk(join(ROOT, d))

  it("scans the app", () => expect(files.length).toBeGreaterThan(100))

  it("`isMinted` is defined once, in celebrate.ts", () => {
    const hits = files.filter((f) => /function\s+isMinted\b|isMinted\s*=/.test(readFileSync(f, "utf8")))
    expect(hits.map((f) => relative(ROOT, f))).toEqual(["src/scoring/celebrate.ts"])
  })

  it("nothing else compares `introducedIn` with a version — anywhere in the app", () => {
    const hits = files.filter((f) => /introducedIn\s*[<>]|[<>]=?\s*\w*\.introducedIn\b/.test(readFileSync(f, "utf8")))
    expect(hits.map((f) => relative(ROOT, f))).toEqual(["src/scoring/celebrate.ts"])
  })

  it("the card queue reaches the guard only through celebrate.ts", () => {
    const cards = readFileSync(join(ROOT, "lib/level-up/cards.ts"), "utf8")
    expect(cards).toMatch(/from "@\/src\/scoring\/celebrate"/)
    expect(cards).not.toMatch(/introducedIn/)
  })
})
