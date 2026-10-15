import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { TallyView } from "@/app/run/[activityId]/run-ledger"
import { chronicleRow } from "@/lib/chronicle/rows"
import type { ActivityLedgerRow } from "@/lib/runs/ledger"
import type { RunListItem } from "@/lib/runs/wire"
import { discoveryRow, runTerritory } from "@/lib/stats/derived"
import { loadRuleSet } from "@/src/rules/load"
import { ledgerEntries } from "@/src/scoring/ledger"
import { discoveryRows } from "@/src/scoring/propagate"
import type { RuleSet } from "@/src/rules/schema"
import { cumulativeXp, levelForXp, totalLevel } from "@/src/scoring/levels"

import { breakdownText, cardTriggers, tallyFor } from "./tally"

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

  it("without a `before`, rows still show what the run earned — no bars, no transition, no Total Level", () => {
    const t = tallyFor(RUN, null, RULES)
    expect(t.lines.every((l) => l.standing === null)).toBe(true)
    expect(t.total).toBeNull()
    expect(text(html(RUN, null))).toContain("+576")
    expect(text(html(RUN, null))).not.toContain("→")
    expect(text(html(RUN, null))).not.toContain("Total Level")
  })

  it("0265: without a `before`, Total XP is still on screen as the run's own gain (§3.5, D-310)", () => {
    const t = tallyFor(RUN, null, RULES)
    const h = text(html(RUN, null))
    expect(h).toContain(`Total XP +${t.runXp.toLocaleString("en-US")}`)
    expect(h.match(/Total XP/g)).toHaveLength(1)
    expect(h).not.toMatch(/(^|[^\d,.])0([^\d,.]|$)/)
  })

  it("0265: with a `before`, the transition line is unchanged", () => {
    const h = text(html([row("constitution", "constitution_share", 500)], { constitution: 1000 }))
    expect(h).toContain("Total XP 1,000 → 1,500 (+500)")
  })
})

describe("the reason breakdown (criterion 8)", () => {
  it("expands from the ledger rows, XP descending, in words", () => {
    const tally = tallyFor(RUN, {}, RULES)
    const h = renderToStaticMarkup(
      <TallyView summary={SUMMARY} tally={tally} skillName={(id) => names[id] ?? id} expanded={new Set(["wayfaring"])} />,
    )
    expect(text(h)).toContain("318 XP new ground · 196 XP familiar ground · 62 XP remembered ground")
    expect(h).toContain('aria-expanded="true"')
    expect(h.match(/data-breakdown/g)).toHaveLength(1)
  })

  it("is closed by default", () => {
    expect(html(RUN)).not.toContain("data-breakdown")
  })
})

describe("the breakdown labels XP as XP, never as cells (0277)", () => {
  // Wave 1's smoke: `58 cells claimed · 2 remembered` expanded to `125 new cells · 2 remembered
  // cells`. Real ruleset, the ledger's own derivation, the stored counts — the run as it was.
  const V2 = loadRuleSet(2)
  const cartography = discoveryRow(V2)!
  const stored = { newCellCount: 58, rearmedCellCount: 2 }
  const feed = runTerritory(stored, V2)
  const ledger: ActivityLedgerRow[] = ledgerEntries(discoveryRows(stored, [cartography]), {
    activity: { activityId: "a-277", userId: "u", startedAt: "2026-10-14T11:00:00Z" },
    rules: V2,
    awardedAt: "2026-10-14T12:00:00Z",
  }).map((e) => ({ skillId: e.skillId, reason: e.reason, xpAwarded: e.xpAwarded, units: e.units, xpRulesVersion: 2, isFloor: false }))
  const summary = { startedAtLocal: "2026-10-14T07:00:00", distanceM: 5000, ...stored }
  const item: RunListItem = {
    activityId: "a-277",
    startedAt: "2026-10-14T11:00:00Z",
    startedAtLocal: summary.startedAtLocal,
    name: null,
    kind: "run",
    distanceM: 5000,
    durationS: 1800,
    newCellCount: stored.newCellCount,
    traced: true,
    sets: [],
  }
  const h = renderToStaticMarkup(
    <TallyView summary={summary} tally={tallyFor(ledger, {}, V2)} skillName={(id) => id} expanded={new Set([cartography.id])} />,
  )
  const page = text(h)
  const breakdown = text(h.match(/<p data-breakdown[^>]*>(.*?)<\/p>/)![1])

  it("tally, Chronicle row and the 0090 feed name the same cells", () => {
    expect(feed.newCellCount).toBe(58)
    expect(feed.rearmedCellCount).toBe(2)
    expect(page).toContain(`${feed.newCellCount} cells claimed · ${feed.rearmedCellCount} remembered`)
    expect(chronicleRow(item, (id) => id).newCells).toBe(`${feed.newCellCount} new`)
  })

  it("the breakdown is XP, sums to the feed's cartographyXp, and carries no cell-count noun", () => {
    expect(breakdown).toBe("125 XP new ground · 2 XP remembered ground")
    expect(breakdown).not.toMatch(/cells/)
    const xp = [...breakdown.matchAll(/([\d,]+) XP/g)].map((m) => Number(m[1].replace(/,/g, "")))
    expect(xp.reduce((a, b) => a + b, 0)).toBe(feed.cartographyXp)
  })

  it("every reason a run can carry is worded without a cell noun, and says XP", () => {
    const parts = ["new_ground", "rearmed_ground", "recent_ground", "cells_new", "cells_rearmed", "constitution_share"].map(
      (reason) => ({ reason, xp: 10 }),
    )
    expect(breakdownText(parts)).not.toMatch(/cells/)
    expect(breakdownText(parts).split(" · ").every((p) => /^10 XP \S/.test(p))).toBe(true)
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

describe("a run with no new ground says what it added, in distance (0085)", () => {
  const NONE = { ...SUMMARY, distanceM: 5100, newCellCount: 0, rearmedCellCount: 0 }
  const rows = [row("wayfaring", "recent_ground", 255, { units: 5.1 }), row("constitution", "constitution_share", 85)]
  const view = (summary: typeof SUMMARY) =>
    text(renderToStaticMarkup(<TallyView summary={summary} tally={tallyFor(rows, {}, RULES)} skillName={(id) => names[id] ?? id} />))

  it("stands the distance where the cells line would be", () => {
    expect(view(NONE)).toContain("5.10 km added to the record")
    expect(view(NONE)).not.toMatch(/cells|never run before/)
  })

  it("is absent on a run that claimed ground — the cells line says it there", () => {
    expect(view(SUMMARY)).not.toContain("added to the record")
  })

  it("is absent without a distance, and Total XP still carries the bottom", () => {
    const t = view({ ...NONE, distanceM: null as unknown as number })
    expect(t).not.toContain("added to the record")
    expect(t).toMatch(/Total XP/)
  })
})


describe("the expand hint (0267, 06 §3.2)", () => {
  it("says a row expands — click, on the desktop — muted, 12px, aria-hidden", () => {
    const h = html(RUN, {})
    expect(text(h)).toContain("click a row for ⌄")
    expect(h).toMatch(/<p aria-hidden="true" data-hint="expand" style="[^"]*font-size:\.75rem[^"]*color:var\(--text-muted\)/)
  })

  it("is absent when there is no row to expand", () => {
    expect(html([], {})).not.toContain("data-hint")
  })
})
