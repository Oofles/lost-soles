import { cellToLatLng, getHexagonEdgeLengthAvg, gridDisk, type H3Index } from "h3-js"

import { bigToCell } from "@/src/domain/explored-blob"
import { RES } from "@/src/domain/fog"

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
 * or cache buckets. That is `zoom-buckets.ts` and `cull.ts` (`0058`) — this file takes the cells it
 * is given and the resolution it is told, which is exactly what makes it reusable as `0058`'s
 * per-group packing step.
 *
 * ─── BRIDGE DISCS (D-232) ───────────────────────────────────────────────────
 *
 * It packs MORE discs than there are cells, and the extra ones are not cells.
 *
 * A run reveals a narrow chain of cells. Adjacent discs DO overlap at any resolution — the ratio is
 * scale-invariant, see `discRadiusM` — so the coverage field has no gap; but the union's
 * **silhouette** pinches to 0.79 of its bulge at every junction, and at the tighter contour where
 * `0056` puts the visible boundary, to 0.61. That is a string of pearls, it is what the operator
 * saw, and no falloff constant fixes it — it is the geometry of two circles that overlap only a
 * little.
 *
 * So the field is densified: one disc at the midpoint of every adjacent revealed pair. That halves
 * the effective spacing and takes the silhouette to 0.95. It is the same move `DENSIFY_STEP_M`
 * already makes on the trace before projecting it, one layer further out.
 *
 * ─── AND NOT IN THE INTERIOR — `0058`, D-238 ────────────────────────────────
 *
 * A bridge fills the waist between two discs whose union has a silhouette. **An interior cell's
 * union has no silhouette anywhere near it**, so its bridges paint coverage over ground that is
 * already saturated: at res 11 the worst-covered interior point is a three-cell centroid, 28.6 m
 * from the nearest centre against a 38.7 m disc. Six neighbours means nothing to bridge.
 *
 * So an edge is bridged **unless both of its endpoints have all six neighbours revealed.** Measured
 * on the two shapes that matter:
 *
 *   solid field, res 11, 4,921 cells   14,520 edges -> 714 bridges    3.95x instances -> 1.15x
 *   a run's corridor,       255 cells      573 edges -> 523 bridges    3.25x instances -> 3.05x
 *
 * The corridor — the case D-232 was built for — keeps 91% of its bridges, and so does the boundary
 * of any solid patch. What goes away is the part that was never doing anything.
 *
 * **This is what makes §6.4's 6,000-instance ceiling survive D-237.** Res 11 multiplied cells by 7
 * and a 4x bridge multiplier on top of that put a fully-revealed 400x800 viewport at ~14,700
 * instances; at 1.15x it is ~4,200. Without elision the ceiling is unreachable at the canonical
 * resolution — `0058`'s Resolution has the arithmetic.
 *
 * **A BRIDGE IS A LOOK, NOT A CELL.** Nothing here writes to the explored set, and nothing about
 * what counts as explored changes — `check-fog-render-boundary.mjs` guards that line and this stays
 * on the render side of it. `explored-set.ts` is explicit that the client never invents cells; a
 * bridge is not a cell, has no id, and exists only as four floats in a vertex buffer.
 */

/**
 * §2.1's table: at the canonical resolution the edge length **is** the circumradius — **28.7 m at
 * res 11** (D-237; it was 75.9 m at res 10). Stated here as the design's number rather than
 * derived, and `instances.test.ts` asserts h3-js agrees with it to within 0.1 m — so an h3 upgrade
 * that changes the average-edge-length table becomes a failing test rather than a fog that quietly
 * renders at the wrong radius.
 *
 * The 2.6x shrink is the whole content of D-237: the disc is `revealScale x circumradius`, so the
 * brush went 102 m -> 39 m and a corridor whose centres wander a median 28 m stopped reading as a
 * zig-zag. `0194` has the measurements.
 */
export const CANONICAL_CIRCUMRADIUS_M = 28.7

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
 * At res 11 that is 1.35 × 28.66 ≈ 38.7 m against 49.6 m centre spacing, so every neighbour's disc
 * overlaps yours past its half-power point and a run of cells merges into one region.
 *
 * THE RATIO IS SCALE-INVARIANT — radius/spacing is `revealScale / sqrt(3)` ≈ 0.78 at **every**
 * resolution, because both terms are the edge length. That is what keeps `0058`'s zoom-outs looking
 * like the same material rather than like a different effect, and it is also why D-232's bridges are
 * needed at every bucket rather than only at the finest one.
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
  /** The H3 resolution these cells are at. Res 11 is canonical (D-237); coarser is `0058`'s. */
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
  /** Defaults to `RES`, the canonical stored resolution. */
  res?: number
  /**
   * Bridge discs between adjacent revealed cells. **D-232.** Defaults on; `false` is for tests that
   * want the bare cell field, and for measuring what the bridges are worth.
   */
  densify?: boolean
  /**
   * Per-cell coverage weight, 0..1 — the fraction of a coarse parent's children that are explored
   * (§6.1, and `src/domain/explored-agg.ts` for the same arithmetic server-side). `undefined` means
   * 1.0, which is what every cell at the canonical resolution is: a stored cell is fully explored by
   * definition, so the finest bucket needs no fractions at all.
   *
   * A CALLBACK RATHER THAN A MAP, because the bridge pass reaches **outside** the cells it was given
   * — `0058` packs one res-6/7 group at a time and an edge at the group's border has its far endpoint
   * in the next group. A map would have to be built with a border nobody knows in advance; a callback
   * answers for any cell the pass happens to touch.
   */
  fractionOf?: (cell: H3Index) => number | undefined
  /**
   * Is this cell revealed? Defaults to *"is it in `cells`"*.
   *
   * `0058` passes the whole explored set's `has()` so that a group's border cells bridge to their
   * neighbours in the adjacent group. Without it every group boundary would be a visible seam in the
   * silhouette — the string-of-pearls pinch D-232 removed, reintroduced on a grid of its own.
   */
  member?: (cell: H3Index) => boolean
}

/** One disc, before it is flattened into the instance array. */
interface Disc {
  x: number
  y: number
  r: number
  fraction: number
}

/**
 * Pack one bucket, or one of `0058`'s groups. Called on a data change or a bucket change — **not on
 * the frame path**.
 *
 * `fraction` is clamped rather than trusted. It reaches the shader as a multiplier on coverage, so a
 * value above 1 would let a coarse cell out-write a fully-explored one under `MAX` and a negative
 * one would silently vanish; the fractions are derived rather than typed in, but this is the
 * boundary where an out-of-range number stops being data and starts being a rendering bug.
 */
export function packBucket(cells: readonly H3Index[], options: PackOptions = {}): PackedBucket {
  const res = options.res ?? RES
  const radiusM = discRadiusM(res)
  const clamp = (f: number) => (f < 0 ? 0 : f > 1 ? 1 : f)

  /**
   * Every disc, cells first. Built as a plain array rather than written straight into the typed
   * array because the bridge count is not known until the adjacency walk has run, and sizing the
   * `Float32Array` twice would cost more than the intermediate.
   */
  const discs: Disc[] = []
  /** Mercator centre, radius and fraction per cell, kept so the bridge pass does not re-project. */
  const byCell = new Map<H3Index, Disc>()

  const project = (cell: H3Index): Disc => {
    const existing = byCell.get(cell)
    if (existing) return existing
    const [lat, lng] = cellToLatLng(cell)
    const disc = {
      x: mercatorX(lng),
      y: mercatorY(lat),
      r: metresToMercator(radiusM, lat),
      fraction: clamp(options.fractionOf?.(cell) ?? 1),
    }
    byCell.set(cell, disc)
    return disc
  }

  for (const cell of cells) discs.push(project(cell))

  let bridges = 0
  if (options.densify !== false) {
    /**
     * `member` defaults to the cells given, which is `0055`'s behaviour and what every test that
     * does not care about groups expects. The `Set` is built only when it is going to be consulted.
     */
    const member = options.member ?? ((c: H3Index) => byCell.has(c))

    /**
     * Revealed neighbours per cell, memoised — the interior test needs the degree of **both**
     * endpoints of every edge, so each cell's `gridDisk` would otherwise be walked up to seven
     * times. At 500k cells `gridDisk` is 3.1 µs a call and is the single most expensive thing in
     * this file, which is why `zoom-buckets.ts` never calls it for more than one group at a time.
     */
    const revealed = new Map<H3Index, H3Index[]>()
    const neighboursOf = (cell: H3Index): H3Index[] => {
      const cached = revealed.get(cell)
      if (cached) return cached
      const out: H3Index[] = []
      for (const n of gridDisk(cell, 1)) if (n !== cell && member(n)) out.push(n)
      revealed.set(cell, out)
      return out
    }

    for (const cell of cells) {
      const here = byCell.get(cell)!
      const mine = neighboursOf(cell)
      /**
       * SIX, not `>= 5`. A cell with five revealed neighbours has a silhouette on its sixth side and
       * the edge nearest it still pinches. The test is deliberately the strictest one that removes
       * the measured 95% of a solid field's bridges — see the header.
       *
       * A PENTAGON HAS FIVE. There are 12 per resolution and the odds of a run reaching one are
       * negligible, but the consequence of being wrong here is an extra bridge rather than a missing
       * one, so `=== 6` is also the safe side to be on.
       */
      const interiorHere = mine.length === 6
      for (const neighbour of mine) {
        // Each edge once. A string compare is enough and needs no second set.
        if (neighbour <= cell) continue
        if (interiorHere && neighboursOf(neighbour).length === 6) continue
        /**
         * `project`, not `byCell.get` — at a group's border the far endpoint belongs to the next
         * group and has not been projected here. It costs one `cellToLatLng` per border edge, which
         * is a group's perimeter rather than its area.
         */
        const there = project(neighbour)
        discs.push({
          x: (here.x + there.x) / 2,
          y: (here.y + there.y) / 2,
          r: (here.r + there.r) / 2,
          /**
           * `min`, not the average. A bridge exists to fill the waist between two discs, never to
           * invent coverage: under `MAX` a bridge brighter than its dimmer endpoint would raise the
           * mask above what either cell earned. At the canonical resolution both are 1.0 and this is
           * a no-op; it matters for `0058`'s coarse buckets, where two parents can differ sharply.
           */
          fraction: Math.min(here.fraction, there.fraction),
        })
        bridges++
      }
    }
  }

  return {
    res,
    instances: flattenDiscs(discs),
    count: discs.length,
    cells: cells.length,
    bridges,
  }
}

/** Discs → the four-float-per-instance layout `mask.ts` draws. */
function flattenDiscs(discs: readonly Disc[]): Float32Array {
  const instances = new Float32Array(discs.length * INSTANCE_FLOATS)
  for (let i = 0; i < discs.length; i++) {
    const d = discs[i]!
    const at = i * INSTANCE_FLOATS
    instances[at + 0] = d.x
    instances[at + 1] = d.y
    instances[at + 2] = d.r
    instances[at + 3] = d.fraction
  }
  return instances
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
