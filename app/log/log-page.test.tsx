import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { FALLBACK_SEAL, sigilPaths } from "@/components/sigil"
import { logColumns } from "@/lib/log/layout"
import { formatValue } from "@/lib/log/rows"
import { BUNDLED_RULES } from "@/rules/xp-rules.bundled"
import type { RuleSet } from "@/src/rules/schema"

/**
 * Tickets 0068 and 0071 — the halves a script can answer. Whether the page READS right, and
 * whether a log takes under three seconds without hunting, is the operator's (D-229).
 *
 * The first render is what a cold, offline open shows: rows from the bundled registry, before
 * IndexedDB or the network have said anything. That it is COMPLETE is criterion 5's
 * "renders fully", asserted on the markup.
 */
vi.mock("@/lib/log/transport", () => ({
  currentUid: vi.fn(async () => undefined),
  fetchSkills: vi.fn(async () => []),
  sendLog: vi.fn(),
}))

const { LogPage } = await import("./log-page")
const { default: Log } = await import("./page")
const { RowName } = await import("./log-row")

const newest = BUNDLED_RULES[Math.max(...Object.keys(BUNDLED_RULES).map(Number))] as RuleSet
const columns = logColumns(newest)
const items = columns.flatMap((c) => c.items)
const rows = items.flatMap((i) => (i.kind === "row" ? [i.row] : []))
const splits = items.flatMap((i) => (i.kind === "split" ? [i.split] : []))
const html = renderToStaticMarkup(<LogPage />)
/** A label as the markup carries it: v5's "Core & total body" (D-483) is the first with an `&`. */
const esc = (s: string) => s.replace(/&/g, "&amp;")

describe("/log's first render (0068)", () => {
  it("is the page the route serves", () => {
    expect(renderToStaticMarkup(<Log />)).toBe(html)
  })

  it("renders every entry, in the layout's columns and order, with no network (0344)", () => {
    const groups = [...html.matchAll(/role="group" aria-label="([^"]+)"/g)].map((m) => m[1])
    expect(groups).toEqual(items.map((i) => esc(i.kind === "row" ? `${i.row.skillName}: ${i.row.label}` : i.split.label)))
  })

  it("draws the layout's column headings, in order (0344, D-485)", () => {
    const headings = [...html.matchAll(/<h2 [^>]*>([^<]+)<\/h2>/g)].map((m) => m[1])
    expect(headings).toEqual(columns.map((c) => c.title.toUpperCase()))
  })

  it("every row has −, the number, + and LOG, each with an accessible name (0071)", () => {
    for (const r of rows) {
      const label = esc(r.label)
      expect(html).toContain(`aria-label="Decrease ${label} by`)
      expect(html).toContain(`aria-label="Increase ${label} by`)
      expect(html).toMatch(new RegExp(`aria-label="${label}, (count|minutes and seconds|kilometres|minutes)"`))
      // Before IndexedDB answers, the number is the registry's fallback (D-282).
      expect(html).toContain(`aria-label="Log ${formatValue(r, r.fallback)} ${label}"`)
    }
    expect(html.match(/>LOG</g)).toHaveLength(rows.length + splits.length)
  })

  it("has a way back to the map", () => {
    const back = /<a [^>]*>/.exec(html)?.[0] ?? ""
    expect(back).toContain('href="/"')
    expect(back).toContain('aria-label="Back to the map"')
  })

  it("has no page-level save, no dialog, and nothing draggable (0068, 0071)", () => {
    expect(html).not.toMatch(/role="(alert)?dialog"/)
    expect(html).not.toMatch(/<dialog/)
    expect(html).not.toMatch(/draggable/)
    expect(html).not.toMatch(/>(Save|Done)</i)
    expect(html).not.toMatch(/type="submit"/)
  })

  it("every row draws its skill's sigil, decorative, before the name (0245, 06 §6.3–6.4)", () => {
    for (const r of rows) {
      const row = new RegExp(`<div[^>]*role="group" aria-label="${esc(`${r.skillName}: ${r.label}`)}"[\\s\\S]*?>LOG<`).exec(html)![0]
      const svg = /<svg[^>]*>[\s\S]*?<\/svg>/.exec(row)![0]
      expect(svg, r.skillId).toContain('aria-hidden="true"')
      for (const d of sigilPaths(r.skillId)) expect(svg, r.skillId).toContain(`d="${d}"`)
      expect(row.indexOf("<svg"), "sigil before name").toBeLessThan(row.indexOf(r.skillName.toUpperCase()))
    }
  })

  it("a skill with no sigil entry wears the fallback seal (0245)", () => {
    const head = renderToStaticMarkup(<RowName row={{ skillId: "no-such-skill", skillName: "Nobody" }} />)
    for (const d of FALLBACK_SEAL) expect(head).toContain(`d="${d}"`)
    expect(head).toContain("NOBODY")
  })

  it("a split entry: length at its fallback, one share slider per member at 0%, LOG disabled (0344)", () => {
    expect(splits.length).toBeGreaterThan(0)
    for (const s of splits) {
      const card = new RegExp(`<div[^>]*role="group" aria-label="${esc(s.label)}"[\\s\\S]*?LOG waits for 100%`).exec(html)![0]
      expect(card).toContain(`aria-label="Decrease workout length by ${s.step} min"`)
      expect(card).toContain(`value="${s.fallback} min"`)
      for (const m of s.members) {
        expect(card).toMatch(new RegExp(`role="slider" tabindex="-1" aria-label="${esc(m.label)} share" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"`))
        expect(card).toContain(`>${esc(m.label)}</span>`)
      }
      expect(card).toMatch(new RegExp(`<button type="button" disabled="" aria-label="Log ${s.fallback} min ${esc(s.label.toLowerCase())}"`))
      expect(card).toContain("0% — 100% left to place")
      for (const d of sigilPaths(s.splitId)) expect(card).toContain(`d="${d}"`)
    }
  })

  it("never shows the schema's unit words as a label", () => {
    expect(html).not.toMatch(/>\s*(reps|seconds)\s*</)
  })
})

describe("app/log/ source (0068, 0071)", () => {
  const dir = import.meta.dirname
  const sources = readdirSync(dir)
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f))
    .map((f) => [f, readFileSync(join(dir, f), "utf8")] as const)

  it("scans the page's files", () => {
    expect(sources.map(([f]) => f)).toEqual(expect.arrayContaining(["page.tsx", "log-page.tsx", "log-row.tsx"]))
  })

  it("never asks for confirmation, and binds no swipe or drag (0071)", () => {
    for (const [f, src] of sources) {
      expect(src, f).not.toMatch(/\bconfirm\(|window\.confirm|<dialog|role="dialog"/)
      expect(src, f).not.toMatch(/onDrag|draggable|onSwipe|onTouchMove/)
    }
  })

  it("both row states draw the head through RowName, so the confirmed row keeps its sigil (0245)", () => {
    const row = sources.find(([f]) => f === "log-row.tsx")![1]
    expect(row.match(/<RowName row=\{row\} \/>/g)).toHaveLength(2)
  })

  it("the level-up queue is given prefers-reduced-motion, read as the queue starts (0258, 06 §3.4)", () => {
    const page = sources.find(([f]) => f === "log-page.tsx")![1]
    // The query is read where a queue is created, not at render — so it is the current setting.
    expect(page).toMatch(/setReduced\(window\.matchMedia\?\.\(REDUCED_MOTION_QUERY\)\.matches === true\)\s*\n\s*setCards\(queue\)/)
    const queue = page.match(/<LevelUpQueue[\s\S]*?\/>/)![0]
    expect(queue).toMatch(/\breduced=\{reduced\}/)
  })

  it("the server component reads no session, so the route stays static (D-282)", () => {
    const page = sources.find(([f]) => f === "page.tsx")![1]
    expect(page).not.toMatch(/currentUserId|cookies|headers|fetchAuthSession/)
  })
})
