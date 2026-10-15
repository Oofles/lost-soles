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
  // `0087`: connect and the last run share one row, so a full model has the run; the reconnect
  // line is filled, so every refusal below is also tested against it.
  connect: null,
  reconnect: { href: "/settings", text: "Example needs reconnecting" },
  // `0270`: both groups filled, so every refusal below is tested against the quick-view too.
  quickView: {
    activity: [
      { skillId: "act-a", href: "/skills/act-a", name: "Alpha", kind: "activity", level: 42, fraction: 0.5, label: "Alpha, level 42, activity skill" },
      { skillId: "act-b", href: "/skills/act-b", name: "Beta", kind: "activity", level: 7, fraction: 0.25, label: "Beta, level 7, activity skill" },
    ],
    meta: [{ skillId: "meta-c", href: "/skills/meta-c", name: "Gamma", kind: "meta", level: 19, fraction: 0.75, label: "Gamma, level 19, meta skill" }],
  },
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

describe("the skills quick-view (0270)", () => {
  const quick = (html: string) => html.slice(html.indexOf("data-quick-view"), html.indexOf("</aside>"))

  it("sits inside the plinth, below the Sync and reconnect lines, so /chronicle replaces it with the rest", () => {
    const html = plinth()
    expect(html).toMatch(/<aside [^>]*data-plinth=""[\s\S]*data-quick-view[\s\S]*<\/aside>/)
    expect(html.indexOf("data-quick-view")).toBeGreaterThan(html.indexOf("Sync now"))
    expect(html.indexOf("data-quick-view")).toBeGreaterThan(html.indexOf("needs reconnecting"))
  })

  it("draws ACTIVITY then META, each row a link to its sheet carrying name, level and kind — no XP", () => {
    const html = quick(plinth())
    expect(html.indexOf(">ACTIVITY<")).toBeLessThan(html.indexOf(">META<"))
    expect(hrefs(html)).toEqual(["/skills/act-a", "/skills/act-b", "/skills/meta-c"])
    expect(html).toContain('aria-label="Alpha, level 42, activity skill"')
    expect(html).toContain('aria-label="Gamma, level 19, meta skill"')
    const t = text(html)
    for (const s of ["Alpha", "42", "Beta", "7", "Gamma", "19"]) expect(t).toContain(s)
    expect(t).not.toMatch(/\bxp\b|untrained|next|%/i)
  })

  it("bars use /skills' fills: activity gold, meta verdigris, as fills only", () => {
    const html = quick(plinth())
    expect(html.match(/background:var\(--progress-activity\)/g)).toHaveLength(2)
    expect(html.match(/background:var\(--progress-meta\)/g)).toHaveLength(1)
    expect(html).toContain("width:50%")
  })

  it("a group with no trained skill has no heading, and no trained skill at all draws nothing", () => {
    const onlyActivity = renderToStaticMarkup(<Plinth model={{ ...FULL, quickView: { activity: FULL.quickView!.activity, meta: [] } }} />)
    expect(onlyActivity).toContain(">ACTIVITY<")
    expect(onlyActivity).not.toContain(">META<")
    const none = renderToStaticMarkup(<Plinth model={{ ...FULL, quickView: { activity: [], meta: [] } }} />)
    expect(none).not.toContain("data-quick-view")
    expect(renderToStaticMarkup(<Plinth model={{ ...FULL, quickView: null }} />)).not.toContain("data-quick-view")
  })

  it("rows are 32px; below 1024px the list is omitted; at ≥1024px only the list scrolls", () => {
    const mobile = PLINTH_CSS.slice(0, PLINTH_CSS.indexOf("@media (min-width: 1024px)"))
    const desktop = PLINTH_CSS.slice(PLINTH_CSS.indexOf("@media (min-width: 1024px)"))
    expect(mobile).toMatch(/\.plinth-skill \{[^}]*min-height: 32px/)
    expect(mobile).toContain(".plinth-skills { display: none; }")
    expect(desktop).toMatch(/\.plinth \{[^}]*display: flex; flex-direction: column/)
    expect(desktop).toContain(".plinth > * { flex: none; }")
    expect(desktop).toMatch(/\.plinth > \.plinth-skills \{ display: block;[^}]*min-height: 0; overflow-y: auto; \}/)
  })

  it("names no skill: the rows are the model's, so a registry row is a quick-view row (D-031)", () => {
    const src = readFileSync(join(import.meta.dirname, "plinth.tsx"), "utf8")
    const ids = ["wayfaring", "vigil", "roving", "cadence", "might", "fortitude", "endurance", "cartography", "constitution"]
    for (const id of ids) expect(src.toLowerCase()).not.toContain(id)
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
    for (const file of ["components/plinth/plinth.tsx", "components/plinth/home-screen.tsx", "app/(home)/layout.tsx"]) {
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

describe("the home screen's states (0087)", () => {
  const base: PlinthModel = { ...FULL, reconnect: null }
  const render = (model: PlinthModel) => renderToStaticMarkup(<Plinth model={model} />)
  const freshCss = () => PLINTH_CSS.slice(PLINTH_CSS.indexOf(".plinth-fresh"), PLINTH_CSS.indexOf(".plinth-quiet"))

  it("the fresh line is a gold RULE and one pulse: class-gated, never gold text, never red", () => {
    const html = render({ ...base, lastRun: { href: "/run/a-9?play=1", text: "1 new run — open it", fresh: true, pulse: true } })
    const link = html.match(/<a [^>]*href="\/run\/a-9\?play=1"[^>]*>/)![0]
    expect(link).toContain('class="plinth-last plinth-fresh plinth-pulse"')
    expect(text(html)).toContain("1 new run — open it")
    const fresh = freshCss()
    // Once: one iteration, and none at all under reduced motion.
    expect(fresh).toMatch(/\.plinth-pulse \{ animation: plinth-pulse \d+ms ease-out 1; \}/)
    expect(fresh).not.toMatch(/infinite|alternate/)
    expect(fresh).toMatch(/prefers-reduced-motion: reduce\) \{ \.plinth-pulse \{ animation: none; \}/)
    // The only colour the fresh treatment uses is gold, and only as box-shadow (a rule and a ring).
    expect(fresh.match(/var\(--[\w-]+\)/g)!.every((v) => v === "var(--accent)")).toBe(true)
    expect(fresh).not.toMatch(/(?<![-\w])color:/)
  })

  it("never re-pulses: once pulsed the line keeps the rule and loses only the animation class", () => {
    const html = render({ ...base, lastRun: { href: "/run/a-9?play=1", text: "1 new run — open it", fresh: true, pulse: false } })
    expect(html).toContain("plinth-fresh")
    expect(html).not.toContain("plinth-pulse")
  })

  it("nothing imported: the connect invitation takes the last-run row, and is the plinth's only call to action", () => {
    const html = render({ ...base, lastRun: null, connect: { href: "/settings", text: "Connect Example to begin" } })
    expect(html).toMatch(/<a [^>]*href="\/settings"[^>]*>Connect Example to begin<\/a>/)
    expect(text(html)).not.toMatch(/step|checklist|get started|welcome|first run|\d+%/i)
  })

  it("the reconnect line is one quiet ink link to /settings — no red token, badge, dot or modal", () => {
    const html = render({ ...base, reconnect: { href: "/settings", text: "Example needs reconnecting" } })
    expect(html).toMatch(/<a [^>]*href="\/settings"[^>]*>Example needs reconnecting<\/a>/)
    expect(html.match(/needs reconnecting/g)).toHaveLength(1)
    const quiet = PLINTH_CSS.slice(PLINTH_CSS.indexOf(".plinth-quiet"), PLINTH_CSS.indexOf("@media (min-width"))
    expect(quiet).toContain("color: var(--text-secondary)")
    for (const css of [quiet, html]) {
      expect(css).not.toMatch(/oxblood|--danger|--error|\bred\b|#[0-9a-f]{3,6}\b/i)
      expect(css).not.toMatch(/badge|\bdot\b|toast|role="dialog"|role="alertdialog"|<dialog/i)
    }
  })

  it("three weeks idle is identical to yesterday, apart from the last-run line's own text (criterion 11)", async () => {
    const { plinthModel } = await import("@/lib/plinth/model")
    const at = (local: string) => ({
      type: "FeatureCollection" as const,
      features: [
        {
          type: "Feature" as const,
          geometry: { type: "MultiLineString", coordinates: [] } as never,
          properties: { activityId: "a-9", startedAt: `${local}Z`, name: null, startedAtLocal: local, distanceM: 8400, newCellCount: 21 },
        },
      ],
    })
    const skills = [{ skillId: "x", xp: 50_000 }]
    const yesterday = render(plinthModel({ skills, cells: 12480, latest: at("2026-10-14T07:00:00"), seen: true, sources: [] }))
    const idle = render(plinthModel({ skills, cells: 12480, latest: at("2026-09-24T07:00:00"), seen: true, sources: [] }))
    expect(yesterday).not.toBe(idle)
    expect(idle.replace("Last: Thu 24 Sep", "<LINE>")).toBe(yesterday.replace("Last: Wed 14 Oct", "<LINE>"))
  })
})
