import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { EMPTY_COLLECTION, type RunSummary } from "@/lib/runs/wire"

import { LedgerView } from "./run-ledger"
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
  route: EMPTY_COLLECTION,
}

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")
const noop = () => {}
const names: Record<string, string> = { wayfaring: "Wayfaring", cartography: "Cartography" }

function ledgerHtml() {
  return renderToStaticMarkup(
    <LedgerView
      summary={SUMMARY}
      ledger={{ lines: [{ skillId: "wayfaring", xp: 840 }, { skillId: "cartography", xp: 45 }], totalXp: 885 }}
      skillName={(id) => names[id] ?? id}
    />,
  )
}

describe("the static end state (criterion 2)", () => {
  const html = renderToStaticMarkup(
    <EndState summary={SUMMARY} map={<div data-testid="map-shell" />} ledger={<div dangerouslySetInnerHTML={{ __html: ledgerHtml() }} />} kind={null} onRelive={noop} />,
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
      <EndState summary={SUMMARY} map={null} ledger={<div dangerouslySetInnerHTML={{ __html: ledgerHtml() }} />} kind={null} onRelive={noop} />,
    )
    const t = text(html)
    expect(t).toContain("Wayfaring")
    expect(t).toContain("+840")
    expect(t).toContain("Cartography")
    expect(t).toContain("21 cells claimed")
    expect(t).toContain("Total XP +885")
    expect(html).toContain('data-slot="chronicle-line"')
    expect(html).toContain('data-slot="frontier-line"')
  })

  it("never renders a zero: an absent rearmed count leaves no '0 remembered'", () => {
    expect(text(ledgerHtml())).not.toMatch(/\b0 (remembered|cells)/)
  })
})

describe("autoplay is the entry point's intent, and nothing else", () => {
  it("no intent → the end state, with no sequence mounted", () => {
    const html = renderToStaticMarkup(<RunMoment summary={SUMMARY} autoplay={false} home={null} />)
    expect(html).toContain('data-phase="end"')
  })

  it("intent → the sequence, over the end state", () => {
    const html = renderToStaticMarkup(<RunMoment summary={SUMMARY} autoplay home={null} />)
    expect(html).toContain('data-phase="sequence"')
    expect(html).toContain('data-slot="ledger"')
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
