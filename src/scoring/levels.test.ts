import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

import { describe, expect, it } from "vitest"

import { loadRuleSet } from "@/src/rules/load"
import type { RuleSkill } from "@/src/rules/schema"
import {
  cumulativeXp,
  levelForXp,
  totalLevel,
  totalLevelCeiling,
  totalXp,
  xpToAdvance,
} from "@/src/scoring"

/**
 * Ticket 0063. `04-game-design.md` §1.2 and §2.1, D-130, D-145, D-192.
 *
 * The ceiling is never asserted as a figure (D-192): 594 → 693 → 792 → 891 were each falsified by
 * a data-only change. It is asserted as `enabledRows × maxLevel`, recomputed from the YAML.
 */

const RULES = loadRuleSet(1)
const CURVE = RULES.curve
const SRC = new URL("..", import.meta.url).pathname

/** mulberry32 — seeded, so a property failure reproduces from the test name alone. */
function prng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : []
  })
}

/** Numeric literals only — `18736594040123457` is an id, not a 594. */
function numberLiterals(text: string, n: number): boolean {
  return new RegExp(`(?<![\\w.])${n}(?![\\w.])`).test(text)
}

describe("the curve (D-130)", () => {
  it("steps by 4L² and accumulates to an integer C(L) for every L in 1..deepMaxLevel", () => {
    expect(CURVE.stepFormula).toBe("4 * L^2")
    for (let L = 1; L <= CURVE.deepMaxLevel; L++) {
      expect(xpToAdvance(L)).toBe(4 * L * L)
      expect(cumulativeXp(L)).toBe((2 * (L - 1) * L * (2 * L - 1)) / 3)
      expect(Number.isInteger(xpToAdvance(L))).toBe(true)
      expect(Number.isInteger(cumulativeXp(L))).toBe(true)
      expect(cumulativeXp(L + 1) - cumulativeXp(L)).toBe(xpToAdvance(L))
    }
  })

  /**
   * `04-game-design.md` §2.1's table, every column. The ticket's copy labelled 447,580 as L=75;
   * it is C(70) — C(75) is 551,300. The doc was right; the ticket's transcription was not.
   */
  it("reproduces the §2.1 anchor table exactly", () => {
    const anchors: [number, number, number][] = [
      [5, 120, 100],
      [10, 1_140, 400],
      [20, 9_880, 1_600],
      [25, 19_600, 2_500],
      [30, 34_220, 3_600],
      [40, 82_160, 6_400],
      [50, 161_700, 10_000],
      [60, 280_840, 14_400],
      [70, 447_580, 19_600],
      [80, 669_920, 25_600],
      [90, 955_860, 32_400],
      [110, 1_750_540, 48_400],
      [120, 2_275_280, 57_600],
    ]
    for (const [L, c, step] of anchors) {
      expect(cumulativeXp(L)).toBe(c)
      expect(xpToAdvance(L)).toBe(step)
    }
    expect(cumulativeXp(1)).toBe(0)
    expect(cumulativeXp(75)).toBe(551_300)
  })

  it("C(99) === 1274196", () => {
    expect(cumulativeXp(99)).toBe(1_274_196)
  })

  it("keeps the top-to-middle ratio in the 8–12 band §2.1 needs, not Runescape's 128.6", () => {
    expect(cumulativeXp(99) / cumulativeXp(50)).toBeCloseTo(7.88, 2)
  })

  it("costs 32,400 XP at level 90 and 8,836 at level 47 — the figures the UI shows verbatim", () => {
    expect(xpToAdvance(90)).toBe(32_400)
    expect(xpToAdvance(47)).toBe(8_836)
  })
})

describe("levelForXp", () => {
  const uncapped = { maxLevel: CURVE.deepMaxLevel + 10 }

  it("inverts C exactly at every boundary: C(L) → L, C(L) − 1 → L − 1", () => {
    for (let L = 2; L <= CURVE.deepMaxLevel; L++) {
      expect(levelForXp(cumulativeXp(L), uncapped)).toBe(L)
      expect(levelForXp(cumulativeXp(L) - 1, uncapped)).toBe(L - 1)
    }
    expect(levelForXp(0, uncapped)).toBe(1)
  })

  it("clamps at the ruleset's maxLevel", () => {
    expect(levelForXp(cumulativeXp(CURVE.maxLevel), CURVE)).toBe(CURVE.maxLevel)
    expect(levelForXp(cumulativeXp(CURVE.maxLevel) - 1, CURVE)).toBe(CURVE.maxLevel - 1)
    expect(levelForXp(cumulativeXp(CURVE.deepMaxLevel), CURVE)).toBe(CURVE.maxLevel)
    expect(levelForXp(Number.MAX_SAFE_INTEGER, CURVE)).toBe(CURVE.maxLevel)
    expect(levelForXp(cumulativeXp(10), { maxLevel: 5 })).toBe(5)
  })

  it("is monotonic non-decreasing in xp (property, seed 63)", () => {
    const rand = prng(63)
    const top = cumulativeXp(CURVE.deepMaxLevel + 5)
    for (let i = 0; i < 5_000; i++) {
      const a = Math.floor(rand() * top)
      const b = a + Math.floor(rand() * 50_000)
      expect(levelForXp(b, CURVE)).toBeGreaterThanOrEqual(levelForXp(a, CURVE))
      expect(levelForXp(b, uncapped)).toBeGreaterThanOrEqual(levelForXp(a, uncapped))
    }
  })
})

describe("Total Level and Total XP (D-033, D-145)", () => {
  const enabled = RULES.skills.filter((s) => s.enabled)
  const disabled = RULES.skills.filter((s) => !s.enabled)

  it("an untrained ruleset is one level per enabled skill and zero XP", () => {
    expect(totalLevel(new Map(), RULES.skills, CURVE)).toBe(enabled.length)
    expect(totalXp(new Map(), RULES.skills)).toBe(0)
  })

  it("sums every enabled skill, meta skills included, and ignores disabled ones", () => {
    expect(enabled.some((s) => s.kind === "meta")).toBe(true)
    expect(disabled.length).toBeGreaterThan(0)
    const xp = new Map<string, number>()
    for (const s of RULES.skills) xp.set(s.id, cumulativeXp(10))
    expect(totalLevel(xp, RULES.skills, CURVE)).toBe(10 * enabled.length)
    expect(totalXp(xp, RULES.skills)).toBe(cumulativeXp(10) * enabled.length)
  })

  it("mixes trained and untrained skills correctly", () => {
    const [a, b] = enabled
    const xp = new Map([
      [a!.id, cumulativeXp(47) + 5],
      [b!.id, 123],
    ])
    expect(totalLevel(xp, RULES.skills, CURVE)).toBe(47 + levelForXp(123, CURVE) + (enabled.length - 2))
    expect(totalXp(xp, RULES.skills)).toBe(cumulativeXp(47) + 5 + 123)
  })
})

describe("the Total Level ceiling (D-145, D-192)", () => {
  it("equals Σ maxLevel over the enabled rows of xp-rules-v1.yaml, recomputed not remembered", () => {
    const expected = RULES.skills.reduce((sum, s) => sum + (s.enabled ? CURVE.maxLevel : 0), 0)
    expect(totalLevelCeiling(RULES.skills, CURVE)).toBe(expected)
    expect(totalLevel(new Map(RULES.skills.map((s) => [s.id, Number.MAX_SAFE_INTEGER])), RULES.skills, CURVE)).toBe(
      expected,
    )
  })

  it("moves by exactly maxLevel when a fixture ruleset gains an enabled row — no source change", () => {
    const extra: RuleSkill = { ...RULES.skills.find((s) => s.enabled)!, id: "fixture-extra", enabled: true }
    const before = totalLevelCeiling(RULES.skills, CURVE)
    expect(totalLevelCeiling([...RULES.skills, extra], CURVE)).toBe(before + CURVE.maxLevel)
    expect(totalLevelCeiling([...RULES.skills, { ...extra, enabled: false }], CURVE)).toBe(before)
  })
})

describe("no remembered numbers in source (D-192)", () => {
  it("the level module names no maxLevel literal", () => {
    const text = readFileSync(join(SRC, "scoring/levels.ts"), "utf8")
    expect(numberLiterals(text, CURVE.maxLevel)).toBe(false)
    expect(numberLiterals(text, CURVE.deepMaxLevel)).toBe(false)
  })

  it("no past or present ceiling figure appears as a literal anywhere in src/", () => {
    const figures = [6, 7, 8, 9].map((n) => n * CURVE.maxLevel)
    const offenders = sourceFiles(SRC).flatMap((path) => {
      const text = readFileSync(path, "utf8")
      return figures.filter((f) => numberLiterals(text, f)).map((f) => `${relative(SRC, path)}: ${f}`)
    })
    expect(offenders).toEqual([])
  })
})
