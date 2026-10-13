import { cellToLatLng, cellToParent, getHexagonEdgeLengthAvg, gridDisk, latLngToCell, UNITS, type H3Index } from "h3-js"

import { SIX_MONTHS_MS } from "./discovery"
import { RES } from "./fog"
import { metresBetween, type Located } from "./geo"

/**
 * THE FRONTIER PRIMITIVE. `05-fog-of-war.md` §8.4. Built by `0083` (beat 5's line), owned jointly
 * with `0090` (the derived stats feed), and the input the deferred route planner (D-070) consumes —
 * **one implementation; do not fork it.**
 *
 * Two departures from §8.4's sketch, both forced by the code that exists:
 *
 *   - The disk is walked at the explored set's own resolution, `RES`, not at res 10. The explored
 *     set is a set of `RES` cells, and asking it about anything else would be a second definition of
 *     "explored". The centre-to-centre spacing is read from H3 rather than restated.
 *   - The novelty WEIGHTS are an argument, not constants. D-272: what each class is worth lives in the
 *     Cartography row's `unitMultipliers` in the rules file, and nowhere else. §8.4's requirement that
 *     the planner optimise exactly what the scorer awards is met by handing it the scorer's own row.
 */

export interface ExploredLookup {
  has(cell: H3Index): boolean
}

/** Mirrors `classifyCells`' verdicts for a cell, against `now` (the viewer's clock — this is a view). */
export type NoveltyClass = "new" | "rearmed" | "recent"

/**
 * What each class is worth. Structurally the Cartography row's `unitMultipliers` (`src/rules/schema.ts`
 * `Multipliers`), which the caller hands in — restated as a shape, not imported, because the domain
 * depends on nothing in the rules layer (`contract-drift.test.ts`).
 */
export type NoveltyWeights = Readonly<Record<NoveltyClass, number>>

export function cellClass(
  cell: H3Index,
  explored: ExploredLookup,
  lastRunAt: ReadonlyMap<H3Index, number> | null,
  now: number,
): NoveltyClass {
  if (!explored.has(cell)) return "new"
  const t = lastRunAt?.get(cell)
  // No lastRun data loaded → assume recent. §8.4: this degrades to binary explored/unexplored.
  if (t === undefined) return "recent"
  return now - t >= SIX_MONTHS_MS ? "rearmed" : "recent"
}

/** §8.4's `cellNovelty`: the scorer's weight for the cell's class. */
export function cellNovelty(
  cell: H3Index,
  explored: ExploredLookup,
  lastRunAt: ReadonlyMap<H3Index, number> | null,
  now: number,
  weights: NoveltyWeights,
): number {
  return weights[cellClass(cell, explored, lastRunAt, now)]
}

export interface FrontierCluster {
  parent: H3Index
  centre: Located
  /** Mean novelty over the cluster's cells inside the disk, in the scorer's units (1 = all never-run). */
  noveltyFraction: number
  distanceM: number
  /** Degrees clockwise from true north, origin → centre, [0, 360). */
  bearing: number
  score: number
}

export interface FrontierInput {
  origin: Located
  radiusM: number
  explored: ExploredLookup
  weights: NoveltyWeights
  lastRunAt?: ReadonlyMap<H3Index, number> | null
  now?: number
  clusterRes?: number
}

/** The default radius: §8.4's 4 km. */
export const FRONTIER_RADIUS_M = 4000

/** Clusters of nearby novelty, best first. Pure; no clock unless `lastRunAt` is given with `now`. */
export function frontier({
  origin,
  radiusM,
  explored,
  weights,
  lastRunAt = null,
  now = 0,
  clusterRes = 8,
}: FrontierInput): FrontierCluster[] {
  const spacing = getHexagonEdgeLengthAvg(RES, UNITS.m) * Math.sqrt(3)
  const k = Math.ceil(radiusM / spacing)
  const disk = gridDisk(latLngToCell(origin.lat, origin.lng, RES), k)

  const clusters = new Map<H3Index, { total: number; novelty: number }>()
  for (const c of disk) {
    const parent = cellToParent(c, clusterRes)
    const acc = clusters.get(parent) ?? { total: 0, novelty: 0 }
    acc.total += 1
    acc.novelty += cellNovelty(c, explored, lastRunAt, now, weights)
    clusters.set(parent, acc)
  }

  return [...clusters].map(([parent, a]) => {
    const [lat, lng] = cellToLatLng(parent)
    const centre = { lat, lng }
    const distanceM = metresBetween(origin, centre)
    const noveltyFraction = a.novelty / a.total
    return {
      parent,
      centre,
      noveltyFraction,
      distanceM,
      bearing: bearingDeg(origin, centre),
      score: noveltyFraction / Math.max(1, distanceM / 1000),
    }
  }).sort((x, y) => y.score - x.score || x.parent.localeCompare(y.parent))
}

/** Initial great-circle bearing, degrees clockwise from north. */
export function bearingDeg(a: Located, b: Located): number {
  const r = Math.PI / 180
  const y = Math.sin((b.lng - a.lng) * r) * Math.cos(b.lat * r)
  const x =
    Math.cos(a.lat * r) * Math.sin(b.lat * r) - Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos((b.lng - a.lng) * r)
  return ((Math.atan2(y, x) / r) % 360 + 360) % 360
}
