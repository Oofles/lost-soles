import { runDate, runDistance } from "@/lib/runs/format"
import type { RunFacts, RunFeatureCollection } from "@/lib/runs/wire"
import type { WebRunInput } from "@/lib/trace-web/web"

/**
 * INSPECTING A PAST RUN FROM THE MAP. Ticket `0101`, `06-ui-ux.md` §4.5, D-253, D-313.
 *
 * Click within 24 px of a route line. One run there: highlight it at once and show a one-line chip
 * (date · distance · new cells) that clicks through to `/run/:id`. Several: a card anchored above
 * the click, flipping below near the top edge, 32 px rows (D-313), five then it scrolls, never a
 * panel. Hover changes only the cursor (D-313). **A click on empty map does nothing** (§4.4) — no
 * navigation, no sheet, no state change: `inspect` returns the very state it was given.
 *
 * Pure, so every rule is tested with a fake projection and no WebGL (`route-inspect.test.ts`).
 *
 * ─── WHAT IS HIT-TESTED ─────────────────────────────────────────────────────
 *
 * The permanent web's INPUTS (`/api/runs/web`, one entry per run with its own lines), not the
 * drawn web: the drawn web draws each stretch of ground once (D-299), so a feature there belongs
 * to no single run and could never say which runs pass a point. The latest run, from
 * `/api/runs/latest`, is added when the web does not carry it yet (a run still syncing).
 */

/** §4.4: the hit slop, in CSS pixels. */
export const HIT_SLOP_PX = 24
/** D-313: an ordinary row is 32 px. */
export const CARD_ROW_PX = 32
/** §4.5: five rows, then the card scrolls. */
export const CARD_MAX_ROWS = 5
/** The card's "N runs pass here" line. */
export const CARD_HEADER_PX = 32
/** Padding (4 + 4) and the 1 px rule each side. */
export const CARD_CHROME_PX = 10
export const CARD_WIDTH_PX = 288
/** The chip: one 32 px line. */
export const CHIP_HEIGHT_PX = 32
/** The gap between the click point and the card's near edge. */
export const ANCHOR_GAP_PX = 12
/** How far the card keeps off the pane's sides. */
export const EDGE_MARGIN_PX = 8

export interface Point {
  x: number
  y: number
}

type LngLat = [number, number]

/** One run, ready to hit-test: its lines and their box, computed once per fetch, never per click. */
export interface IndexedRun {
  activityId: string
  startedAt: string
  lines: LngLat[][]
  /** [west, south, east, north]. */
  box: [number, number, number, number]
}

function boxOf(lines: readonly (readonly LngLat[])[]): [number, number, number, number] {
  let w = Infinity
  let s = Infinity
  let e = -Infinity
  let n = -Infinity
  for (const line of lines) {
    for (const [x, y] of line) {
      if (x < w) w = x
      if (x > e) e = x
      if (y < s) s = y
      if (y > n) n = y
    }
  }
  return [w, s, e, n]
}

/**
 * The runs a click can hit: the web's runs, plus the latest run when the web does not have it.
 * Runs with no points are dropped.
 */
export function indexRuns(web: readonly WebRunInput[], latest?: RunFeatureCollection): IndexedRun[] {
  const out: IndexedRun[] = []
  const seen = new Set<string>()
  for (const run of web) {
    const lines = run.lines as LngLat[][]
    if (!lines.some((l) => l.length > 0)) continue
    seen.add(run.activityId)
    out.push({ activityId: run.activityId, startedAt: run.startedAt, lines, box: boxOf(lines) })
  }
  const feature = latest?.features[0]
  if (feature && !seen.has(feature.properties.activityId)) {
    const g = feature.geometry as { type: string; coordinates: unknown }
    const lines =
      g.type === "LineString" ? [g.coordinates as LngLat[]] : g.type === "MultiLineString" ? (g.coordinates as LngLat[][]) : []
    if (lines.some((l) => l.length > 0)) {
      out.push({ activityId: feature.properties.activityId, startedAt: feature.properties.startedAt, lines, box: boxOf(lines) })
    }
  }
  return out
}

/** Squared distance from `p` to the segment a–b, all in pixels. */
function segmentDistance2(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
  const x = a.x + t * dx - p.x
  const y = a.y + t * dy - p.y
  return x * x + y * y
}

/** The projection the hit test needs. MapLibre's `project` / `unproject`, with bearing locked to 0. */
export interface Projection {
  project(lngLat: LngLat): Point
  unproject(point: Point): LngLat
}

/**
 * The runs with a line within `slop` pixels of `point`, newest first — the card's order.
 *
 * Cheap at real sizes: the click's own box (in degrees, axis-aligned because bearing is locked
 * north-up) rejects whole runs and then whole segments before anything is projected, so a click
 * projects only the few segments actually near it.
 */
export function runsNear(runs: readonly IndexedRun[], point: Point, proj: Projection, slop = HIT_SLOP_PX): IndexedRun[] {
  const [lngA, latA] = proj.unproject({ x: point.x - slop, y: point.y - slop })
  const [lngB, latB] = proj.unproject({ x: point.x + slop, y: point.y + slop })
  const w = Math.min(lngA, lngB)
  const e = Math.max(lngA, lngB)
  const s = Math.min(latA, latB)
  const n = Math.max(latA, latB)
  const slop2 = slop * slop
  const hits: IndexedRun[] = []
  for (const run of runs) {
    const [bw, bs, be, bn] = run.box
    if (be < w || bw > e || bn < s || bs > n) continue
    let hit = false
    for (const line of run.lines) {
      for (let i = 0; i < line.length && !hit; i++) {
        const a = line[i]!
        const b = line[i + 1] ?? a
        if (Math.max(a[0], b[0]) < w || Math.min(a[0], b[0]) > e || Math.max(a[1], b[1]) < s || Math.min(a[1], b[1]) > n) {
          continue
        }
        if (segmentDistance2(point, proj.project(a), proj.project(b)) <= slop2) hit = true
      }
      if (hit) break
    }
    if (hit) hits.push(run)
  }
  return hits.sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0))
}

/** What the inspection shows. `idle` is the map with nothing open. */
export type Inspection =
  | { kind: "idle" }
  | { kind: "chip"; run: IndexedRun; at: Point }
  | { kind: "card"; runs: IndexedRun[]; at: Point }

export const IDLE: Inspection = { kind: "idle" }

export type InspectEvent = { type: "click"; hits: IndexedRun[]; at: Point } | { type: "dismiss" }

/**
 * The one transition function. A click on empty map with nothing open returns THE SAME OBJECT —
 * that identity is the "no state change" §4.4 promises, and what the test asserts. A click on empty
 * map with something open dismisses it (§4.5: *"a click elsewhere on the map"*); so do `Esc` and back.
 */
export function inspect(state: Inspection, event: InspectEvent): Inspection {
  if (event.type === "dismiss") return state.kind === "idle" ? state : IDLE
  const { hits, at } = event
  if (hits.length === 0) return state.kind === "idle" ? state : IDLE
  if (hits.length === 1) return { kind: "chip", run: hits[0]!, at }
  return { kind: "card", runs: hits, at }
}

/** The run to draw as the selected run while this is open: the chip's. `null`: the latest, as on `/`. */
export function selectedRun(state: Inspection): IndexedRun | null {
  return state.kind === "chip" ? state.run : null
}

/** A selected run as the route source's data. */
export function selectedCollection(run: IndexedRun): RunFeatureCollection {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "MultiLineString", coordinates: run.lines } as RunFeatureCollection["features"][number]["geometry"],
        properties: { activityId: run.activityId, startedAt: run.startedAt, name: null },
      },
    ],
  }
}

/** The card's height for `n` rows: the header, up to five rows, the chrome. */
export function cardHeight(n: number): number {
  return CARD_HEADER_PX + Math.min(n, CARD_MAX_ROWS) * CARD_ROW_PX + CARD_CHROME_PX
}

export interface Placement {
  left: number
  top: number
  side: "above" | "below"
}

/**
 * Where a box of `height` × `width` goes for a click at `at` in a pane of `pane`: centred on the
 * click, ABOVE it — unless the click is within the box's own height (plus the gap) of the top
 * edge, when it flips BELOW. Kept off the sides by `EDGE_MARGIN_PX`.
 */
export function placeBox(at: Point, height: number, width: number, pane: { width: number; height: number }): Placement {
  const side = at.y - ANCHOR_GAP_PX - height < 0 ? "below" : "above"
  const top = side === "above" ? at.y - ANCHOR_GAP_PX - height : at.y + ANCHOR_GAP_PX
  const maxLeft = Math.max(EDGE_MARGIN_PX, pane.width - width - EDGE_MARGIN_PX)
  const left = Math.min(maxLeft, Math.max(EDGE_MARGIN_PX, at.x - width / 2))
  return { left, top, side }
}

const fmt = new Intl.NumberFormat("en-GB")

/**
 * One row's words: `Thu 28 Aug · 8.40 km · 21 new`, §4.5's three facts. The year joins the date
 * only when it is not this year, so a card spanning years still reads in order. Before the facts
 * arrive, the date alone, from the web's `startedAt`.
 */
export function runLine(run: Pick<IndexedRun, "startedAt">, facts: RunFacts | undefined, thisYear: number): string {
  const when = facts?.startedAtLocal ?? run.startedAt
  const year = Number(when.slice(0, 4))
  const parts = [runDate(when, { year: year !== thisYear })]
  if (!facts) return parts[0]!
  const distance = runDistance(facts.distanceM)
  if (distance) parts.push(distance)
  parts.push(`${fmt.format(facts.newCellCount)} new`)
  return parts.join(" · ")
}

/** The card's heading. */
export function cardHeading(n: number): string {
  return `${n} runs pass here`
}
