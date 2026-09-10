import { cellToLatLng, getHexagonEdgeLengthAvg, gridDisk, type H3Index } from "h3-js"

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
 *
 * ─── BRIDGE DISCS (D-232) ───────────────────────────────────────────────────
 *
 * It packs MORE discs than there are cells, and the extra ones are not cells.
 *
 * A run reveals a chain of cells one cell wide — measured on real data, 40 of 98 cells had exactly
 * two revealed neighbours. Discs of 102 m radius at 121 m spacing DO overlap, so the coverage field
 * has no gap; but the union's **silhouette** pinches to 0.79 of its bulge at every junction, and at
 * the tighter contour where `0056` puts the visible boundary, to 0.61. That is a string of pearls,
 * it is what the operator saw, and no falloff constant fixes it — it is the geometry of two circles
 * that overlap only a little.
 *
 * So the field is densified: one disc at the midpoint of every adjacent revealed pair. That halves
 * the effective spacing and takes the silhouette to 0.95. It is the same move `DENSIFY_STEP_M`
 * already makes on the trace before projecting it, one layer further out.
 *
 * **A BRIDGE IS A LOOK, NOT A CELL.** Nothing here writes to the explored set, and nothing about
 * what counts as explored changes — `check-fog-render-boundary.mjs` guards that line and this stays
 * on the render side of it. `explored-set.ts` is explicit that the client never invents cells; a
 * bridge is not a cell, has no id, and exists only as four floats in a vertex buffer.
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
  /** `INSTANCE_FLOATS` per instance, in criterion 5's order. Uploaded whole; never rewritten per frame. */
  instances: Float32Array
  /** `visibleInstanceCount` (§6.4 item 1) — the canary for the entire performance claim. */
  count: number
  /** How many of `count` are real cells. */
  cells: number
  /** How many are bridge discs (D-232). `count === cells + bridges`. */
  bridges: number
}

export interface PackOptions {
  /** Defaults to 10, the canonical stored resolution. */
  res?: number
  /**
   * Bridge discs between adjacent revealed cells. **D-232.** Defaults on; `false` is for tests that
   * want the bare cell field, and for measuring what the bridges are worth.
   */
  densify?: boolean
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
  const clamp = (f: number) => (f < 0 ? 0 : f > 1 ? 1 : f)

  /**
   * Every disc, cells first. Built as a plain array rather than written straight into the typed
   * array because the bridge count is not known until the adjacency walk has run, and sizing the
   * `Float32Array` twice would cost more than the intermediate.
   */
  const discs: Array<{ x: number; y: number; r: number; fraction: number }> = []
  /** Mercator centre, radius and fraction per cell, kept so the bridge pass does not re-project. */
  const byCell = new Map<H3Index, { x: number; y: number; r: number; fraction: number }>()

  for (const cell of cells) {
    const [lat, lng] = cellToLatLng(cell)
    const disc = {
      x: mercatorX(lng),
      y: mercatorY(lat),
      r: metresToMercator(radiusM, lat),
      fraction: clamp(options.fractions?.get(cell) ?? 1),
    }
    discs.push(disc)
    byCell.set(cell, disc)
  }

  let bridges = 0
  if (options.densify !== false) {
    for (const cell of cells) {
      const here = byCell.get(cell)!
      for (const neighbour of gridDisk(cell, 1)) {
        // Each edge once. A string compare is enough and needs no second set.
        if (neighbour === cell || neighbour <= cell) continue
        const there = byCell.get(neighbour)
        if (!there) continue
        discs.push({
          x: (here.x + there.x) / 2,
          y: (here.y + there.y) / 2,
          r: (here.r + there.r) / 2,
          /**
           * `min`, not the average. A bridge exists to fill the waist between two discs, never to
           * invent coverage: under `MAX` a bridge brighter than its dimmer endpoint would raise the
           * mask above what either cell earned. At res 10 both are 1.0 and this is a no-op; it
           * matters for `0058`'s coarse buckets, where two parents can differ sharply.
           */
          fraction: Math.min(here.fraction, there.fraction),
        })
        bridges++
      }
    }
  }

  const instances = new Float32Array(discs.length * INSTANCE_FLOATS)
  for (let i = 0; i < discs.length; i++) {
    const d = discs[i]!
    const at = i * INSTANCE_FLOATS
    instances[at + 0] = d.x
    instances[at + 1] = d.y
    instances[at + 2] = d.r
    instances[at + 3] = d.fraction
  }

  return { res, instances, count: discs.length, cells: cells.length, bridges }
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
