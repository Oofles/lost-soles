import type { WebRunInput } from "@/lib/trace-web/web"
import { metresBetween } from "@/src/domain/geo"

/**
 * THE REGIONS THE OPERATOR HAS RUN IN. Ticket `0285`.
 *
 * Derived from the operator's own runs, never from a list of states: a run somewhere new is a new
 * region with no code change (criterion 1). Pure, so the jump-to control and a test build the same
 * list.
 *
 * ─── THE RULE: DISTANCE CLUSTERS OF RUN STARTS ──────────────────────────────
 *
 * Two runs are in one region when their starts are within `REGION_LINK_KM` of each other, and the
 * relation is transitive (single linkage), so a metro area of scattered starts is one region however
 * wide it sprawls. The operator chose clusters over states because one state can hold two areas far
 * apart, as Arkansas does today: its two areas are ~200 km apart and come out as two regions, while
 * the nearest starts in one metro are a few km apart. 50 km sits in the wide gap between the two;
 * on the real data, every threshold from 25 km to 100 km gives the same five regions.
 *
 * The cost is quadratic in runs, and it runs once per explored generation: ~115 runs today is ~6,500
 * distance calls, a millisecond or so. At a few thousand runs it is still well under a frame's work.
 *
 * ─── A REGION'S GROUND ──────────────────────────────────────────────────────
 *
 * `bounds` is the box of every traced point of every run in the region — the lines the region's
 * explored cells were revealed from, so the box is the cells' box to within one cell. Framing it is
 * framing the territory (criterion 3). The antimeridian is not handled: no run crosses it.
 */

/** Starts closer than this are one region. See above for why 50. */
export const REGION_LINK_KM = 50

/** `[[west, south], [east, north]]` — the shape MapLibre's `fitBounds` takes. */
export type LngLatBounds = [[number, number], [number, number]]

export interface Region {
  /** The smallest activity id in the region: stable while the region keeps its runs. */
  id: string
  bounds: LngLatBounds
  /** The region's most recent run's `startedAt`. The list is ordered on it, newest first. */
  latestAt: string
}

interface Placed {
  run: WebRunInput
  start: { lng: number; lat: number }
}

/** The regions, most recently run first (the operator's choice of order). */
export function regionsOf(runs: readonly WebRunInput[], linkKm: number = REGION_LINK_KM): Region[] {
  const placed: Placed[] = []
  for (const run of runs) {
    const first = run.lines.find((line) => line.length > 0)?.[0]
    if (first) placed.push({ run, start: { lng: first[0], lat: first[1] } })
  }

  // Union-find over the starts.
  const parent = placed.map((_, i) => i)
  const root = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!
      i = parent[i]!
    }
    return i
  }
  const linkM = linkKm * 1000
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      if (metresBetween(placed[i]!.start, placed[j]!.start) <= linkM) parent[root(i)] = root(j)
    }
  }

  const groups = new Map<number, Placed[]>()
  placed.forEach((p, i) => {
    const r = root(i)
    const group = groups.get(r)
    if (group) group.push(p)
    else groups.set(r, [p])
  })

  const regions: Region[] = []
  for (const group of groups.values()) {
    let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity
    let id = group[0]!.run.activityId
    let latestAt = group[0]!.run.startedAt
    for (const { run } of group) {
      if (run.activityId < id) id = run.activityId
      if (run.startedAt > latestAt) latestAt = run.startedAt
      for (const line of run.lines) {
        for (const [lng, lat] of line) {
          if (lng < w) w = lng
          if (lng > e) e = lng
          if (lat < s) s = lat
          if (lat > n) n = lat
        }
      }
    }
    regions.push({ id, bounds: [[w, s], [e, n]], latestAt })
  }

  // Newest first; ties (never in practice) on id, so the order never depends on input order.
  return regions.sort((a, b) => (a.latestAt === b.latestAt ? (a.id < b.id ? -1 : 1) : a.latestAt < b.latestAt ? 1 : -1))
}

/**
 * THE PLAIN FALLBACK LABEL, when the basemap names nothing in a region (D-302): the centre of its
 * ground to a tenth of a degree, `34.8°N 92.3°W` — about 10 km, which names an area, not a door.
 */
export function coordinateLabel(bounds: LngLatBounds): string {
  const lng = (bounds[0][0] + bounds[1][0]) / 2
  const lat = (bounds[0][1] + bounds[1][1]) / 2
  const ns = `${Math.abs(lat).toFixed(1)}°${lat < 0 ? "S" : "N"}`
  const ew = `${Math.abs(lng).toFixed(1)}°${lng < 0 ? "W" : "E"}`
  return `${ns} ${ew}`
}
