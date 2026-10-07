import { readFileSync } from "node:fs"
import { join } from "node:path"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { skillDetail, type DetailLedgerRow, type PlaceMilestone } from "@/lib/skills/detail"
import { BUNDLED_RULES } from "@/rules/xp-rules.bundled"
import type { RuleSet } from "@/src/rules/schema"
import { cumulativeXp } from "@/src/scoring/levels"

import { SkillSheet } from "./skill-sheet"

/**
 * Ticket 0074 — the sheet's markup. Esc, the scrim, back and `→ fly to` need a browser and are
 * probed in headless Chromium (recorded in the ticket); this is the half the markup can prove.
 * Skill ids are named because this is a test (I-25's exemption).
 */

const rules = BUNDLED_RULES[Math.max(...Object.keys(BUNDLED_RULES).map(Number))] as RuleSet
const NOW = Date.parse("2026-10-07T12:00:00Z")
const enabled = rules.skills.filter((s) => s.enabled)
const noop = () => {}

function ledger(skillId: string, count: number): DetailLedgerRow[] {
  return Array.from({ length: count }, (_, i) => {
    const startedAt = new Date(NOW - (1 + i * 2) * 86_400_000).toISOString()
    return {
      skillId, activityId: `a${i}`, reason: "distance", units: 5, xpAwarded: 500,
      xpRulesVersion: rules.version, isFloor: false, seq: `${startedAt}#a${i}#00`,
    }
  })
}

function render(skillId: string, places: PlaceMilestone[] = [], count = 12) {
  const rows = ledger(skillId, count)
  const detail = skillDetail(rules, skillId, [{ skillId, xp: cumulativeXp(30) + 123 }], rows, places, NOW)
  return renderToStaticMarkup(<SkillSheet skillId={skillId} detail={detail} onDismiss={noop} onFly={noop} />)
}

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")

describe("the skill sheet (0074)", () => {
  it("renders every enabled registry skill, activity and meta, from the one component", () => {
    for (const s of enabled) {
      const html = render(s.id)
      expect(html, s.id).toContain('role="dialog"')
      expect(text(html), s.id).toContain(s.name.toUpperCase())
      expect(text(html), s.id).toMatch(/Level 30/)
    }
  })

  it("an unknown skill id renders a graceful not-found inside the sheet", () => {
    const html = renderToStaticMarkup(<SkillSheet skillId="no-such" detail={null} onDismiss={noop} onFly={noop} />)
    expect(html).toContain("data-not-found")
    expect(html).toContain('aria-label="Close"')
  })

  it("the header carries xp / next and <n> XP to L+1, and ~N runs", () => {
    const t = text(render("wayfaring"))
    const xp = cumulativeXp(30) + 123
    expect(t).toContain(`${xp.toLocaleString("en-US")} / ${cumulativeXp(31).toLocaleString("en-US")}`)
    expect(t).toContain(`${(cumulativeXp(31) - xp).toLocaleString("en-US")} XP to 31`)
    expect(t).toMatch(/~\d+ runs?/)
  })

  it("RECENT shows ten rows and a '… n more' that is text, not a link or button", () => {
    const html = render("wayfaring", [], 14)
    expect(html.match(/data-recent=""/g)).toHaveLength(10)
    const more = /<p data-more=""[^>]*>([\s\S]*?)<\/p>/.exec(html)!
    expect(more[1]).toContain("4 more")
    expect(more[0]).not.toMatch(/<a |<button/)
  })

  it("Vigil's sheet omits ON THE MAP and does not claim half on ground run before (from 0076)", () => {
    const html = render("vigil")
    expect(html).not.toContain("ON THE MAP")
    expect(text(html)).not.toMatch(/half on ground/)
    expect(text(render("wayfaring"))).toMatch(/half on ground you have run before/)
  })

  it("ON THE MAP appears only with place-bound milestones, each with → fly to", () => {
    expect(render("wayfaring")).not.toContain("ON THE MAP")
    const html = render("wayfaring", [{ level: 25, label: "Cairn at Level 25 — Beck Rd", lng: -83.1, lat: 27.5 }])
    expect(html).toContain("ON THE MAP")
    expect(text(html)).toContain("Cairn at Level 25 — Beck Rd")
    expect(text(html)).toContain("→ fly to")
  })

  it("AHEAD shows tier names and no calendar date", () => {
    const t = text(render("wayfaring"))
    expect(t).toContain("Adept")
    expect(t).toContain("Mastery")
    const ahead = /<section aria-label="AHEAD">([\s\S]*?)<\/section>/.exec(render("wayfaring"))![1]!
    expect(text(ahead)).not.toMatch(/\b(19|20)\d\d\b|\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/)
  })

  it("contains no chart, graph or sparkline", () => {
    for (const s of enabled) {
      const html = render(s.id)
      expect(html).not.toMatch(/<canvas|<polyline|<line |\b(chart|graph|sparkline)\b/i)
      // The sigil is the only drawing on the sheet.
      expect((html.match(/<svg/g) ?? []).length, s.id).toBeLessThanOrEqual(1)
    }
  })

  it("names no skill in its source (I-25)", () => {
    const dir = import.meta.dirname
    for (const f of ["skill-sheet.tsx", "skill-sheet-route.tsx", join("[skillId]", "page.tsx")]) {
      const src = readFileSync(join(dir, f), "utf8")
      for (const s of rules.skills) expect(src, `${f}: ${s.id}`).not.toMatch(new RegExp(`["'\`]${s.id}["'\`]`))
    }
  })
})
