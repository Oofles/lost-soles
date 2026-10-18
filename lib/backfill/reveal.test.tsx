import { cellToLatLng } from "h3-js"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { AggregateLedgerPanel } from "@/components/backfill/backfill-reveal"
import { REVEAL_HI, REVEAL_LO, V1_NOISE_AMP } from "@/lib/fog/fog-uniforms"
import { mercatorX, mercatorY } from "@/lib/fog/instances"
import { REVEAL_RAMP } from "@/lib/fog/mask"
import { CARD_MS } from "@/lib/level-up/beat3"
import { bigToCell } from "@/src/domain/explored-blob"

import { AFTER_CELLS, BEFORE_CELLS, IMPORTED, NEMO, WINDOW } from "./__fixtures__/three-hundred"
import type { BackfillMark } from "./batch"
import {
  addedCells,
  AGGREGATE_END,
  aggregateAt,
  aggregateLedger,
  aggregateReducedAt,
  aggregateRevealCells,
  BURN_MS,
  CARD_AT,
  LEDGER_AT,
  REDUCED_FADE_MS,
} from "./reveal"

/**
 * Ticket `0257`, criteria 2, 4 and 5. A 300-activity import is ONE sequence: one 4 s burn of the
 * whole archive, one ledger of lifetime totals and starting levels, one Total Level card — never a
 * sequence per activity. And under reduced motion the same sequence with the motion taken out.
 */

const MARK: BackfillMark = {
  batchId: WINDOW.from,
  window: WINDOW,
  imported: { count: IMPORTED.length, firstStartedAt: IMPORTED[0]!.startedAt, lastStartedAt: IMPORTED.at(-1)!.startedAt },
  before: {
    generation: 40,
    cells: BEFORE_CELLS.length,
    activities: 20,
    skills: [
      { skillId: "wayfaring", xp: 5159, rulesVersionLastComputed: 3 },
      { skillId: "cartography", xp: 16439, rulesVersionLastComputed: 3 },
    ],
    totalLevel: 0,
    totalXp: 0,
  },
  after: {
    generation: 340,
    cells: AFTER_CELLS.length,
    activities: 300,
    skills: [
      { skillId: "wayfaring", xp: 31482, rulesVersionLastComputed: 3 },
      { skillId: "cartography", xp: 26678, rulesVersionLastComputed: 3 },
      { skillId: "roving", xp: 1017, rulesVersionLastComputed: 3 },
    ],
    totalLevel: 0,
    totalXp: 0,
  },
}

const SAMPLES = (end: number, step = 50) => Array.from({ length: Math.ceil(end / step) + 1 }, (_, i) => Math.min(end, i * step))

describe("the import's ground (300 activities)", () => {
  const added = addedCells(AFTER_CELLS, BEFORE_CELLS)
  const cells = aggregateRevealCells(added, NEMO)

  it("is every cell the import added, and nothing the map already held", () => {
    const before = new Set(BEFORE_CELLS)
    expect(added.length).toBe(AFTER_CELLS.length - BEFORE_CELLS.length)
    expect(added.every((c) => !before.has(c))).toBe(true)
    expect(new Set(cells.map((c) => c.cell))).toEqual(new Set(added.map(bigToCell)))
  })

  it("burns outward from where the map is looking, at a steady count of cells", () => {
    const dist = (cell: string) => {
      const [lat, lng] = cellToLatLng(cell)
      return Math.hypot(mercatorX(lng) - mercatorX(NEMO.lng), mercatorY(lat) - mercatorY(NEMO.lat))
    }
    for (let i = 1; i < cells.length; i++) {
      expect(cells[i]!.arc).toBeGreaterThanOrEqual(cells[i - 1]!.arc)
      expect(dist(cells[i]!.cell)).toBeGreaterThanOrEqual(dist(cells[i - 1]!.cell) - 1e-9)
    }
    expect(cells[0]!.arc).toBe(0)
    expect(cells.at(-1)!.arc).toBeCloseTo(1, 4)
    // Rank, not distance: the middle cell sits at the middle of the clock.
    expect(cells[Math.floor(cells.length / 2)]!.arc).toBeCloseTo(0.5, 2)
  })

  it("is all new ground, so all of it blooms gold", () => {
    expect(cells.every((c) => c.ground === "new")).toBe(true)
  })

  it("is nothing when the import added no ground", () => {
    expect(aggregateRevealCells(addedCells(BEFORE_CELLS, BEFORE_CELLS), NEMO)).toEqual([])
  })
})

describe("one sequence: the burn, the ledger, one card (criterion 2)", () => {
  it("burns the whole archive over exactly 4 s", () => {
    expect(BURN_MS).toBe(4000)
    expect(aggregateAt(0).progress).toBe(0)
    expect(aggregateAt(2000).progress).toBeCloseTo(0.5)
    expect(aggregateAt(BURN_MS).progress).toBe(1)
    expect(aggregateAt(BURN_MS - 1).phase).toBe("burn")
    // Nothing but the map while it burns (§3.2: the map first).
    for (const t of SAMPLES(BURN_MS - 1)) {
      expect(aggregateAt(t).ledger).toBe(0)
      expect(aggregateAt(t).card).toBe(false)
    }
  })

  it("then the ledger, then ONE card, then done", () => {
    expect(aggregateAt(LEDGER_AT).phase).toBe("ledger")
    expect(aggregateAt(LEDGER_AT + 400).ledger).toBe(1)
    const carded = SAMPLES(AGGREGATE_END + 100, 10).filter((t) => aggregateAt(t).card)
    expect(carded[0]).toBe(CARD_AT)
    expect(carded.at(-1)).toBeLessThan(CARD_AT + CARD_MS)
    // One contiguous stretch: one card, not a queue.
    expect(carded.every((t, i) => i === 0 || t - carded[i - 1]! === 10)).toBe(true)
    expect(aggregateAt(AGGREGATE_END).phase).toBe("done")
    expect(AGGREGATE_END).toBe(8400)
  })

  it("plays the same sequence for 50 activities or 300 — nothing in the clock counts them", () => {
    expect(aggregateAt.length).toBe(1)
    expect(aggregateReducedAt.length).toBe(1)
  })

  it("fades the bloom out after the burn, so no bloom is cut off mid-flush", () => {
    expect(aggregateAt(1000).bloom.fade).toBe(1)
    expect(aggregateAt(BURN_MS + 150).bloom.fade).toBeGreaterThan(0)
    expect(aggregateAt(BURN_MS + 300).bloom.clock).toBeLessThan(0)
  })
})

describe("reduced motion (criterion 4, §3.4)", () => {
  it("the burn is a single 400 ms cross-fade across the visible band, then holds", () => {
    expect(aggregateReducedAt(0).progress).toBe(0)
    const band = [REVEAL_LO - V1_NOISE_AMP / 2, REVEAL_HI + V1_NOISE_AMP / 2]
    expect(aggregateReducedAt(1).progress).toBeCloseTo(REVEAL_RAMP * band[0]!, 3)
    expect(aggregateReducedAt(REDUCED_FADE_MS).progress).toBe(1)
    for (const t of SAMPLES(AGGREGATE_END)) {
      expect(aggregateReducedAt(t).bloom.clock).toBeLessThan(0)
      expect(aggregateReducedAt(t).rise).toBe(0)
    }
  })

  it("keeps every boundary and every part: only the motion goes", () => {
    for (const t of SAMPLES(AGGREGATE_END + 100, 25)) {
      expect(aggregateReducedAt(t).phase).toBe(aggregateAt(t).phase)
      expect(aggregateReducedAt(t).card).toBe(aggregateAt(t).card)
      expect(aggregateReducedAt(t).ledger > 0).toBe(aggregateAt(t).ledger > 0)
    }
  })
})

describe("the ledger: lifetime totals and starting levels", () => {
  const ledger = aggregateLedger(MARK)

  it("names what came in, by count and span", () => {
    expect(ledger.imported).toMatch(/^278 activities · Feb 2020 – /)
  })

  it("shows lifetime totals — never a period", () => {
    expect(ledger.totals.map((t) => t.label)).toEqual(["Activities", "Cells revealed", "Lifetime XP"])
    expect(ledger.totals[0]!.value).toBe("300")
    expect(ledger.totals[1]!.detail).toBe(`+${(AFTER_CELLS.length - BEFORE_CELLS.length).toLocaleString("en-US")}`)
    expect(ledger.totals[2]!.value).toBe((31482 + 26678 + 1017).toLocaleString("en-US"))
  })

  it("lists every trained skill at its starting level, with where it stood before", () => {
    const roving = ledger.skills.find((s) => s.skillId === "roving")!
    expect(roving.from).toBe(1)
    expect(roving.level).toBeGreaterThan(1)
    const wayfaring = ledger.skills.find((s) => s.skillId === "wayfaring")!
    expect(wayfaring.level).toBeGreaterThan(wayfaring.from)
    expect(ledger.totalLevel.to).toBeGreaterThan(ledger.totalLevel.from)
  })

  it("plays exactly one card, Total Level at its new value", () => {
    expect(ledger.card).toEqual({ kind: "total", milestone: ledger.totalLevel.to })
  })

  it("renders as plain DOM, with no map at all (§3.4: the numbers never depend on the graphics)", () => {
    const html = renderToStaticMarkup(<AggregateLedgerPanel ledger={ledger} />)
    const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")
    expect(text).toContain("Your history")
    expect(text).toContain("STARTING LEVELS")
    expect(text).toContain(`Total Level ${ledger.totalLevel.to} was ${ledger.totalLevel.from}`)
    expect(html).not.toMatch(/\b(week|today|since|streak)\b/i)
  })
})
