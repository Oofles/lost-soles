import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { LevelUpCard } from "@/components/level-up-card"
import type { RuleSet } from "@/src/rules/schema"
import { baselineOf } from "@/src/scoring/celebrate"
import { cumulativeXp, totalLevelCeiling } from "@/src/scoring/levels"

import { BORDER_MS, CARD_MS, cardAt, easeOutBack, EXIT_FROM, SCALE_MS, SCALE_PEAK } from "./beat3"
import { levelUpQueue, skillCards, totalLadder, type LevelCard } from "./cards"

/** Ticket `0082` — one card's clock, and which cards a gain earns. The wall-clock half is the smoke. */

const CURVE = { stepFormula: "4 * L^2", maxLevel: 99, deepMaxLevel: 120 }
const SKILLS = Array.from({ length: 7 }, (_, i) => ({ id: `s${i}`, name: `S${i}`, enabled: true, introducedIn: 1 }))
const RULES = { curve: CURVE, skills: SKILLS } as unknown as Pick<RuleSet, "curve" | "skills">

describe("one card is 1.4 s (criterion 1)", () => {
  it("ends at exactly 1,400 ms", () => {
    expect(CARD_MS).toBe(1400)
    expect(cardAt(CARD_MS - 1).phase).toBe("exit")
    expect(cardAt(CARD_MS).phase).toBe("done")
  })

  it("enters with easeOutBack, 0.94 → 1.0, overshooting to 1.02", () => {
    expect(cardAt(0).scale).toBeCloseTo(0.94, 6)
    expect(cardAt(SCALE_MS).scale).toBeCloseTo(1, 6)
    let peak = 0
    for (let t = 0; t <= SCALE_MS; t += 0.5) peak = Math.max(peak, cardAt(t).scale)
    expect(peak).toBeCloseTo(SCALE_PEAK, 3)
    expect(easeOutBack(0)).toBeCloseTo(0, 9)
    expect(easeOutBack(1)).toBe(1)
  })

  it("the border wipes in over 400 ms; the exit is the last 200", () => {
    expect(cardAt(0).border).toBe(0)
    expect(cardAt(BORDER_MS / 2).border).toBe(0.5)
    expect(cardAt(BORDER_MS).border).toBe(1)
    expect(cardAt(EXIT_FROM).exit).toBe(0)
    expect(cardAt(CARD_MS).exit).toBe(1)
  })

  it("46 and 47 are never both legible: one leaves as the other arrives", () => {
    for (let t = 0; t <= CARD_MS; t += 5) {
      const f = cardAt(t)
      expect(f.oldOpacity * f.newOpacity, `t=${t}`).toBe(0)
    }
    expect(cardAt(0).oldOpacity).toBe(1)
    expect(cardAt(EXIT_FROM).newOpacity).toBe(1)
  })
})

describe("one card per level, queued (criterion 1)", () => {
  it("three levels in one gain are three cards, in order, each attributable to the gain", () => {
    const cards = skillCards("s0", cumulativeXp(46), cumulativeXp(49) - cumulativeXp(46), CURVE)
    expect(cards.map((c) => c.kind === "skill" && [c.from, c.to])).toEqual([[46, 47], [47, 48], [48, 49]])
    expect(cards.length * CARD_MS).toBe(4200)
    const arcs = cards.map((c) => (c.kind === "skill" ? c.arc : -1))
    expect([...arcs].sort((a, b) => a - b)).toEqual(arcs)
    expect(arcs.at(-1)).toBe(1)
  })

  it("no XP, no card", () => {
    expect(skillCards("s0", cumulativeXp(10), 0, CURVE)).toEqual([])
  })
})

describe("milestones (criteria 4, 5, 6)", () => {
  const card = (to: number) => skillCards("s0", cumulativeXp(to) - 1, 1, CURVE)[0] as Extract<LevelCard, { kind: "skill" }>

  it.each([[10, "Initiate"], [25, "Journeyman"], [50, "Adept"], [75, "Veteran"], [90, "Elder"], [99, "Mastery"]])(
    "level %i names its tier, %s",
    (level, tier) => expect(card(level).tier).toBe(tier),
  )

  it.each([2, 11, 47, 98])("level %i names none", (level) => expect(card(level).tier).toBeNull())

  it("50 places a landmark and 99 a shrine; nothing else places anything", () => {
    expect(card(50).place).toBe("landmark")
    expect(card(99).place).toBe("shrine")
    for (const l of [10, 25, 75, 90, 47]) expect(card(l).place).toBeNull()
  })

  it("Total Level milestones run 100, 150, … up to the computed ceiling (693 for seven skills)", () => {
    expect(totalLevelCeiling(SKILLS, CURVE)).toBe(693)
    expect(totalLadder(RULES)).toEqual([100, 150, 200, 250, 300, 400, 500, 693])
  })

  it("a gain that carries Total Level across 100 adds a crest card after the skill's own", () => {
    const before = { s0: cumulativeXp(93) } // 93 + 6 = 99
    // The fixture's skills are not the bundled v1's, so it is its own baseline (D-300).
    const q = levelUpQueue(before, { s0: cumulativeXp(94) - cumulativeXp(93) }, RULES, ["s0"], baselineOf({ version: 1, skills: SKILLS }))
    expect(q.map((c) => c.kind)).toEqual(["skill", "total"])
    expect(q[1]).toEqual({ kind: "total", milestone: 100 })
  })
})

describe("the card's markup", () => {
  const names = (id: string) => ({ s0: "Wayfaring" })[id] ?? id
  const html = (c: LevelCard, t: number) => renderToStaticMarkup(<LevelUpCard card={c} frame={cardAt(t)} skillName={names} />)
  const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")

  it("takes the screen under the --navy-900 scrim (criterion 3)", () => {
    expect(html(skillCards("s0", 0, cumulativeXp(2), CURVE)[0]!, 600)).toMatch(/position:fixed;inset:0;[^"]*background:var\(--scrim\)/)
  })

  it("shows the sigil, the name, and the tier only at a milestone (criterion 4)", () => {
    const at50 = skillCards("s0", cumulativeXp(50) - 1, 1, CURVE)[0]!
    const at47 = skillCards("s0", cumulativeXp(47) - 1, 1, CURVE)[0]!
    expect(text(html(at50, 1000))).toContain("WAYFARING")
    expect(text(html(at50, 1000))).toContain("ADEPT")
    expect(text(html(at50, 1000))).toContain("A landmark now stands where you earned it.")
    expect(html(at47, 1000)).not.toContain("data-tier")
    expect(html(at47, 1000)).not.toContain("data-place")
  })

  it("a Total Level card wears the crest, not a sigil (criterion 6)", () => {
    const h = html({ kind: "total", milestone: 100 }, 1000)
    expect(text(h)).toContain("TOTAL LEVEL")
    expect(text(h)).toContain("100")
    expect(h).toContain("M12 2.5 L14 10") // CREST
  })

  it("gold is never the type (D-148): only the border, the rules and the disc", () => {
    const h = html(skillCards("s0", cumulativeXp(50) - 1, 1, CURVE)[0]!, 1000)
    expect(h).not.toMatch(/(?<!background:|stroke=")color:var\(--gold/)
  })
})
