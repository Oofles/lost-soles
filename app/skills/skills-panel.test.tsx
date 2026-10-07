import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import type { CachedSkill } from "@/lib/log/optimistic"
import { FIFTEEN } from "@/lib/skills/__fixtures__/fifteen-skills"
import { nextLine } from "@/lib/skills/next"
import { skillsPanel, type SkillTile } from "@/lib/skills/panel"
import { BUNDLED_RULES } from "@/rules/xp-rules.bundled"
import type { RuleSet } from "@/src/rules/schema"
import { cumulativeXp } from "@/src/scoring/levels"

import { SkillsPanel } from "./skills-panel"

/**
 * Ticket 0073 — what a script can answer about `/skills`' markup. Whether the Total Level reads
 * in two seconds and the panel looks right is the operator's (D-229).
 */

const rules = BUNDLED_RULES[Math.max(...Object.keys(BUNDLED_RULES).map(Number))] as RuleSet
const enabled = rules.skills.filter((s) => s.enabled).sort((a, b) => a.displayOrder - b.displayOrder)
const activity = enabled.filter((s) => s.kind === "activity")
const meta = enabled.filter((s) => s.kind === "meta")

// Every skill trained except the last activity one, so all three sections render.
const untrainedSkill = activity[activity.length - 1]!
const standing = enabled.filter((s) => s !== untrainedSkill).map((s, i) => ({ skillId: s.id, xp: cumulativeXp(8 + i) + 11 }))
const model = skillsPanel(rules, standing)
const next = nextLine(rules, model.activity, { [activity[0]!.id]: [50] })
const html = renderToStaticMarkup(<SkillsPanel model={model} next={next} />)

const tilesIn = (fragment: string) => [...fragment.matchAll(/data-skill="([^"]+)"/g)].map((m) => m[1])

describe("/skills markup (0073)", () => {
  it("has a way back to the map", () => {
    const back = /<a [^>]*>/.exec(html)?.[0] ?? ""
    expect(back).toContain('href="/"')
    expect(back).toContain('aria-label="Back to the map"')
  })

  it("renders every enabled skill exactly once, each with a sigil, a name and a level", () => {
    expect(tilesIn(html).sort()).toEqual(enabled.map((s) => s.id).sort())
    for (const s of enabled) expect(html).toContain(`aria-label="${s.name}, level `)
    // One svg per tile, plus the header's crest mark.
    expect(html.match(/<svg/g)).toHaveLength(enabled.length + 1)
  })

  it("renders ACTIVITY, then META, then the collapsed Untrained group", () => {
    const a = html.indexOf('aria-label="ACTIVITY"')
    const m = html.indexOf('aria-label="META"')
    const u = html.indexOf("data-untrained")
    expect(a).toBeGreaterThan(0)
    expect(m).toBeGreaterThan(a)
    expect(u).toBeGreaterThan(m)
    expect(html).toMatch(/<details[^>]*data-untrained=""[^>]*>/)
    expect(html).not.toMatch(/<details[^>]*open/)
    expect(html).toContain("Untrained (1)")
    expect(tilesIn(html.slice(a, m))).toEqual(activity.filter((s) => s !== untrainedSkill).map((s) => s.id))
    expect(tilesIn(html.slice(m, u))).toEqual(meta.map((s) => s.id))
    expect(tilesIn(html.slice(u))).toEqual([untrainedSkill.id])
  })

  it("shows Total Level once, in the header: META holds skills and nothing else (D-289)", () => {
    expect(html).not.toContain("data-crest")
    const metaSection = /<section aria-label="META">[\s\S]*?<\/section>/.exec(html)![0]
    expect(metaSection.match(/<li>/g)).toHaveLength(meta.length)
    expect(html.match(new RegExp(`>${model.totalLevel}<`, "g"))).toHaveLength(1)
  })

  it("pins a header carrying TOTAL LEVEL and Total XP", () => {
    const pinned = /<div style="position:sticky;top:0[^"]*">[\s\S]*?data-total[\s\S]*?Total XP/.exec(html)
    expect(pinned).not.toBeNull()
    expect(html).toContain("TOTAL LEVEL")
    expect(html).toContain(`>${model.totalLevel}<`)
    expect(html).toContain(new Intl.NumberFormat("en-US").format(model.totalXp))
    expect(html).toContain(`next: ${model.rung.to}`)
  })

  it("draws levels in tabular figures", () => {
    for (const t of [...model.activity, ...model.meta]) {
      expect(html).toContain(`font-variant-numeric:tabular-nums;font-size:1.5rem;line-height:1.1;color:var(--text-primary)">${t.level}<`)
    }
  })

  it("shows NEXT as exactly one line", () => {
    const card = /<section aria-label="Next"[\s\S]*?<\/section>/.exec(html)![0]
    expect(card.match(/<p/g)).toHaveLength(1)
    expect(card).toContain(next!)
    expect(card).not.toMatch(/<ul|<ol|<li/)
  })

  it("omits the NEXT card entirely when there is no honest estimate", () => {
    expect(renderToStaticMarkup(<SkillsPanel model={model} next={null} />)).not.toContain('aria-label="Next"')
  })

  it("tints meta bars verdigris and activity bars gold (§5.3 rule 5)", () => {
    const metaSection = /<section aria-label="META">[\s\S]*?<\/section>/.exec(html)![0]
    expect(metaSection).toContain("var(--progress-meta)")
    const activitySection = /<section aria-label="ACTIVITY">[\s\S]*?<\/section>/.exec(html)![0]
    expect(activitySection).not.toContain("var(--progress-meta)")
  })

  it("contains no instruction: no target, goal, prompt, warning or decay (D-013, H2)", () => {
    const text = html.replace(/<[^>]+>/g, " ")
    expect(text).not.toMatch(/\b(goal|target|train this|you should|neglect|decay|streak|missed|overdue|inactive|days? ago)\b/i)
  })

  it("has no spinner and no empty-state copy", () => {
    expect(html).not.toMatch(/spinner|loading|aria-busy|no skills|nothing here/i)
  })
})

describe("app/skills/ source (0073)", () => {
  const dir = import.meta.dirname
  const sources = readdirSync(dir)
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f))
    .map((f) => [f, readFileSync(join(dir, f), "utf8")] as const)

  it("scans the page's files", () => {
    expect(sources.map(([f]) => f)).toEqual(expect.arrayContaining(["page.tsx", "skills-page.tsx", "skills-panel.tsx"]))
  })

  it("the server component reads no session, so the route stays static and deep-linkable (D-282)", () => {
    const page = sources.find(([f]) => f === "page.tsx")![1]
    expect(page).not.toMatch(/currentUserId|cookies|headers|fetchAuthSession/)
  })

  it("sorts nothing by level, XP or recency (§5.3 rule 2)", () => {
    for (const [f, src] of sources) expect(src, f).not.toMatch(/\.sort\(/)
  })
})

/**
 * Ticket 0075 — §5.3's six rules against a fifteen-skill registry. What a browser has to answer
 * (no horizontal scroll at ~400 px, the header staying put under a real scroll) was measured in
 * headless Chromium and is recorded in the ticket; this is the half the markup can prove.
 */
describe("/skills in year ten (0075)", () => {
  const r15 = FIFTEEN
  const all = r15.skills.filter((s) => s.enabled).sort((a, b) => a.displayOrder - b.displayOrder)
  const leftAlone = all.filter((s) => s.kind === "activity").at(-1)!
  const standing15 = all.filter((s) => s !== leftAlone).map((s, i) => ({ skillId: s.id, xp: cumulativeXp(5 + i) + 3 }))
  const m15 = skillsPanel(r15, standing15)
  const html15 = renderToStaticMarkup(<SkillsPanel model={m15} next={nextLine(r15, m15.activity, {})} />)
  const tileHtml = (fragment: string, id: string) => new RegExp(`<a [^>]*data-skill="${id}"[^>]*>[\\s\\S]*?</a>`).exec(fragment)![0]

  it("keeps the three sections — fifteen skills open no fourth", () => {
    expect([...html15.matchAll(/<section aria-label="([^"]+)"/g)].map((x) => x[1])).toEqual(["ACTIVITY", "META"])
    expect(html15.match(/<details/g)).toHaveLength(1)
    expect(html15).toContain("Untrained (1)")
    expect(tilesIn(html15)).toEqual([...m15.activity, ...m15.meta, ...m15.untrained].map((t) => t.skillId))
  })

  it("pins the header with fifteen skills: Total Level and Total XP sit inside it, and every tile below it", () => {
    const sticky = html15.indexOf('<div style="position:sticky;top:0')
    const stickyEnd = html15.indexOf('<section aria-label="ACTIVITY"')
    const header = html15.slice(sticky, stickyEnd)
    expect(sticky).toBeGreaterThan(0)
    expect(header).toContain(`>${m15.totalLevel}<`)
    expect(header).toContain(new Intl.NumberFormat("en-US").format(m15.totalXp))
    expect(tilesIn(header)).toEqual([])
    // The header is the page's own sticky band, not a box that scrolls with the grid.
    expect(html15).not.toMatch(/overflow(-y)?:(auto|scroll)/)
  })

  it("lays every section out in shrinkable columns, so nothing can push the page sideways", () => {
    const grids = html15.match(/<ul style="[^"]*display:grid[^"]*"[^>]*>/g)!
    expect(grids).toHaveLength(3)
    for (const g of grids) expect(g).toContain('class="skills-grid"')
  })

  it("has exactly two column counts: three, and five at ≥1024px — never auto-fill (D-289)", () => {
    const css = /<style>([\s\S]*?)<\/style>/.exec(html15)![1]!
    const cols = [...css.matchAll(/grid-template-columns:\s*([^;}]+)/g)].map((x) => x[1]!.trim())
    expect(cols).toEqual(["repeat(3, minmax(0, 1fr))", "repeat(5, minmax(0, 1fr))"])
    expect(css).toMatch(/@media \(min-width: 1024px\) \{[^@]*repeat\(5/)
    expect(css).not.toMatch(/auto-fill|auto-fit/)
    // And nothing inline overrides the class.
    expect(html15).not.toMatch(/style="[^"]*grid-template-columns/)
  })

  it("tints each bar by the row's kind, never by which skill it is (rule 5)", () => {
    const fills = (frag: string) => ({
      meta: (frag.match(/var\(--progress-meta\)/g) ?? []).length,
      activity: (frag.match(/var\(--progress-activity\)/g) ?? []).length,
    })
    for (const t of [...m15.activity, ...m15.meta, ...m15.untrained]) {
      expect(fills(tileHtml(html15, t.skillId)), t.skillId).toEqual(t.kind === "meta" ? { meta: 1, activity: 0 } : { meta: 0, activity: 1 })
    }
    // Swap every tile's kind and the tint follows: nothing keyed it to an id.
    const swap = (ts: SkillTile[]) => ts.map((t) => ({ ...t, kind: t.kind === "meta" ? ("activity" as const) : ("meta" as const) }))
    const flipped = renderToStaticMarkup(<SkillsPanel model={{ ...m15, activity: swap(m15.activity), meta: swap(m15.meta) }} next={null} />)
    for (const t of m15.activity) expect(fills(tileHtml(flipped, t.skillId))).toEqual({ meta: 1, activity: 0 })
    for (const t of m15.meta) expect(fills(tileHtml(flipped, t.skillId))).toEqual({ meta: 0, activity: 1 })
  })

  it("says nothing imperative: no target, streak, goal, decay or neglect (rule 6)", () => {
    const text = html15.replace(/<[^>]+>/g, " ")
    expect(text).not.toMatch(
      /\b(goals?|targets?|streaks?|decay(s|ing)?|neglect(ed)?|train this|you should|should|must|need to|try|don'?t|keep up|aim|challenge|behind|losing|missed|overdue|inactive|days? ago|last trained)\b/i,
    )
  })

  it("draws a skill untouched for a year exactly like one trained today at the same level (D-013)", () => {
    const [a, b] = all.filter((s) => s.kind === "activity")
    const xp = cumulativeXp(3) + 20
    const yearAgo = Date.parse("2025-10-07T08:00:00Z")
    const today = Date.parse("2026-10-07T08:00:00Z")
    // Whatever recency the cache might one day carry, it is not an input to a tile.
    const stale = { skillId: a!.id, xp, lastAwardedAt: new Date(yearAgo).toISOString() } as CachedSkill
    const fresh = { skillId: b!.id, xp, lastAwardedAt: new Date(today).toISOString() } as CachedSkill
    const m = skillsPanel(r15, [stale, fresh])
    const out = renderToStaticMarkup(<SkillsPanel model={m} next={null} />)
    const strip = (h: string, s: typeof a) => h.replaceAll(s!.id, "ID").replaceAll(s!.name, "NAME")
    const ta = strip(tileHtml(out, a!.id), a)
    const tb = strip(tileHtml(out, b!.id), b)
    // The sigil is the one thing that differs by design: it IS the skill.
    const noSigil = (h: string) => h.replace(/<svg[\s\S]*?<\/svg>/, "")
    expect(noSigil(ta)).toEqual(noSigil(tb))
    expect(noSigil(ta)).toContain(">3<")
  })
})
