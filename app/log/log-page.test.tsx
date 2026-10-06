import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { formatValue, logRows } from "@/lib/log/rows"
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

const newest = BUNDLED_RULES[Math.max(...Object.keys(BUNDLED_RULES).map(Number))] as RuleSet
const rows = logRows(newest)
const html = renderToStaticMarkup(<LogPage />)

describe("/log's first render (0068)", () => {
  it("is the page the route serves", () => {
    expect(renderToStaticMarkup(<Log />)).toBe(html)
  })

  it("renders one row per registry row, in registry order, with no network", () => {
    const groups = [...html.matchAll(/role="group" aria-label="([^"]+)"/g)].map((m) => m[1])
    expect(groups).toEqual(rows.map((r) => `${r.skillName}: ${r.label}`))
  })

  it("every row has −, the number, + and LOG, each with an accessible name (0071)", () => {
    for (const r of rows) {
      expect(html).toContain(`aria-label="Decrease ${r.label} by`)
      expect(html).toContain(`aria-label="Increase ${r.label} by`)
      expect(html).toMatch(new RegExp(`aria-label="${r.label}, (count|minutes and seconds)"`))
      // Before IndexedDB answers, the number is the registry's fallback (D-282).
      expect(html).toContain(`aria-label="Log ${formatValue(r, r.fallback)} ${r.label}"`)
    }
    expect(html.match(/>LOG</g)).toHaveLength(rows.length)
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

  it("the server component reads no session, so the route stays static (D-282)", () => {
    const page = sources.find(([f]) => f === "page.tsx")![1]
    expect(page).not.toMatch(/currentUserId|cookies|headers|fetchAuthSession/)
  })
})
