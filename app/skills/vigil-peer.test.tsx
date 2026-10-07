import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { sigilPaths, FALLBACK_SEAL } from "@/components/sigil"
import type { CachedSkill } from "@/lib/log/optimistic"
import { nextLine } from "@/lib/skills/next"
import { skillsPanel, type SkillsPanelModel } from "@/lib/skills/panel"
import { BUNDLED_RULES } from "@/rules/xp-rules.bundled"
import type { Activity } from "@/src/domain/activity"
import { NO_CELLS } from "@/src/domain/discovery"
import type { RuleSet } from "@/src/rules/schema"
import { scoreActivity, xpBySkill } from "@/src/scoring"
import { cumulativeXp, totalLevelCeiling } from "@/src/scoring/levels"

import { SkillsPanel } from "./skills-panel"

/**
 * THE VIGIL TEST — the UI half of D-132. Ticket 0076, `06-ui-ux.md` §5.2.
 *
 * `src/rules/registry-delta.test.ts` proves a GPS-less run is SCORED as a separate skill by data
 * alone. This proves the panel DRAWS it that way: Vigil is a registry row, and `/skills` adds
 * nothing to it — no layout change, no section, no special case. Every assertion is a
 * comparison against Wayfaring or against the panel without the row, so it holds whatever the
 * rows' order, names or count become.
 *
 * Skill ids are named here because this is a test (I-25's exemption) and its subject is two
 * particular rows. Nothing it exercises names them.
 */

const rules = BUNDLED_RULES[Math.max(...Object.keys(BUNDLED_RULES).map(Number))] as RuleSet
const VIGIL = "vigil"
const WAYFARING = "wayfaring"
const CARTOGRAPHY = "cartography"
const vigilRow = rules.skills.find((s) => s.id === VIGIL)!
const enabled = rules.skills.filter((s) => s.enabled).sort((a, b) => a.displayOrder - b.displayOrder)

// Everything trained, so every tile sits in ACTIVITY or META and none hides in Untrained.
const standing: CachedSkill[] = enabled.map((s, i) => ({ skillId: s.id, xp: cumulativeXp(6 + i) + 13 }))
const render = (r: RuleSet, st: readonly CachedSkill[]) => {
  const m = skillsPanel(r, st)
  return { model: m, html: renderToStaticMarkup(<SkillsPanel model={m} next={nextLine(r, m.activity, {})} />) }
}
const { model, html } = render(rules, standing)

const tileHtml = (h: string, id: string) => new RegExp(`<a [^>]*data-skill="${id}"[^>]*>[\\s\\S]*?</a>`).exec(h)?.[0]
const section = (h: string, label: string) => new RegExp(`<section aria-label="${label}">[\\s\\S]*?</section>`).exec(h)![0]
const tileOf = (m: SkillsPanelModel, id: string) => [...m.activity, ...m.meta, ...m.untrained].find((t) => t.skillId === id)

describe("THE VIGIL TEST, UI half — Vigil is a peer of Wayfaring on /skills (0076, D-132)", () => {
  it("the registry row is the shape the ticket describes: activity, km, full rate, no ground multipliers", () => {
    expect(vigilRow).toMatchObject({ kind: "activity", enabled: true, unit: "km", xpPerUnit: 100, groundMultipliers: null })
    expect(vigilRow.feeds.map((f) => f.skill)).toContain("constitution")
  })

  it("renders as an ACTIVITY tile at its registry position, from its row alone", () => {
    const activityRows = enabled.filter((s) => s.kind === "activity").map((s) => s.id)
    const drawn = [...section(html, "ACTIVITY").matchAll(/data-skill="([^"]+)"/g)].map((x) => x[1])
    expect(drawn).toEqual(activityRows)
    expect(drawn.indexOf(VIGIL)).toBe(activityRows.indexOf(VIGIL))
  })

  it("is the same tile as Wayfaring — same component, sizing, bar and gold tint — at the same XP", () => {
    const xp = cumulativeXp(7) + 40
    const m = skillsPanel(rules, [
      { skillId: VIGIL, xp },
      { skillId: WAYFARING, xp },
    ])
    const out = renderToStaticMarkup(<SkillsPanel model={m} next={null} />)
    const neutral = (h: string, id: string, name: string) =>
      h.replaceAll(id, "ID").replaceAll(name, "NAME").replace(/<svg[\s\S]*?<\/svg>/, "<svg/>")
    const wayfaringRow = rules.skills.find((s) => s.id === WAYFARING)!
    expect(neutral(tileHtml(out, VIGIL)!, VIGIL, vigilRow.name)).toEqual(
      neutral(tileHtml(out, WAYFARING)!, WAYFARING, wayfaringRow.name),
    )
    expect(tileHtml(out, VIGIL)).toContain("var(--progress-activity)")
  })

  it("wears its sigil from rules/sigils.json — a data lookup, not the fallback seal and not a branch", () => {
    expect(sigilPaths(VIGIL)).not.toEqual(FALLBACK_SEAL)
    expect(sigilPaths(VIGIL)).not.toEqual(sigilPaths(WAYFARING))
  })

  it("removing the row removes the tile and nothing else: no gap, no reflow, no empty slot", () => {
    const without: RuleSet = { ...rules, skills: rules.skills.filter((s) => s.id !== VIGIL) }
    const smaller = render(
      without,
      standing.filter((s) => s.skillId !== VIGIL),
    )
    const vigilLi = new RegExp(`<li><a [^>]*data-skill="${VIGIL}"[\\s\\S]*?</a></li>`)
    expect(section(html, "ACTIVITY")).toMatch(vigilLi)
    expect(section(html, "ACTIVITY").replace(vigilLi, "")).toEqual(section(smaller.html, "ACTIVITY"))
    expect(section(smaller.html, "META")).toEqual(section(html, "META"))
    expect(smaller.html).not.toContain(`data-skill="${VIGIL}"`)
    expect(smaller.html).not.toMatch(/<li>\s*<\/li>/)
  })

  it("renaming it is one edit to `name`: every occurrence changes, and nothing else does", () => {
    const NEW = "Nightwatch"
    expect(html).not.toContain(NEW)
    const renamed: RuleSet = { ...rules, skills: rules.skills.map((s) => (s.id === VIGIL ? { ...s, name: NEW } : s)) }
    const out = render(renamed, standing).html
    expect(html).toContain(vigilRow.name)
    expect(out).not.toContain(vigilRow.name)
    expect(out).toEqual(html.replaceAll(vigilRow.name, NEW))
  })

  it("counts in Total Level, and the ceiling is enabled rows × maxLevel with it included (D-192)", () => {
    const vigilLevel = tileOf(model, VIGIL)!.level
    const without = skillsPanel({ ...rules, skills: rules.skills.filter((s) => s.id !== VIGIL) }, standing)
    expect(model.totalLevel - without.totalLevel).toBe(vigilLevel)
    expect(model.ceiling).toBe(totalLevelCeiling(rules.skills, rules.curve))
    expect(model.ceiling).toBe(enabled.length * rules.curve.maxLevel)
    expect(model.ceiling - without.ceiling).toBe(rules.curve.maxLevel)
  })

  it("Vigil and Wayfaring level independently: an award to one never moves the other", () => {
    for (const [moved, still] of [
      [VIGIL, WAYFARING],
      [WAYFARING, VIGIL],
    ] as const) {
      const after = render(
        rules,
        standing.map((s) => (s.skillId === moved ? { ...s, xp: s.xp + cumulativeXp(12) } : s)),
      )
      expect(tileOf(after.model, moved)!.level).toBeGreaterThan(tileOf(model, moved)!.level)
      expect(tileHtml(after.html, still)).toEqual(tileHtml(html, still))
    }
  })
})

/**
 * The whole path, as far as the panel is concerned: a GPS-less 5 km run through the real
 * scorer, its ledger rows summed the way `SkillState` is, and drawn. That such a run writes no
 * `ExploredCell` is `process-activity.test.ts`' "a traceless run reveals nothing either" — so the
 * award passed here is `NO_CELLS`, the award ingest computes for it.
 */
describe("a GPS-less run moves Vigil, and not Wayfaring or Cartography (0076, I-27)", () => {
  const run = {
    activityId: "treadmill-1",
    userId: "u-1",
    kind: "run",
    startedAt: "2026-10-07T03:00:00.000Z",
    startedAtLocal: "2026-10-06T21:00:00",
    timezone: "America/Denver",
    elapsedS: 1800,
    distanceM: 5000,
    source: { source: "manual", externalId: "m-1", sourceTypeRaw: "treadmill", fetchedAt: "2026-10-07T03:31:00.000Z" },
    raw: null,
    traceRef: null,
    hasTrace: false,
    sets: [],
    dedupeKey: "d",
    ingestedAt: "2026-10-07T03:31:00.000Z",
    revision: 1,
  } as unknown as Activity
  const rows = scoreActivity(run, rules, null, NO_CELLS, run.ingestedAt)
  const awarded = xpBySkill(rows)
  const after = render(
    rules,
    standing.map((s) => ({ ...s, xp: s.xp + (awarded.get(s.skillId) ?? 0) })),
  )

  it("scores Vigil at full rate, and writes no Wayfaring and no Cartography row", () => {
    expect(awarded.get(VIGIL)).toBe(5 * vigilRow.xpPerUnit)
    expect(awarded.has(WAYFARING)).toBe(false)
    expect(rows.some((r) => r.skillId === CARTOGRAPHY)).toBe(false)
  })

  it("the panel moves Vigil's tile and leaves Wayfaring's and Cartography's byte-identical", () => {
    expect(tileOf(after.model, VIGIL)!.xp).toBe(tileOf(model, VIGIL)!.xp + awarded.get(VIGIL)!)
    expect(tileHtml(after.html, VIGIL)).not.toEqual(tileHtml(html, VIGIL))
    expect(tileHtml(after.html, WAYFARING)).toEqual(tileHtml(html, WAYFARING))
    expect(tileHtml(after.html, CARTOGRAPHY)).toEqual(tileHtml(html, CARTOGRAPHY))
  })
})
