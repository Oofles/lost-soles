import { cellToLatLng, getHexagonEdgeLengthAvg, type H3Index } from "h3-js"

import { bigToCell } from "@/src/domain/explored-blob"

import { INSTANCE_FLOATS, REVEAL_SCALE } from "./mask"

/**
 * CELLS → INSTANCE ATTRIBUTES. Ticket `0055`. `05-fog-of-war.md` §4.1, §4.2, §6.1.
 *
 * Criterion 5: the layout is `{centerMercX, centerMercY, radiusMerc, fraction}`, **packed once per
 * bucket, never per frame**. Everything expensive — `cellToLatLng`, the mercator projection, the
 * latitude correction on the radius — happens exactly here, and the result is a `Float32Array` that
 * is uploaded to the GPU and then left alone. §6.1: *"Never call `cellToBoundary` or `map.project()`
 * per frame. The vertex shader does all projection."*
 *
 * That is not a micro-optimisation, it is the entire performance claim. §6.3 budgets **~0 ms of CPU
 * per frame** with the camera still, and §6.2 calls per-frame JS projection *"the largest single
 * cost in the whole system, and the one thing that would break the 60 fps claim"*.
 *
 * SEPARATE FROM `mask.ts` SO THAT FILE CAN STAY IMPORT-FREE — h3-js lives here and nowhere near
 * the module `tools/fog-harness` compiles alone.
 *
 * WHAT THIS FILE DOES NOT DO: choose a resolution for the current zoom, cull against the viewport,
 * or cache buckets. That is `0058`, and it is deliberately not started here — this file takes the
 * cells it is given and the resolution it is told.
 */

/**
 * §2.1's table: at res 10 the edge length **is** the circumradius, 75.9 m. Stated here as the
 * design's number rather than derived, and `instances.test.ts` asserts h3-js agrees with it to
 * within 0.1 m — so an h3 upgrade that changes the average-edge-length table becomes a failing
 * test rather than a fog that quietly renders at the wrong radius.
 */
export const RES10_CIRCUMRADIUS_M = 75.9

/**
 * Earth's circumference on the sphere this project uses **throughout** — `src/domain/geo.ts`'s
 * `EARTH_RADIUS_M = 6_371_008.8`, which is also what `h3-js` and MapLibre use.
 *
 * NOT the WGS84 equatorial radius (6,378,137 m). `0118` lost time to exactly that substitution in a
 * test: it is a 0.11% error, far too small to see and far too large to accept, and it would make the
 * rendered radius disagree with the scored one — the creep §2.3 spends a page warning about.
 */
export const EARTH_CIRCUMFERENCE_M = 2 * Math.PI * 6_371_008.8

/**
 * §4.1's disc radius for a bucket's resolution: `revealScale × circumradius`.
 *
 * At res 10 that is 1.35 × 75.86 ≈ 102 m against 131.4 m centre spacing, so every neighbour's disc
 * overlaps yours past its half-power point and a run of cells merges into one region. Coarse buckets
 * scale the same way, which is what keeps `0058`'s zoom-outs looking like the same material rather
 * than like a different effect.
 */
export function discRadiusM(res: number): number {
  return REVEAL_SCALE * getHexagonEdgeLengthAvg(res, "m")
}

/* ─── Web mercator 0..1, the space MapLibre's `projectTile` takes ────────────── */

export function mercatorX(lng: number): number {
  return lng / 360 + 0.5
}

export function mercatorY(lat: number): number {
  return 0.5 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / (2 * Math.PI)
}

/**
 * Metres on the ground → mercator units at a given latitude.
 *
 * The `cos(lat)` is the whole content: mercator units are constant across the world but the ground
 * they cover shrinks toward the poles, so one radius in metres is a different number of mercator
 * units at every latitude. This is why §4.2's comment says a mercator-space disc is still a disc on
 * screen and needs no latitude correction for its SHAPE, while `a_radius` carries the ground-size
 * variation. Getting this wrong is invisible at home and wrong everywhere else.
 */
export function metresToMercator(metres: number, lat: number): number {
  return metres / (EARTH_CIRCUMFERENCE_M * Math.cos((lat * Math.PI) / 180))
}

/* ─── The packed bucket ─────────────────────────────────────────────────────── */

export interface PackedBucket {
  /** The H3 resolution these cells are at. Res 10 is canonical (D-115); coarser is `0058`'s. */
  res: number
  /** `INSTANCE_FLOATS` per cell, in criterion 5's order. Uploaded whole; never rewritten per frame. */
  instances: Float32Array
  /** `visibleInstanceCount` (§6.4 item 1) — the canary for the entire performance claim. */
  count: number
}

export interface PackOptions {
  /** Defaults to 10, the canonical stored resolution. */
  res?: number
  /**
   * Per-cell coverage weight, 0..1 — `explored-agg.json`'s `fraction` for a coarse parent (§6.1,
   * `src/domain/explored-agg.ts`). Absent means 1.0, which is what every res-10 cell is: a stored
   * cell is fully explored by definition, so the canonical bucket needs no map at all.
   */
  fractions?: ReadonlyMap<H3Index, number>
}

/**
 * Pack one bucket. Called on a data change or a bucket change — **not on the frame path**.
 *
 * `fraction` is clamped rather than trusted. It reaches the shader as a multiplier on coverage, so a
 * value above 1 would let a coarse cell out-write a fully-explored one under `MAX` and a negative
 * one would silently vanish; `explored-agg.json` is generated and ought to be in range, but this is
 * the boundary where an out-of-range number stops being data and starts being a rendering bug.
 */
export function packBucket(cells: readonly H3Index[], options: PackOptions = {}): PackedBucket {
  const res = options.res ?? 10
  const radiusM = discRadiusM(res)
  const instances = new Float32Array(cells.length * INSTANCE_FLOATS)

  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i]!
    const [lat, lng] = cellToLatLng(cell)
    const fraction = options.fractions?.get(cell) ?? 1
    const at = i * INSTANCE_FLOATS
    instances[at + 0] = mercatorX(lng)
    instances[at + 1] = mercatorY(lat)
    instances[at + 2] = metresToMercator(radiusM, lat)
    instances[at + 3] = fraction < 0 ? 0 : fraction > 1 ? 1 : fraction
  }

  return { res, instances, count: cells.length }
}

/**
 * `0054`'s decoded array → the H3 ids `packBucket` takes.
 *
 * A SEPARATE STEP AND NOT FOLDED INTO `packBucket`, because it is the expensive half at scale —
 * 150k `bigToCell` calls is 150k string allocations — and `0058` will not pay it: its coarse buckets
 * come from `cellToParent`, which already yields ids. Keeping it visible is what stops the res-10
 * path's cost from being hidden inside a function whose name says "pack".
 */
export function blobCellsToIds(cells: BigUint64Array): H3Index[] {
  const out = new Array<H3Index>(cells.length)
  for (let i = 0; i < cells.length; i++) out[i] = bigToCell(cells[i]!)
  return out
}
