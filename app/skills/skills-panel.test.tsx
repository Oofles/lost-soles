import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { nextLine } from "@/lib/skills/next"
import { skillsPanel } from "@/lib/skills/panel"
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
    // One svg per tile, plus the header's crest and the crest tile.
    expect(html.match(/<svg/g)).toHaveLength(enabled.length + 2)
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

  it("ends META with the crest: Total Level, and inert — not a link, not a button, no handler", () => {
    const metaSection = /<section aria-label="META">[\s\S]*?<\/section>/.exec(html)![0]
    const items = metaSection.match(/<li>[\s\S]*?<\/li>/g)!
    const crest = items[items.length - 1]!
    expect(crest).toContain("data-crest")
    expect(crest).toContain(`aria-label="Total Level ${model.totalLevel}"`)
    expect(crest).not.toMatch(/<a |<button|role="button"|tabindex|onclick/i)
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
