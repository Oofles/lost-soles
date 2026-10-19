import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

import {
  ANCHOR_GAP_PX,
  cardHeight,
  CARD_ROW_PX,
  CARD_WIDTH_PX,
  HIT_SLOP_PX,
  IDLE,
  indexRuns,
  inspect,
  placeBox,
  runLine,
  runsNear,
  selectedCollection,
  selectedRun,
  type Projection,
} from "./route-inspect"
import type { RunFeatureCollection } from "./runs/wire"
import type { WebRunInput } from "./trace-web/web"

/**
 * Ticket `0101`. `06-ui-ux.md` §4.5 — inspecting a past run — and §4.4's "click on empty map does
 * nothing". A flat fake projection, 1 px per 0.0001°, stands in for MapLibre's (bearing is locked
 * to 0, so screen axes are lng/lat axes). Point Nemo (D-199).
 */

const O = [-123.393, -48.876] as const
const PX = 0.0001
/** Screen y grows downward, latitude upward. */
const proj: Projection = {
  project: ([lng, lat]) => ({ x: (lng - O[0]) / PX, y: (O[1] - lat) / PX }),
  unproject: ({ x, y }) => [O[0] + x * PX, O[1] - y * PX],
}
/** A horizontal line at screen y = `y`, from x = 0 to 1000. */
const horizontal = (y: number): [number, number][] => [proj.unproject({ x: 0, y }), proj.unproject({ x: 1000, y })]

const run = (id: string, startedAt: string, y: number): WebRunInput => ({ activityId: id, startedAt, lines: [horizontal(y)] })

const RUNS = indexRuns([
  run("old", "2026-06-03T07:00:00.000Z", 500),
  run("new", "2026-08-28T07:00:00.000Z", 510),
  run("mid", "2026-08-10T07:00:00.000Z", 490),
  run("far", "2026-08-30T07:00:00.000Z", 700),
])

describe("the hit test: 24 px of slop", () => {
  it("finds exactly the one line within 24 px", () => {
    const hits = runsNear(RUNS, { x: 300, y: 700 + HIT_SLOP_PX }, proj)
    expect(hits.map((r) => r.activityId)).toEqual(["far"])
    expect(runsNear(RUNS, { x: 300, y: 700 + HIT_SLOP_PX + 1 }, proj)).toEqual([])
  })

  it("finds three lines within 24 px, newest first", () => {
    expect(runsNear(RUNS, { x: 300, y: 500 }, proj).map((r) => r.activityId)).toEqual(["new", "mid", "old"])
  })

  it("measures to the segment, not only its ends", () => {
    expect(runsNear(RUNS, { x: 1000 + HIT_SLOP_PX + 1, y: 700 }, proj)).toEqual([])
    expect(runsNear(RUNS, { x: 1000 + HIT_SLOP_PX - 1, y: 700 }, proj).map((r) => r.activityId)).toEqual(["far"])
  })

  it("can hit the latest run before the web carries it, and does not count it twice", () => {
    const latest: RunFeatureCollection = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "MultiLineString", coordinates: [horizontal(100)] } as RunFeatureCollection["features"][number]["geometry"],
          properties: { activityId: "syncing", startedAt: "2026-09-01T07:00:00.000Z", name: null },
        },
      ],
    }
    const index = indexRuns([run("far", "2026-08-30T07:00:00.000Z", 700)], latest)
    expect(runsNear(index, { x: 10, y: 100 }, proj).map((r) => r.activityId)).toEqual(["syncing"])
    expect(indexRuns([run("syncing", "2026-09-01T07:00:00.000Z", 100)], latest)).toHaveLength(1)
  })
})

describe("§4.4: a click on empty map does nothing", () => {
  it("is no state change: the very same state comes back", () => {
    const hits = runsNear(RUNS, { x: 300, y: 50 }, proj)
    expect(hits).toEqual([])
    const next = inspect(IDLE, { type: "click", hits, at: { x: 300, y: 50 } })
    expect(next).toBe(IDLE)
    expect(selectedRun(next)).toBeNull()
  })

  /** No navigation and no sheet: the only thing the map's click handler does is this dispatch. */
  it("the map's click handler navigates nowhere and opens nothing", () => {
    const src = readFileSync(new URL("../components/map/map-controls.tsx", import.meta.url), "utf8")
    const handler = src.slice(src.indexOf("const onClick = "), src.indexOf("let frame = 0"))
    expect(handler).toContain('dispatch({ type: "click", hits, at })')
    expect(handler).not.toMatch(/router|push\(|location|navigate|href|open|sheet/i)
  })

  it("with a chip or card open, an empty click dismisses it (§4.5), as Esc does", () => {
    const chip = inspect(IDLE, { type: "click", hits: [RUNS[0]!], at: { x: 1, y: 1 } })
    expect(inspect(chip, { type: "click", hits: [], at: { x: 2, y: 2 } })).toBe(IDLE)
    expect(inspect(chip, { type: "dismiss" })).toBe(IDLE)
    expect(inspect(IDLE, { type: "dismiss" })).toBe(IDLE)
  })
})

describe("§4.5: one match is a chip, several are a card", () => {
  it("one line: the chip, and that run is the selected run at once", () => {
    const hits = runsNear(RUNS, { x: 300, y: 700 }, proj)
    const state = inspect(IDLE, { type: "click", hits, at: { x: 300, y: 700 } })
    expect(state.kind).toBe("chip")
    expect(selectedRun(state)?.activityId).toBe("far")
    expect(selectedCollection(selectedRun(state)!).features[0]!.properties.activityId).toBe("far")
  })

  it("three lines: the card, three rows date-descending, 32 px each (D-313)", () => {
    const hits = runsNear(RUNS, { x: 300, y: 500 }, proj)
    const state = inspect(IDLE, { type: "click", hits, at: { x: 300, y: 500 } })
    expect(state.kind).toBe("card")
    if (state.kind !== "card") return
    expect(state.runs.map((r) => r.startedAt)).toEqual([
      "2026-08-28T07:00:00.000Z",
      "2026-08-10T07:00:00.000Z",
      "2026-06-03T07:00:00.000Z",
    ])
    expect(selectedRun(state)).toBeNull()
    expect(CARD_ROW_PX).toBe(32)
    const css = readFileSync(new URL("../components/map/map-controls.tsx", import.meta.url), "utf8")
    expect(css).toContain('" .route-card a { display: flex; align-items: center; height: " + CARD_ROW_PX + "px;')
  })

  it("five rows, then it scrolls: the card stops growing at five", () => {
    expect(cardHeight(3)).toBe(cardHeight(1) + 2 * CARD_ROW_PX)
    expect(cardHeight(5)).toBe(cardHeight(40))
  })

  it("rows read date · distance · new cells; the year only when it is not this year", () => {
    const facts = { activityId: "new", startedAt: "2026-08-28T11:00:00.000Z", startedAtLocal: "2026-08-28T07:00:00", distanceM: 8400, newCellCount: 21 }
    expect(runLine(RUNS[1]!, facts, 2026)).toBe("Fri 28 Aug · 8.40 km · 21 new")
    expect(runLine(RUNS[1]!, { ...facts, newCellCount: 0, distanceM: null }, 2026)).toBe("Fri 28 Aug · 0 new")
    expect(runLine(RUNS[1]!, facts, 2027)).toBe("Fri 28 Aug 2026 · 8.40 km · 21 new")
    expect(runLine(RUNS[1]!, undefined, 2026)).toBe("Fri 28 Aug")
  })
})

describe("§4.5: the card sits above the click, and flips below near the top edge", () => {
  const pane = { width: 1000, height: 800 }
  const h = cardHeight(3)

  it("is above the click when there is room", () => {
    const p = placeBox({ x: 500, y: 400 }, h, CARD_WIDTH_PX, pane)
    expect(p.side).toBe("above")
    expect(p.top + h).toBe(400 - ANCHOR_GAP_PX)
  })

  it("flips below when the click is within its own height of the top edge", () => {
    const edge = h + ANCHOR_GAP_PX
    expect(placeBox({ x: 500, y: edge }, h, CARD_WIDTH_PX, pane).side).toBe("above")
    const p = placeBox({ x: 500, y: edge - 1 }, h, CARD_WIDTH_PX, pane)
    expect(p.side).toBe("below")
    expect(p.top).toBe(edge - 1 + ANCHOR_GAP_PX)
  })

  it("keeps off the pane's sides", () => {
    expect(placeBox({ x: 2, y: 400 }, h, CARD_WIDTH_PX, pane).left).toBe(8)
    expect(placeBox({ x: 998, y: 400 }, h, CARD_WIDTH_PX, pane).left).toBe(1000 - CARD_WIDTH_PX - 8)
  })
})
