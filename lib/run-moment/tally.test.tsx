import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { TallyView } from "@/app/run/[activityId]/run-ledger"
import type { ActivityLedgerRow } from "@/lib/runs/ledger"
import type { RuleSet } from "@/src/rules/schema"
import { cumulativeXp, levelForXp, totalLevel } from "@/src/scoring/levels"

import { cardTriggers, tallyFor } from "./tally"

/**
 * Ticket `0081` — the tally's numbers and its two §3.5 rules. Skill ids are the real ones because
 * the criteria name them; the scorer never sees them here, only the opaque keys a ledger row carries.
 */

const RULES = {
  curve: { stepFormula: "4 * L^2", maxLevel: 99, deepMaxLevel: 120 },
  skills: [
    { id: "wayfaring", name: "Wayfaring", enabled: true, unit: "km" },
    { id: "cartography", name: "Cartography", enabled: true, unit: "cells" },
    { id: "constitution", name: "Constitution", enabled: true, unit: "xp" },
  ],
} as unknown as Pick<RuleSet, "curve" | "skills">

const row = (skillId: string, reason: string, xpAwarded: number, over: Partial<ActivityLedgerRow> = {}): ActivityLedgerRow => ({
  skillId,
  reason,
  xpAwarded,
  xpRulesVersion: 3,
  isFloor: false,
  ...over,
})

const RUN = [
  row("wayfaring", "new_ground", 318, { units: 3.18 }),
  row("wayfaring", "rearmed_ground", 62, { units: 1.255 }),
  row("wayfaring", "recent_ground", 196, { units: 3.933 }),
  row("cartography", "cells_new", 300),
  row("cartography", "cells_rearmed", 75),
  row("constitution", "constitution_share", 192),
]

const names: Record<string, string> = { wayfaring: "Wayfaring", cartography: "Cartography", constitution: "Constitution" }
const SUMMARY = { startedAtLocal: "2026-08-28T07:00:00", distanceM: 8369, newCellCount: 148, rearmedCellCount: 58 }
const html = (rows: ActivityLedgerRow[], before: Record<string, number> | null = {}) =>
  renderToStaticMarkup(<TallyView summary={SUMMARY} tally={tallyFor(rows, before, RULES)} skillName={(id) => names[id] ?? id} />)
const text = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")

describe("displayedXp equals SUM(ledger) for the activity (criterion 9)", () => {
  it("each line is the sum of its skill's rows, and the run total is the sum of every row", () => {
    const t = tallyFor(RUN, {}, RULES)
    const sum = RUN.reduce((s, r) => s + r.xpAwarded, 0)
    expect(t.runXp).toBe(sum)
    expect(t.lines.reduce((s, l) => s + l.xp, 0)).toBe(sum)
    for (const l of t.lines) {
      expect(l.xp).toBe(RUN.filter((r) => r.skillId === l.skillId).reduce((s, r) => s + r.xpAwarded, 0))
      expect(l.parts.reduce((s, p) => s + p.xp, 0)).toBe(l.xp)
    }
  })

  it("Total XP's delta is the run's ledger sum", () => {
    const t = tallyFor(RUN, { wayfaring: 8000, cartography: 4000, constitution: 6500 }, RULES)
    expect(t.total).toEqual({ before: 18500, after: 18500 + t.runXp })
  })

  it("floor rows and a superseded version are not this run's (the newest version wins)", () => {
    const t = tallyFor([...RUN, row("wayfaring", "retained_floor", 999, { isFloor: true }), row("wayfaring", "distance", 50, { xpRulesVersion: 2 })], {}, RULES)
    expect(t.runXp).toBe(RUN.reduce((s, r) => s + r.xpAwarded, 0))
  })
})

describe("never a zero (criterion 6)", () => {
  it("Cartography = 0 → no Cartography row anywhere in the DOM", () => {
    const rows = [row("wayfaring", "recent_ground", 288, { units: 7.2 }), row("constitution", "constitution_share", 96)]
    const h = html(rows)
    expect(h).not.toContain('data-skill="cartography"')
    expect(text(h)).not.toContain("Cartography")
    expect(text(h)).not.toMatch(/\+0\b/)
  })

  it("a zero-XP row is still a zero", () => {
    expect(tallyFor([row("cartography", "cells_new", 0)], {}, RULES).lines).toEqual([])
  })

  it("no new ground → no km line, never `0.00 km`", () => {
    const t = tallyFor([row("wayfaring", "recent_ground", 288, { units: 7.2 })], {}, RULES)
    expect(t.newKm).toBeNull()
    expect(text(html([row("wayfaring", "recent_ground", 288, { units: 7.2 })]))).not.toMatch(/never run before/)
  })

  it("the new-road line is the km skill's `new_ground` units, in distance not cells (D-012)", () => {
    expect(tallyFor(RUN, {}, RULES).newKm).toBeCloseTo(3.18)
    expect(text(html(RUN))).toContain("3.18 km never run before")
  })
})

describe("row order is XP descending (criterion 7)", () => {
  it("Constitution > Wayfaring puts Constitution first", () => {
    const rows = [row("wayfaring", "recent_ground", 100), row("constitution", "constitution_share", 400)]
    expect(tallyFor(rows, {}, RULES).lines.map((l) => l.skillId)).toEqual(["constitution", "wayfaring"])
    const h = html(rows)
    expect(h.indexOf('data-skill="constitution"')).toBeLessThan(h.indexOf('data-skill="wayfaring"'))
  })
})

describe("levels, bars and totals (criteria 5, 10)", () => {
  it("a run that crosses a level fills the bar to full and never wraps", () => {
    const at40 = cumulativeXp(41) - 100 // 100 XP short of 41
    const t = tallyFor([row("constitution", "constitution_share", 500)], { constitution: at40 }, RULES)
    const s = t.lines[0]!.standing!
    expect(s.levelUp).toBe(true)
    expect(s.levelAfter).toBe(41)
    expect(s.barTo).toBe(1)
    expect(s.barFrom).toBeCloseTo(1 - 100 / (4 * 40 * 40), 6) // 100 short of a 6,400-XP level
  })

  it("a run inside one level fills from where it was to where it is", () => {
    const base = cumulativeXp(20) + 10
    const s = tallyFor([row("wayfaring", "recent_ground", 100)], { wayfaring: base }, RULES).lines[0]!.standing!
    expect(s.levelUp).toBe(false)
    expect(s.barTo).toBeGreaterThan(s.barFrom)
    expect(s.barTo).toBeLessThan(1)
    expect(s.xpToNext).toBe(cumulativeXp(21) - base - 100)
  })

  it("Total Level is D-145's Σ level over every enabled skill, after the run", () => {
    const before = { wayfaring: 50_000, cartography: 4000 }
    const t = tallyFor(RUN, before, RULES)
    const after = new Map([["wayfaring", 50_576], ["cartography", 4375], ["constitution", 192]])
    expect(t.totalLevel).toBe(totalLevel(after, RULES.skills, RULES.curve))
    expect(t.totalLevel).toBe(levelForXp(50_576, RULES.curve) + levelForXp(4375, RULES.curve) + levelForXp(192, RULES.curve))
  })

  it("Total XP renders as `old → new (+delta)` and the level arrow appears on a level gained", () => {
    const h = html([row("constitution", "constitution_share", 500)], { constitution: cumulativeXp(41) - 100, wayfaring: 1_000_000 })
    const before = cumulativeXp(41) - 100 + 1_000_000
    expect(text(h)).toContain(`Total XP ${(before).toLocaleString("en-US")} → ${(before + 500).toLocaleString("en-US")} (+500)`)
    expect(h).toMatch(/L41<span aria-hidden="true" style="color:var\(--progress-activity\);opacity:1">↑/)
  })

  it("the arrow never forces itself visible through a veiled ancestor", () => {
    const h = html([row("constitution", "constitution_share", 500)], { constitution: cumulativeXp(41) - 100 })
    expect(h).not.toMatch(/visibility:\s*visible/)
  })

  it("without a `before`, rows still show what the run earned — no bars, no totals", () => {
    const t = tallyFor(RUN, null, RULES)
    expect(t.lines.every((l) => l.standing === null)).toBe(true)
    expect(t.total).toBeNull()
    expect(text(html(RUN, null))).toContain("+576")
    expect(text(html(RUN, null))).not.toContain("Total XP")
  })
})

describe("the reason breakdown (criterion 8)", () => {
  it("expands from the ledger rows, XP descending, in words", () => {
    const tally = tallyFor(RUN, {}, RULES)
    const h = renderToStaticMarkup(
      <TallyView summary={SUMMARY} tally={tally} skillName={(id) => names[id] ?? id} expanded={new Set(["wayfaring"])} />,
    )
    expect(text(h)).toContain("318 new ground · 196 familiar ground · 62 re-armed ground")
    expect(h).toContain('aria-expanded="true"')
    expect(h.match(/data-breakdown/g)).toHaveLength(1)
  })

  it("is closed by default", () => {
    expect(html(RUN)).not.toContain("data-breakdown")
  })
})

describe("beat 3 interrupts beat 2 where §3.2 says (0082)", () => {
  it("a line that crossed a level hands off as its count lands; Total Level after its line fades in", () => {
    const up = tallyFor([row("constitution", "constitution_share", 500), row("wayfaring", "recent_ground", 100)], { constitution: cumulativeXp(41) - 100, wayfaring: cumulativeXp(20) + 10 }, RULES)
    const start = (i: number) => 300 + 240 * i
    const t = cardTriggers(up, { lineStart: start, countMs: 700, fadeMs: 180 }, (l) => [l.skillId], 3, () => ["total"])
    // Constitution (line 0) crossed 41; Wayfaring (line 1) did not.
    expect(t).toEqual([
      { at: 1000, cards: ["constitution"] },
      { at: start(3) + 180, cards: ["total"] },
    ])
  })

  it("no level, no Total Level line, no trigger", () => {
    const flat = tallyFor([row("wayfaring", "recent_ground", 100)], { wayfaring: cumulativeXp(20) + 10 }, RULES)
    expect(cardTriggers(flat, { lineStart: () => 0, countMs: 700, fadeMs: 180 }, () => ["x"], null, () => ["total"])).toEqual([])
  })
})
