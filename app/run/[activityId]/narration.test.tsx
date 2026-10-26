import { readFileSync } from "node:fs"
import { join } from "node:path"

import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { cardWords, LevelUpCard } from "@/components/level-up-card"
import { cardAt } from "@/lib/level-up/beat3"
import { skillCards } from "@/lib/level-up/cards"
import { COUNT_MS, FADE_MS, lineStart } from "@/lib/run-moment/beat2"
import { BEAT4_START, BEAT5_START } from "@/lib/run-moment/beat45"
import { cardTriggers, tallyFor } from "@/lib/run-moment/tally"
import { EMPTY_COLLECTION, type RunSummary } from "@/lib/runs/wire"
import { BUNDLED_RULES } from "@/rules/xp-rules.bundled"
import type { RuleSet } from "@/src/rules/schema"
import { cumulativeXp } from "@/src/scoring/levels"

import { narrationOrder, revealWords, tallyWords } from "./narration"
import { tallyLineCount } from "./run-ledger"

/**
 * TICKET `0112` — *"the post-run reveal is narrated in beat order"* (06 §9.4), the half a test can
 * hold. What a real screen reader makes of it, in a real browser, is the operator's (D-229).
 */

const RULES = BUNDLED_RULES[Math.max(...Object.keys(BUNDLED_RULES).map(Number))] as RuleSet
const names: Record<string, string> = { wayfaring: "Wayfaring", cartography: "Cartography" }
const skillName = (id: string) => names[id] ?? id
const row = (skillId: string, reason: string, xpAwarded: number) => ({ skillId, reason, xpAwarded, xpRulesVersion: RULES.version, isFloor: false })

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
  cellCount: 30,
  route: EMPTY_COLLECTION,
  reveal: { new: [], rearmed: [] },
}

// Wayfaring sits 10 XP under level 12, so this run's 840 crosses it: one skill card.
const BEFORE = { wayfaring: cumulativeXp(12) - 10, cartography: 500 }
const TALLY = tallyFor([row("wayfaring", "new_ground", 840), row("cartography", "cells_new", 45)], BEFORE, RULES)

describe("beat 1's words (0112)", () => {
  it("names the run and its date, then what the map revealed", () => {
    expect(revealWords(SUMMARY)).toBe("Morning Run, Fri 28 Aug 2026. 21 new cells revealed, 3 remembered.")
  })

  it("a run that revealed nothing says the route joins the web — never a zero, never 'No new' (§3.5, 0085)", () => {
    const words = revealWords({ ...SUMMARY, name: null, newCellCount: 0, rearmedCellCount: 0 })
    expect(words).toBe("Your run, Fri 28 Aug 2026. The route joins your web.")
    expect(words).not.toMatch(/\b0 cells|No new|\(halved\)/i)
  })
})

describe("beat 2's words (0112)", () => {
  const words = tallyWords(TALLY, SUMMARY, skillName)

  it("one string per line beat 2 counts in, index for index", () => {
    expect(words).toHaveLength(tallyLineCount(TALLY, SUMMARY))
  })

  it("are the settled tally — each skill's gain and level, then the footers — never a frame of the count", () => {
    expect(words[0]).toBe(`Wayfaring, plus 840 XP, level ${TALLY.lines[0]!.standing!.levelAfter}.`)
    expect(words[1]).toBe(`Cartography, plus 45 XP, level ${TALLY.lines[1]!.standing!.levelAfter}.`)
    expect(words).toContain("21 cells claimed, 3 remembered.")
    expect(words).toContain(`Total Level ${TALLY.totalLevel}.`)
    expect(words.some((w) => /^Total XP .*plus 885\.$/.test(w))).toBe(true)
  })

  it("a run with no new ground says what it added, in distance, and no zero (§3.5)", () => {
    const flat = { ...SUMMARY, newCellCount: 0, rearmedCellCount: 0 }
    const w = tallyWords(tallyFor([row("wayfaring", "distance", 420)], BEFORE, RULES), flat, skillName)
    expect(w).toContain("8.40 km added to the record.")
    expect(w.join(" ")).not.toMatch(/\b0 cells|No new|\(halved\)/i)
  })
})

describe("the narration's order is the beats' order (0112, 06 §9.4)", () => {
  const n = tallyLineCount(TALLY, SUMMARY)
  const triggers = cardTriggers(
    TALLY,
    { lineStart: (i) => lineStart(i, n), countMs: COUNT_MS, fadeMs: FADE_MS },
    (line) => skillCards(line.skillId, line.standing!.xpBefore, line.xp, RULES.curve),
    null,
    () => [],
  )
  const order = narrationOrder({ lines: n, lineStart, triggers, beat4Start: BEAT4_START, beat5Start: BEAT5_START })
  const key = (x: (typeof order)[number]) => ("line" in x ? `2.${x.line}` : "trigger" in x ? `3.${x.trigger}` : String(x.beat))

  it("the fixture levels Wayfaring up, so there is a card to place", () => {
    expect(triggers).toHaveLength(1)
  })

  it("beat 1 first; every tally line in order; beat 4 then beat 5 last", () => {
    const keys = order.map(key)
    expect(keys[0]).toBe("1")
    expect(keys.slice(-2)).toEqual(["4", "5"])
    const lines = keys.filter((k) => k.startsWith("2."))
    expect(lines).toEqual(Array.from({ length: n }, (_, i) => `2.${i}`))
  })

  it("the card is spoken after its own line, and after every line already on screen when it lands", () => {
    const keys = order.map(key)
    const card = keys.indexOf("3.0")
    expect(card).toBeGreaterThan(keys.indexOf("2.0"))
    for (let i = 0; i < n; i++) {
      const spokenBefore = keys.indexOf(`2.${i}`) < card
      expect(spokenBefore, `line ${i}`).toBe(lineStart(i, n) <= triggers[0]!.at)
    }
  })
})

describe("one region, not one per beat (0112, 06 §9.4)", () => {
  // Code only: the file's own comments describe the region and would count as a second one.
  const src = readFileSync(join(import.meta.dirname, "run-sequence.tsx"), "utf8")
    .split("\n")
    .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
    .join("\n")

  it("RunSequence mounts exactly one aria-live region, and the cards speak through it", () => {
    expect(src.match(/aria-live=/g)).toHaveLength(1)
    expect(src).toMatch(/<LevelUpQueue[\s\S]*?announce=\{/)
  })

  it("a narrated card has no region of its own; an unnarrated one (on /log) still does", () => {
    const card = skillCards("wayfaring", BEFORE.wayfaring, 840, RULES.curve)[0]!
    const silent = renderToStaticMarkup(<LevelUpCard card={card} frame={cardAt(0)} skillName={skillName} silent />)
    const loud = renderToStaticMarkup(<LevelUpCard card={card} frame={cardAt(0)} skillName={skillName} />)
    expect(silent).not.toContain("aria-live")
    expect(loud).toContain("aria-live")
    expect(loud).toContain(cardWords(card, skillName))
  })
})
