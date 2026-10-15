import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { chronicleRow } from "@/lib/chronicle/rows"
import { CHRONICLE_ROW_PX, maxWindowRows, rowWindow, shouldLoadMore } from "@/lib/chronicle/window"
import type { ChroniclePage, RunListItem } from "@/lib/runs/wire"

/**
 * TICKET 0088 — THE CHRONICLE'S CONTENT, ITS REFUSALS, AND ITS BOUND.
 *
 * Rendered with a FULLY POPULATED synthetic history — 2,000 activities, runs and logged sessions
 * interleaved, some unseen — because a refusal tested against an empty list proves nothing, and a
 * DOM bound tested against fifty rows proves less.
 */
vi.mock("next/navigation", () => ({
  usePathname: () => "/chronicle",
  useRouter: () => ({ back: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}))

vi.mock("@/app/sync-action", () => ({ syncNowAction: vi.fn() }))
vi.mock("@/components/map/map-shell", () => ({ MapShell: () => <div data-testid="map-shell" /> }))

const { ChroniclePanel, CHRONICLE_CSS } = await import("./chronicle-panel")
const { HomeScreen } = await import("@/components/plinth/home-screen")
const { ChronicleRows } = await import("./chronicle-rows")

const ROOT = join(import.meta.dirname, "..", "..")

/** 2,000 activities, one a day backwards from 2026-08-28 — a five-year backfill, newest first. */
function history(n: number): RunListItem[] {
  const out: RunListItem[] = []
  const t0 = Date.UTC(2026, 7, 28, 11)
  for (let i = 0; i < n; i++) {
    const d = new Date(t0 - i * 86_400_000)
    const iso = d.toISOString()
    const logged = i % 5 === 3
    out.push({
      activityId: `a-${i}`,
      startedAt: iso,
      startedAtLocal: iso.slice(0, 19),
      name: logged ? null : "Morning Run",
      kind: logged ? "strength" : "run",
      distanceM: logged ? null : 5000 + (i % 7) * 400,
      durationS: logged ? 300 : 1800,
      newCellCount: logged ? 0 : i % 3,
      traced: !logged,
      sets: logged ? [{ exercise: "pushup", reps: 40 }] : [],
    })
  }
  return out
}

const FIXTURE = history(2000)
const asIs = (id: string) => id
const VIEWPORT = 900 // a ~1440×900 desktop window, the design case (§ "The surface")

function windowAt(scrollTop: number) {
  const { start, end } = rowWindow(scrollTop, VIEWPORT, FIXTURE.length)
  const rows = FIXTURE.slice(start, end).map((r) => chronicleRow(r, asIs))
  const unseen = new Set(FIXTURE.slice(start, end).filter((r) => r.traced && Number(r.activityId.slice(2)) % 4 === 0).map((r) => r.activityId))
  return renderToStaticMarkup(<ChronicleRows rows={rows} start={start} total={FIXTURE.length} unseen={unseen} />)
}

const panel = (initial: ChroniclePage) => renderToStaticMarkup(<ChroniclePanel initial={initial} />)
const FULL = panel({ items: FIXTURE, next: "more" })
const text = (html: string) => html.replace(/<style>[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ")
const liCount = (html: string) => (html.match(/<li\b/g) ?? []).length

describe("the Chronicle's rows (criteria 4, 5)", () => {
  it("are reverse chronological, runs and logged workouts in one list", () => {
    const html = windowAt(0)
    const order = [...html.matchAll(/data-row="(\d+)"/g)].map((m) => Number(m[1]))
    expect(order).toEqual([...order].sort((a, b) => a - b))
    expect(text(html)).toMatch(/Run · 5\.00 km/)
    expect(text(html)).toMatch(/Strength · 40 pushup/)
    expect(text(html)).toMatch(/Fri 28 Aug 2026/)
  })

  it("each opens /run/:id in its END STATE — no autoplay intent on any link", () => {
    const hrefs = [...FULL.matchAll(/href="([^"]*)"/g)].map((m) => m[1]!)
    expect(hrefs.length).toBeGreaterThan(0)
    for (const h of hrefs) expect(h).toMatch(/^\/run\/a-\d+$/)
  })

  it("PUSH, never replace: back from the run is the Chronicle (the operator, 2026-10-15)", () => {
    const src = readFileSync(join(ROOT, "components/chronicle/chronicle-rows.tsx"), "utf8")
    expect(src).toMatch(/<Link\s+href=\{row\.href\}/)
    expect(src).not.toMatch(/<Link[^>]*\breplace\b/)
  })
})

describe("the unseen mark (criterion 6)", () => {
  it("is a gold rule on the row, never a number, badge or dot", () => {
    const html = windowAt(0)
    expect(html).toMatch(/data-unseen=""[^>]*box-shadow:inset 3px 0 0 var\(--accent\)/)
    expect(html).not.toMatch(/badge|\bdot\b|role="status"/i)
    // No count of unseen rows anywhere: the only digits a row carries are its own date, measure and cells.
    expect(text(FULL)).not.toMatch(/\bunseen\b|\d+\s+(new runs|unseen)/i)
  })

  it("is not drawn before the device has answered — no flash of gold on first paint", () => {
    expect(FULL).not.toMatch(/data-unseen/)
  })
})

describe("2,000 activities (criterion 7)", () => {
  it("keeps the DOM bounded by the window, never by the archive", () => {
    const bound = maxWindowRows(VIEWPORT)
    expect(bound).toBeLessThan(40)
    const full = FIXTURE.length * CHRONICLE_ROW_PX
    for (const top of [0, 1234, full / 2, full - VIEWPORT, full + 500]) {
      const n = liCount(windowAt(top))
      expect(n, `at scrollTop ${top}`).toBeGreaterThan(0)
      expect(n, `at scrollTop ${top}`).toBeLessThanOrEqual(bound)
    }
    expect(liCount(FULL)).toBeLessThanOrEqual(bound)
  })

  it("the list is as tall as the history, so the scrollbar is honest", () => {
    expect(windowAt(0)).toContain(`height:${FIXTURE.length * CHRONICLE_ROW_PX}px`)
  })

  it("re-renders a scrolled window well inside the frame budget", () => {
    // A wheel sweep top to bottom, one window per step. §6.4's budget is a frame at 30 fps (33 ms,
    // `09` §8); a desktop browser is held here to 60 fps, 16.7 ms. The work per frame is the
    // window's rows and nothing proportional to the archive — this measures that it stays so.
    const full = FIXTURE.length * CHRONICLE_ROW_PX
    windowAt(0) // warm
    const times: number[] = []
    for (let top = 0; top < full; top += 997) {
      const t = performance.now()
      windowAt(top)
      times.push(performance.now() - t)
    }
    times.sort((a, b) => a - b)
    const p95 = times[Math.floor(times.length * 0.95)]!
    expect(p95).toBeLessThan(16.7)
  })

  it("asks for the next page before the window reaches the end of what is loaded", () => {
    expect(shouldLoadMore(rowWindow(0, VIEWPORT, 50), 50, true)).toBe(false) // the first page covers the first screen
    expect(shouldLoadMore(rowWindow(400, VIEWPORT, 50), 50, true)).toBe(true) // a few rows down, ahead of the end
    expect(shouldLoadMore(rowWindow(400, VIEWPORT, 50), 50, false)).toBe(false) // the end of history
  })
})

describe("what the Chronicle refuses (criterion 8; D-013, §2.3)", () => {
  const SOURCES = [
    "components/chronicle/chronicle-panel.tsx",
    "components/chronicle/chronicle-rows.tsx",
    "app/(home)/chronicle/page.tsx",
    ...readdirSync(join(ROOT, "lib/chronicle"))
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
      .map((f) => `lib/chronicle/${f}`),
  ]

  it("renders no calendar, week grid, filter, search, sort or period total", () => {
    for (const html of [FULL, windowAt(50_000)]) {
      expect(html).not.toMatch(/<input|<select|<table|role="(grid|search|searchbox|combobox|listbox)"|type="search"/)
      expect(text(html)).not.toMatch(/\b(calendar|this week|this month|per week|per month|weekly|monthly|streak|filter|search|sort by|total)\b/i)
    }
  })

  it("has no such component in its tree, by name", () => {
    for (const file of SOURCES) {
      const src = readFileSync(join(ROOT, file), "utf8")
      expect(src, file).not.toMatch(/import[^\n]*(Calendar|Heatmap|WeekGrid|Filter|Search|Sort|Badge|Dot|Modal|Dialog)\b/)
      expect(src, file).not.toMatch(/\b(groupBy|byWeek|byMonth|weekOf|monthOf|isoWeek|getDay\(\)|periodTotal)\b/)
      expect(src, file).not.toMatch(/<(input|select|table)\b/)
    }
  })

  it("is a panel, not a dialog: no scrim, no modal (D-313)", () => {
    expect(FULL).not.toMatch(/role="dialog"|aria-modal|data-scrim/)
    expect(CHRONICLE_CSS).not.toMatch(/scrim/)
  })
})

describe("its place on the screen (criteria 1, 9)", () => {
  it("replaces the plinth in the rail, and the map stays mounted beside it", () => {
    const html = renderToStaticMarkup(
      <HomeScreen home={null}>
        <ChroniclePanel initial={{ items: FIXTURE.slice(0, 5), next: null }} />
      </HomeScreen>,
    )
    expect(html).toContain("data-chronicle")
    expect(html).not.toContain("data-plinth")
    // The map is the (home) layout's, under both routes: dismissing re-creates nothing, so the camera cannot move.
    expect(html).toContain('data-testid="map-shell"')
  })

  it("takes the rail's column at ≥1024px — 24rem, full height — and the bottom card's place below", () => {
    expect(CHRONICLE_CSS).toMatch(/@media \(min-width: 1024px\) \{ \.chronicle \{ top: 0; bottom: 0; left: 0; right: auto; width: 24rem;/)
    expect(CHRONICLE_CSS).toMatch(/\.chronicle \{ position: fixed;[^}]*bottom: 36px;/) // D-315: clear of the attribution
  })

  it("has a visible close control and a heading", () => {
    expect(FULL).toMatch(/<button[^>]*aria-label="Close the Chronicle"/)
    expect(FULL).toMatch(/<h2 id="chronicle-title"/)
  })

  it("says nothing more than that when there is nothing to list", () => {
    expect(text(panel({ items: [], next: null })).replace(/\s+/g, " ")).toMatch(/CHRONICLE × Nothing here yet\./)
  })
})
