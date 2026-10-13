import type { RouteTraceGeometry } from "@/lib/runs/wire"

/**
 * THE LANTERN'S PATH, AND THE INK THAT FOLLOWS IT. Ticket `0080`. `06-ui-ux.md` §3.2 beat 1.
 *
 * ─── THE FULL STREAM, NEVER `summary_polyline` (D-121 mitigation 4) ──────────
 *
 * The geometry is the stored route (`0195`): the sanitiser's own segments from the full `latlng`
 * stream, rounded to 6 dp and nothing else. Every vertex is used — `pointCount` is there so a test
 * can hold this to the trace's own count — and nothing on this path reads a polyline. A corner-cut
 * route drawn in a celebratory animation *"is exactly how trust dies"*.
 *
 * ─── ARC LENGTH, AND A GAP COSTS NOTHING ─────────────────────────────────────
 *
 * `at(arc)` takes the same `0..1` arc `lib/fog/reveal.ts` gives each reveal cell — metres run, over
 * the route's total, in the same planar frame (longitude scaled by the first point's cosine) — so
 * the lantern stands exactly where the mask is clearing. The gap between two segments adds no
 * length: there was no running there (`0045`, D-198), and the lantern crosses it in no time.
 *
 * ─── THE INK IS A `line-gradient`, NOT A GEOMETRY REBUILT PER FRAME ─────────
 *
 * Re-uploading a truncated line every frame is a worker round-trip per frame. Instead the whole
 * route is drawn once as ONE `LineString` and a `line-gradient` over `line-progress` is moved. Two
 * facts about MapLibre 6 shape that:
 *
 *   - `line-progress` restarts at 0 on every part of a `MultiLineString` (geojson-vt splits them
 *     under `lineMetrics`), so the parts are joined into one line — and the joins, where nobody
 *     ran, are inked transparent.
 *   - `line-progress` is measured along the line INCLUDING those joins, so it is not the lantern's
 *     arc. `inkProgress` maps one to the other through the vertices.
 *
 * The gradient texture is 256 texels along the line, so the ink's head moves in steps of 1/256 of
 * the route — about 8.6 ms of traversal each, under a frame.
 */

/** A route the lantern can walk. `null` from `lanternPath` when there is nothing to walk. */
export interface LanternPath {
  /** Every vertex the geometry holds — criterion 3 compares it to the trace's own count. */
  pointCount: number
  /** Metres run, gaps excluded. */
  lengthM: number
  /** `[lng, lat]` at an arc position, `0..1`. */
  at(arc: number): [number, number]
  /** The `line-progress` of the joined ink line at an arc position. */
  inkProgress(arc: number): number
  /** `[from, to]` `line-progress` ranges where somebody actually ran, in order. */
  inkRuns: readonly (readonly [number, number])[]
  /** The joined line — the ink's source data. */
  ink: { type: "Feature"; geometry: { type: "LineString"; coordinates: [number, number][] }; properties: Record<string, never> }
}

export function lanternPath(geometry: RouteTraceGeometry | null | undefined): LanternPath | null {
  if (!geometry || geometry.type !== "MultiLineString") return null
  const parts = geometry.coordinates
    .map((part) => part.filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1])) as [number, number][])
    .filter((part) => part.length >= 2)
  if (parts.length === 0) return null

  const lat0 = parts[0]![0]![1]
  const kx = 111_320 * Math.cos((lat0 * Math.PI) / 180)
  const ky = 110_540

  const lngs: number[] = []
  const lats: number[] = []
  /** Metres RUN to each vertex — the lantern's measure. Flat across a gap. */
  const run: number[] = []
  /** Metres ALONG THE JOINED LINE to each vertex — the ink's measure. Includes the gaps. */
  const drawn: number[] = []
  const partBounds: [number, number][] = []
  let ran = 0
  let along = 0

  for (const part of parts) {
    const first = lngs.length
    for (let i = 0; i < part.length; i++) {
      const [lng, lat] = part[i]!
      if (lngs.length > 0) {
        const step = Math.hypot((lng - lngs[lngs.length - 1]!) * kx, (lat - lats[lats.length - 1]!) * ky)
        along += step
        if (i > 0) ran += step
      }
      lngs.push(lng)
      lats.push(lat)
      run.push(ran)
      drawn.push(along)
    }
    partBounds.push([first, lngs.length - 1])
  }

  const pointCount = lngs.length
  const lengthM = ran
  const drawnM = along

  /** The vertex segment holding `metres` run: the last index whose run is <= it. Binary search. */
  const segment = (metres: number): number => {
    let lo = 0
    let hi = pointCount - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >>> 1
      if (run[mid]! <= metres) lo = mid
      else hi = mid - 1
    }
    return lo
  }

  const locate = (arc: number): { i: number; f: number } => {
    const metres = clamp01(arc) * lengthM
    let i = segment(metres)
    // Past the last vertex, or on a zero-length step: stand on the vertex itself.
    if (i >= pointCount - 1) return { i: pointCount - 1, f: 0 }
    // A gap (or a repeated point) is a step of zero run; walk to the far side of it.
    while (i < pointCount - 1 && run[i + 1]! === run[i]! && metres >= run[i + 1]!) i++
    if (i >= pointCount - 1) return { i: pointCount - 1, f: 0 }
    const span = run[i + 1]! - run[i]!
    return { i, f: span > 0 ? (metres - run[i]!) / span : 0 }
  }

  const at = (arc: number): [number, number] => {
    if (lengthM === 0) return [lngs[0]!, lats[0]!]
    const { i, f } = locate(arc)
    if (f === 0) return [lngs[i]!, lats[i]!]
    return [lngs[i]! + (lngs[i + 1]! - lngs[i]!) * f, lats[i]! + (lats[i + 1]! - lats[i]!) * f]
  }

  const inkProgress = (arc: number): number => {
    if (drawnM === 0) return arc >= 1 ? 1 : 0
    if (lengthM === 0) return 0
    const { i, f } = locate(arc)
    if (f === 0) return drawn[i]! / drawnM
    return (drawn[i]! + (drawn[i + 1]! - drawn[i]!) * f) / drawnM
  }

  const inkRuns = partBounds.map(
    ([a, b]) => [drawnM > 0 ? drawn[a]! / drawnM : 0, drawnM > 0 ? drawn[b]! / drawnM : 1] as const,
  )

  const coordinates: [number, number][] = lngs.map((lng, i) => [lng, lats[i]!])
  return {
    pointCount,
    lengthM,
    at,
    inkProgress,
    inkRuns,
    ink: { type: "Feature", geometry: { type: "LineString", coordinates }, properties: {} },
  }
}

/**
 * The step at an ink edge, in `line-progress`. Small against the gradient's 1/256 texel, so an edge
 * is as sharp as MapLibre will draw it; large enough that stops stay strictly ascending in float.
 */
const EDGE = 1e-5

/**
 * THE INK'S `line-gradient`, with the head at the lantern. `color` where somebody ran and the
 * lantern has passed; `clear` everywhere else — ahead of the lantern, and across every join.
 *
 * `clear` should be `color` at zero alpha rather than plain `transparent`, so the one-texel edge
 * fades the ink's own hue out instead of greying through black.
 */
export function inkGradient(path: LanternPath, arc: number, color: string, clear: string): unknown[] {
  const head = arc >= 1 ? 1 : path.inkProgress(arc)
  const stops: [number, string][] = []
  const push = (at: number, c: string) => {
    const x = clamp01(at)
    const last = stops[stops.length - 1]
    if (last && x <= last[0]) {
      // Equal positions: the later stop wins. The ranges are ascending, so nothing else collides.
      if (x === last[0]) last[1] = c
      return
    }
    stops.push([x, c])
  }

  for (const [from, to] of path.inkRuns) {
    const end = Math.min(to, head)
    if (end <= from) continue
    if (from > 0) push(from - EDGE, clear)
    push(from, color)
    push(end, color)
    if (end < 1) push(end + EDGE, clear)
  }
  if (stops.length === 0) return ["interpolate", ["linear"], ["line-progress"], 0, clear, 1, clear]
  if (stops[0]![0] > 0) stops.unshift([0, clear])
  if (stops[stops.length - 1]![0] < 1) stops.push([1, clear])
  return ["interpolate", ["linear"], ["line-progress"], ...stops.flat()]
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x
}
