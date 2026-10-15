import { readFileSync } from "node:fs"
import { join } from "node:path"

import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import type { PlinthModel } from "@/lib/plinth/model"

/**
 * TICKET 0086 — THE HOME ROUTE'S STANDING REFUSALS (D-013, `06` §2.3), AS ASSERTIONS.
 *
 * Every item below has been proposed by somebody, in some fitness app, for a good-sounding reason.
 * This file is where the answer is kept. Changing it needs a decision record, not a commit.
 *
 * The plinth is rendered with a FULLY POPULATED model — every row filled — because a refusal tested
 * against an empty screen proves nothing. `HomeScreen` is rendered too, with the map stubbed, to
 * show that the plinth, the gear and the map are the whole of `/`.
 */
vi.mock("@/app/sync-action", () => ({ syncNowAction: vi.fn() }))
vi.mock("@/components/map/map-shell", () => ({ MapShell: () => <div data-testid="map-shell" /> }))

const { Plinth, PLINTH_CSS } = await import("./plinth")
const { HomeScreen } = await import("./home-screen")

const FULL: PlinthModel = {
  totalLevel: 271,
  rung: { from: 250, to: 300, fraction: 0.42 },
  target: "next: 300",
  cells: "12,480",
  lastRun: { href: "/run/a-9", text: "Last: Thu 27 Aug · 8.40 km · 21 new" },
}

const plinth = () => renderToStaticMarkup(<Plinth model={FULL} />)
const home = () => renderToStaticMarkup(<HomeScreen home={null} />)

/** Visible text only: tags and the stylesheet stripped. */
const text = (html: string) => html.replace(/<style>[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ")
const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1])

describe("the plinth's content (0086)", () => {
  it("shows both glance numbers and the named milestone target", () => {
    const t = text(plinth())
    expect(t).toContain("TOTAL LEVEL")
    expect(t).toContain("271")
    expect(t).toContain("12,480")
    expect(t).toContain("next: 300")
    expect(t).not.toContain("%")
  })

  it("makes the whole last-run line one link to /run/:activityId", () => {
    const html = plinth()
    expect(html).toMatch(/<a [^>]*href="\/run\/a-9"[^>]*>[\s\S]*Last: Thu 27 Aug · 8\.40 km · 21 new[\s\S]*?<\/a>/)
  })

  it("has exactly the three destinations, Add workout between the other two, RUNS → /chronicle", () => {
    const html = plinth()
    const nav = html.slice(html.indexOf('aria-label="Destinations"'), html.indexOf("</nav>"))
    expect(hrefs(nav)).toEqual(["/skills", "/log", "/chronicle"])
  })

  it("lays the destinations out 1fr 1.5fr 1fr at 40px, so Add workout is centred and widest (D-061, D-313)", () => {
    expect(PLINTH_CSS).toContain("grid-template-columns: 1fr 1.5fr 1fr")
    expect(PLINTH_CSS).toMatch(/\.plinth-dest \{[^}]*height: 40px/)
  })

  it("is a 24rem rail at ≥1024px with the map pane beside it, and a bottom card below", () => {
    const desktop = PLINTH_CSS.slice(PLINTH_CSS.indexOf("@media (min-width: 1024px)"))
    expect(desktop).toMatch(/\.home-pane \{ left: 24rem; \}/)
    expect(desktop).toMatch(/\.plinth \{[^}]*width: 24rem/)
    expect(desktop).toMatch(/\.plinth \{[^}]*border-right: 1px solid var\(--line\)/)
    expect(PLINTH_CSS.slice(0, PLINTH_CSS.indexOf("@media"))).toMatch(/\.plinth \{[^}]*max-height: 55vh/)
  })

  it("carries the interim Sync as a caption text line, not a fourth destination (D-313)", () => {
    const html = plinth()
    expect(html.indexOf("Sync now")).toBeGreaterThan(html.indexOf("</nav>"))
  })
})

describe("what the home route must never render (D-013, §2.3)", () => {
  const FORBIDDEN = /streak|today|this week|days since|\bgoal|check[- ]?in|welcome back|log a run|\bago\b/i

  it("no element's content matches streak / today / this week / days since / goal / check-in", () => {
    expect(text(plinth())).not.toMatch(FORBIDDEN)
    expect(text(home())).not.toMatch(FORBIDDEN)
  })

  it("no badge, dot, toast or modal component", () => {
    for (const html of [plinth(), home()]) {
      expect(html).not.toMatch(/badge|\bdot\b|toast|role="dialog"|role="alertdialog"|<dialog/i)
    }
    for (const file of ["components/plinth/plinth.tsx", "components/plinth/home-screen.tsx", "app/page.tsx"]) {
      const src = readFileSync(join(import.meta.dirname, "..", "..", file), "utf8")
      expect(src).not.toMatch(/import[^\n]*(Badge|Dot|Toast|Modal|Dialog)\b/)
      // Criterion 9: nothing on `/` runs on a clock. (The replay gate's single timer lives in
      // `lib/plinth/load.ts` and fires only while a replay is in progress.)
      expect(src).not.toMatch(/setInterval/)
    }
  })

  it("no 'log a run' and no per-exercise control: the only links are the plinth's and the gear", () => {
    const links = hrefs(home())
    expect(new Set(links)).toEqual(new Set(["/skills", "/log", "/chronicle", "/settings"]))
    expect(links.every((h) => !/\/log[?#/]/.test(h))).toBe(true)
  })

  it("renders only the plinth, the gear and the map — no other UI", () => {
    // React's static render appends its form-replay `<script>` for the Sync form; it draws nothing.
    const html = home().replace(/<style>[\s\S]*?<\/style>/, "").replace(/<script>[\s\S]*?<\/script>/g, "")
    const top = html.replace(/<aside[\s\S]*<\/aside>/, "").replace(/<a [^>]*class="home-gear"[\s\S]*?<\/a>/, "")
    expect(top).toBe('<div data-testid="map-shell"></div>')
  })
})

describe("chrome is opaque and gold is never text (D-148)", () => {
  it("every floating surface has an opaque token background", () => {
    expect(PLINTH_CSS).toMatch(/\.plinth \{[^}]*background: var\(--surface-raised\)/)
    expect(PLINTH_CSS).toMatch(/\.home-gear \{[^}]*background: var\(--surface-raised\)/)
    expect(PLINTH_CSS).not.toMatch(/opacity|rgba|transparent|backdrop/)
  })

  it("gold appears only as a fill or a rule", () => {
    const src = readFileSync(join(import.meta.dirname, "plinth.tsx"), "utf8") + readFileSync(join(import.meta.dirname, "..", "add-workout-link.tsx"), "utf8")
    expect(src).not.toContain("--accent-text")
    expect(src).not.toMatch(/(?<![-\w])color: ?"?var\(--(accent|gold|progress)/)
    // Where gold IS used: Add workout's border and the bar's fill.
    expect(PLINTH_CSS).toContain(".plinth-dest-primary { border-color: var(--accent); }")
    expect(plinth()).toContain("background:var(--progress-activity)")
  })
})
