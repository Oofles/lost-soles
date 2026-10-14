import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { tallyLineCount, TallyView } from "@/app/run/[activityId]/run-ledger"
import { LevelUpCard } from "@/components/level-up-card"
import { REVEAL_RAMP } from "@/lib/fog/mask"
import { cardAt, cardReducedAt, CARD_MS } from "@/lib/level-up/beat3"
import type { LevelCard } from "@/lib/level-up/cards"
import { EMPTY_COLLECTION, type RunSummary } from "@/lib/runs/wire"
import { BUNDLED_RULES } from "@/rules/xp-rules.bundled"
import type { RuleSet } from "@/src/rules/schema"

import { beat1At, BEAT1_MS, beat1ReducedAt, REDUCED_FADE_MS } from "./beat1"
import { beat2At, beat2End, beat2ReducedAt, BEAT2_MS, RISE_MS } from "./beat2"
import { tallyFor } from "./tally"

/**
 * Ticket `0084`, criteria 5 and 6. §3.4: under `prefers-reduced-motion` *"only the motion is removed,
 * never the order and never the content"*. The frame functions are where both live, so this is where
 * both are held; the browser comparison of the two modes' rendered text is in the ticket's smoke.
 */

const SUMMARY: RunSummary = {
  activityId: "a-9",
  startedAt: "2026-08-28T11:00:00.000Z",
  startedAtLocal: "2026-08-28T07:00:00",
  name: "Morning Run",
  kind: "run",
  distanceM: 8400,
  elapsedS: 2600,
  movingS: 2530,
  source: "manual",
  newCellCount: 21,
  rearmedCellCount: 3,
  cellCount: 0,
  route: EMPTY_COLLECTION,
  reveal: { new: [], rearmed: [] },
}
const RULES = BUNDLED_RULES[Math.max(...Object.keys(BUNDLED_RULES).map(Number))] as RuleSet
const row = (skillId: string, reason: string, xpAwarded: number) => ({ skillId, reason, xpAwarded, xpRulesVersion: RULES.version, isFloor: false })
const TALLY = tallyFor([row("wayfaring", "new_ground", 840), row("cartography", "cells_new", 45)], { wayfaring: 1000 }, RULES)
const COUNT = tallyLineCount(TALLY, SUMMARY)
const names: Record<string, string> = { wayfaring: "Wayfaring", cartography: "Cartography" }
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
const tallyText = (frame: ReturnType<typeof beat2At>) =>
  text(renderToStaticMarkup(<TallyView summary={SUMMARY} tally={TALLY} skillName={(id) => names[id] ?? id} frame={frame} />))

const SAMPLES = (end: number, step = 50) => Array.from({ length: Math.ceil(end / step) + 1 }, (_, i) => Math.min(end, i * step))

describe("beat 1, reduced: a single 400 ms cross-fade (criterion 5)", () => {
  it("no lantern, no bloom, no pulse — at any moment", () => {
    for (const t of SAMPLES(BEAT1_MS + 100)) {
      const f = beat1ReducedAt(t)
      expect(f.lantern).toBe(0)
      expect(f.pulse).toBe(0)
      expect(f.bloom.clock).toBeLessThan(0)
    }
  })

  it("every reveal cell (arc 0) fades in together, linearly, over exactly 400 ms", () => {
    // The mask's weight for a cell at arc 0 is `progress / REVEAL_RAMP` (mask.ts `revealed`).
    const weight = (t: number) => {
      const p = beat1ReducedAt(t).progress
      return p >= 1 ? 1 : Math.min(1, p / REVEAL_RAMP)
    }
    expect(REDUCED_FADE_MS).toBe(400)
    expect(weight(0)).toBe(0)
    expect(weight(100)).toBeCloseTo(0.25, 9)
    expect(weight(200)).toBeCloseTo(0.5, 9)
    expect(weight(399)).toBeLessThan(1)
    expect(weight(400)).toBe(1)
    expect(beat1ReducedAt(400).progress).toBe(1)
  })

  it("the beat keeps its length: the map is held before the numbers exactly as long as in full motion", () => {
    expect(beat1ReducedAt(BEAT1_MS - 1).phase).not.toBe("done")
    expect(beat1ReducedAt(BEAT1_MS).phase).toBe("done")
    expect(beat1At(BEAT1_MS).phase).toBe("done")
  })
})

describe("beat 2, reduced: the ledger fades in complete (criterion 5)", () => {
  it("numbers do not count: every line is final, in place and opaque from the first frame", () => {
    for (const t of SAMPLES(BEAT2_MS)) {
      for (const l of beat2ReducedAt(t, COUNT).lines) expect(l).toEqual({ opacity: 1, dy: 0, count: 1 })
    }
  })

  it("the panel fades in over the rise's 300 ms (as an opacity), and the phases are the full beat's", () => {
    expect(beat2ReducedAt(0, COUNT).rise).toBe(0)
    expect(beat2ReducedAt(RISE_MS / 2, COUNT).rise).toBeCloseTo(0.5, 9)
    expect(beat2ReducedAt(RISE_MS, COUNT).rise).toBe(1)
    for (const t of SAMPLES(BEAT2_MS + 100)) expect(beat2ReducedAt(t, COUNT).phase).toBe(beat2At(t, COUNT).phase)
  })

  it("the tally reads its final numbers at t = 0 in reduced motion, and not in full motion", () => {
    const final = tallyText(beat2End(COUNT))
    expect(tallyText(beat2ReducedAt(0, COUNT))).toBe(final)
    expect(tallyText(beat2At(RISE_MS + 100, COUNT))).not.toBe(final)
  })
})

describe("cards, reduced: appear and hold without scaling (criterion 5)", () => {
  it("never scales — so never overshoots — while the full card does peak past 1", () => {
    let fullPeak = 0
    for (const t of SAMPLES(CARD_MS, 5)) {
      expect(cardReducedAt(t).scale).toBe(1)
      fullPeak = Math.max(fullPeak, cardAt(t).scale)
    }
    expect(fullPeak).toBeGreaterThan(1.01)
  })

  it("same 1.4 s, same phases; the border is drawn from the start, the number swaps without rising", () => {
    for (const t of SAMPLES(CARD_MS + 50, 25)) {
      const r = cardReducedAt(t)
      expect(r.phase).toBe(cardAt(t).phase)
      expect(r.border).toBe(1)
      expect(r.newDy).toBe(0)
    }
  })

  it("the card's markup carries no transform in reduced motion", () => {
    const card: LevelCard = { kind: "skill", skillId: "wayfaring", from: 4, to: 5, tier: null, place: null } as LevelCard
    const html = renderToStaticMarkup(<LevelUpCard card={card} frame={cardReducedAt(1250)} skillName={(id) => names[id] ?? id} reduced />)
    expect(html).toContain("transform:none")
    expect(html).not.toMatch(/scale\(/)
  })
})

/**
 * CRITERION 6. Reduced motion changes no content. Rendered text is compared between the two modes at
 * the points where the full sequence has settled — the tally after its count, a card at its hold — and
 * must be identical: the same rows, lines and numbers.
 */
describe("reduced motion changes no content (criterion 6)", () => {
  it("the settled tally: identical text in both modes", () => {
    expect(tallyText(beat2ReducedAt(BEAT2_MS, COUNT))).toBe(tallyText(beat2At(BEAT2_MS, COUNT)))
    expect(tallyText(beat2ReducedAt(BEAT2_MS, COUNT))).toContain("Wayfaring")
  })

  it.each([
    { kind: "skill", skillId: "wayfaring", from: 4, to: 5, tier: null, place: null },
    { kind: "skill", skillId: "wayfaring", from: 49, to: 50, tier: "Adept", place: "landmark", arc: 0.5 },
    { kind: "total", milestone: 100 },
  ])("a card at its hold: identical text in both modes (%o)", (c) => {
    const card = c as unknown as LevelCard
    const draw = (frame: ReturnType<typeof cardAt>, reduced: boolean) =>
      text(renderToStaticMarkup(<LevelUpCard card={card} frame={frame} skillName={(id) => names[id] ?? id} reduced={reduced} />))
    expect(draw(cardReducedAt(1000), true)).toBe(draw(cardAt(1000), false))
  })
})
