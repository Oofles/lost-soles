import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { EMPTY_COLLECTION, type RunSummary } from "@/lib/runs/wire"

import { tallyFor } from "@/lib/run-moment/tally"
import { BUNDLED_RULES } from "@/rules/xp-rules.bundled"
import type { RuleSet } from "@/src/rules/schema"

import { TallyView } from "./run-ledger"
import { ChronicleLine, FrontierLine } from "./run-lines"
import { EndState, initialMoment, momentReducer, RunMoment } from "./run-moment"

/**
 * Ticket `0078` — the route's markup and its state. The map, the history seed and the five-minute
 * soak need a browser and were probed in headless Chromium (recorded in the ticket); this is the
 * half the markup can prove.
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
  rearmedCellCount: 0,
  cellCount: 0,
  route: EMPTY_COLLECTION,
  reveal: { new: [], rearmed: [] },
}

const CHRONICLE = "Old roads, run well. The map holds them still."
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")
const noop = () => {}
const names: Record<string, string> = { wayfaring: "Wayfaring", cartography: "Cartography" }

const RULES = BUNDLED_RULES[Math.max(...Object.keys(BUNDLED_RULES).map(Number))] as RuleSet
const row = (skillId: string, reason: string, xpAwarded: number) => ({ skillId, reason, xpAwarded, xpRulesVersion: RULES.version, isFloor: false })

function ledgerHtml() {
  const tally = tallyFor([row("wayfaring", "new_ground", 840), row("cartography", "cells_new", 45)], { wayfaring: 1000 }, RULES)
  return renderToStaticMarkup(<TallyView summary={SUMMARY} tally={tally} skillName={(id: string) => names[id] ?? id} />)
}

describe("the static end state (criterion 2)", () => {
  const html = renderToStaticMarkup(
    <EndState summary={SUMMARY} map={<div data-testid="map-shell" />} ledger={<div dangerouslySetInnerHTML={{ __html: ledgerHtml() }} />} kind={null} onRelive={noop} chronicle={CHRONICLE} frontier={<FrontierLine text="Unclaimed ground 1.2 km north" />} />,
  )

  it("has the map, the ledger, both lines, ⟲ Relive and the route stats", () => {
    expect(html).toContain('data-slot="map"')
    expect(html).toContain('data-slot="ledger"')
    expect(html).toContain('data-slot="chronicle-line"')
    expect(html).toContain('data-slot="frontier-line"')
    expect(text(html)).toContain("⟲ Relive")
    for (const s of ["8.40 km", "42:10", "Fri 28 Aug 2026", "Manual"]) expect(text(html)).toContain(s)
  })

  it("orders map → ledger → chronicle → frontier → Relive → stats (§3.3)", () => {
    const at = (needle: string) => html.indexOf(needle)
    const order = ['data-slot="map"', 'data-slot="ledger"', 'data-slot="chronicle-line"', 'data-slot="frontier-line"', "⟲ Relive", 'aria-label="Route stats"']
    const positions = order.map(at)
    expect(positions.every((p) => p >= 0)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
  })

  it("carries no animation, transition, toast, title card or spinner (§3.2)", () => {
    expect(html).not.toMatch(/animation|transition|@keyframes/i)
    expect(text(html)).not.toMatch(/imported|loading|syncing/i)
    expect(html).not.toMatch(/role="(progressbar|status|alert)"/)
  })
})

describe("the ledger never depends on the graphics (criterion 8)", () => {
  it("renders every row and both lines with the map absent entirely", () => {
    const html = renderToStaticMarkup(
      <EndState summary={SUMMARY} map={null} ledger={<div dangerouslySetInnerHTML={{ __html: ledgerHtml() }} />} kind={null} onRelive={noop} chronicle={CHRONICLE} frontier={<FrontierLine text="Unclaimed ground 1.2 km north" />} />,
    )
    const t = text(html)
    expect(t).toContain("Wayfaring")
    expect(t).toContain("+840")
    expect(t).toContain("Cartography")
    expect(t).toContain("21 cells claimed")
    expect(t).toContain("Total XP 1,000 → 1,885 (+885)")
    expect(html).toContain('data-slot="chronicle-line"')
    expect(html).toContain('data-slot="frontier-line"')
    expect(t).toContain(CHRONICLE)
    expect(t).toContain("◇ Unclaimed ground 1.2 km north")
  })

  it("never renders a zero: an absent rearmed count leaves no '0 remembered'", () => {
    expect(text(ledgerHtml())).not.toMatch(/\b0 (remembered|cells)/)
  })
})

describe("beats 4 and 5's lines (0083)", () => {
  it("the chronicle line is italic serif in its own token, centred, with 22px of air", () => {
    const html = renderToStaticMarkup(<ChronicleLine text={CHRONICLE} />)
    const p = html.match(/<p data-slot="chronicle-line" style="([^"]*)">([^<]*)<\/p>/)
    expect(p?.[2]).toBe(CHRONICLE)
    for (const rule of ["font-style:italic", "font-size:17px", "text-align:center", "color:var(--text-chronicle)", "margin:22px 0"]) {
      expect(p?.[1]).toContain(rule)
    }
  })

  it("in the end state the column's 1.5rem gap is the air, not a margin stacked on it", () => {
    const html = renderToStaticMarkup(
      <EndState summary={SUMMARY} map={null} ledger={null} kind={null} onRelive={noop} chronicle={CHRONICLE} frontier={null} />,
    )
    expect(html).toMatch(/<p data-slot="chronicle-line" style="[^"]*margin:0[;"]/)
    expect(html).toContain(CHRONICLE)
  })

  it("the frontier line is one muted colour, and an empty slot when there is nothing to name", () => {
    const named = renderToStaticMarkup(<FrontierLine text="Unclaimed ground 1.2 km north" />)
    expect(named).toContain("color:var(--text-muted)")
    expect(named.match(/color:/g)).toHaveLength(1)
    expect(renderToStaticMarkup(<FrontierLine text={null} />)).toBe('<p data-slot="frontier-line" style="margin:0"></p>')
  })

  /**
   * Criterion 10. D-013: the line is a signpost, not a task. Its whole code path — the primitive, the
   * picker, the component — holds no notification, badge, countdown, timer, persistence or alarm colour.
   */
  it("has no notification, badge, countdown, timer, memory or alarm colour anywhere in its code path", () => {
    const ROOT = join(import.meta.dirname, "..", "..", "..")
    const path = ["src/domain/frontier.ts", "lib/run-moment/frontier-line.ts", "app/run/[activityId]/run-lines.tsx"]
    for (const f of path) {
      const src = readFileSync(join(ROOT, f), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")
      expect(src, f).not.toMatch(/Notification|badge|countdown|setInterval|setTimeout|localStorage|sessionStorage|indexedDB|oxblood|\bred\b|#[fF]{2}0{4}/)
    }
  })
})

describe("autoplay is the entry point's intent, and nothing else", () => {
  it("no intent → the end state, with no sequence mounted", () => {
    const html = renderToStaticMarkup(<RunMoment summary={SUMMARY} xpBefore={null} autoplay={false} home={null} chronicle={CHRONICLE} />)
    expect(html).toContain('data-phase="end"')
  })

  it("intent → the sequence, over the end state", () => {
    const html = renderToStaticMarkup(<RunMoment summary={SUMMARY} xpBefore={null} autoplay home={null} chronicle={CHRONICLE} />)
    expect(html).toContain('data-phase="sequence"')
    expect(html).toContain('data-slot="ledger"')
  })

  /**
   * `0080` criterion 7: NOTHING BEFORE THE MAP. What exists at route entry, before beat 1's t = 0, is
   * the map and the way back — every part below the map is in the tree (the end state is underneath,
   * `0078`) but held back, and nothing announces anything: no toast, dialog, spinner or title card.
   */
  it("intent → nothing but the map is perceivable before t = 0: no toast, dialog, spinner or title (0080)", () => {
    const html = renderToStaticMarkup(<RunMoment summary={SUMMARY} xpBefore={null} autoplay home={null} chronicle={CHRONICLE} />)
    const column = html.slice(html.indexOf('data-slot="column"'))
    expect(html).toMatch(/<div data-slot="column" aria-hidden="true" style="[^"]*visibility:hidden/)
    // The run's title and the ledger are inside the veiled column, not above it.
    expect(column).toContain("<h1")
    expect(column).toContain('data-slot="ledger"')
    expect(html.slice(0, html.indexOf('data-slot="column"'))).not.toContain("<h1")
    expect(html).not.toMatch(/role="(dialog|alertdialog|alert|status|progressbar)"|<dialog|aria-busy="true"/)
    expect(text(html)).not.toMatch(/imported|loading/i)
  })

  it("no intent → the end state, nothing veiled", () => {
    const html = renderToStaticMarkup(<RunMoment summary={SUMMARY} xpBefore={null} autoplay={false} home={null} chronicle={CHRONICLE} />)
    expect(html).not.toContain("visibility:hidden")
    expect(html).not.toContain('aria-hidden="true"')
  })

  it("⟲ Relive restarts from beat 1 and finishing returns to the same end state (criterion 3)", () => {
    const start = initialMoment(false)
    const playing = momentReducer(start, { type: "relive" })
    expect(playing).toEqual({ phase: "sequence", play: 1 })
    const again = momentReducer(momentReducer(playing, { type: "done" }), { type: "relive" })
    expect(again.play).toBe(2) // a fresh sequence, keyed, not a resumed one
    expect(momentReducer(again, { type: "done" }).phase).toBe("end")
  })

  it("the end state is terminal: nothing but Relive leaves it (criterion 4)", () => {
    const end = initialMoment(false)
    expect(momentReducer(end, { type: "done" })).toBe(end)
  })
})

/**
 * CRITERION 7. Opening the app cold with an unseen import lands on `/` and does NOT auto-play:
 * nothing in the app may navigate to `/run/:id` on its own. A `/run/` link is an act of the user;
 * a `router.push`/`replace`, `redirect` or `location` assignment to one is an ambush (§3.1).
 */
describe("the router never auto-navigates to /run/:id (criterion 7)", () => {
  const ROOT = join(import.meta.dirname, "..", "..", "..")
  const DIRS = ["app", "components", "lib", "middleware.ts"]
  const files: string[] = []
  const walk = (p: string) => {
    if (statSync(p).isDirectory()) {
      for (const f of readdirSync(p)) walk(join(p, f))
    } else if (/\.(ts|tsx)$/.test(p) && !/\.test\.tsx?$/.test(p)) files.push(p)
  }
  for (const d of DIRS) walk(join(ROOT, d))

  it("scans the app", () => expect(files.length).toBeGreaterThan(50))

  it.each([
    /\b(push|replace|prefetch)\(\s*[`'"]\/run\//,
    /\b(push|replace)\(\s*runHref\(/,
    /\bredirect\(\s*([`'"]\/run\/|runHref\()/,
    /location(\.href)?\s*=\s*([`'"]\/run\/|runHref\()/,
    /location\.(assign|replace)\(\s*([`'"]\/run\/|runHref\()/,
  ])("no file navigates to /run/ programmatically: %s", (pattern) => {
    const hits = files.filter((f) => pattern.test(readFileSync(f, "utf8"))).map((f) => relative(ROOT, f))
    expect(hits).toEqual([])
  })
})
