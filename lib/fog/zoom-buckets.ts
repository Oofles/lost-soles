import {
  cellToBoundary,
  cellToParent,
  getHexagonEdgeLengthAvg,
  gridDisk,
  type H3Index,
} from "h3-js"

import { bigToCell } from "@/src/domain/explored-blob"
import { RES, RES_PARENT } from "@/src/domain/fog"

import { discRadiusM, mercatorX, mercatorY, metresToMercator, packBucket } from "./instances"
import type { BucketInvalidator, ExploredSet } from "./explored-set"

/**
 * ZOOM BUCKETING. Ticket `0058`. `05-fog-of-war.md` §6.1, §6.2; D-237, D-238.
 *
 * ─── WHAT THIS FILE IS DEFENDING ────────────────────────────────────────────
 *
 * R4's claim is 50k–500k stored cells at 60 fps, and §6 is blunt that it *"is not a property of the
 * GPU; it is a property of the CPU-side data pipeline"* — this file and `cull.ts`. Without them the
 * renderer works beautifully for a month and degrades invisibly for years, which is the failure mode
 * that has no bug report attached to it.
 *
 * The load-bearing insight, and the thing every decision below follows from: **on-screen cell count
 * is bounded by screen area, not by database size.** A 400×800 viewport holds roughly 1,400 cells at
 * ~15 CSS px per cell whether the account stores 50,000 or 500,000. Total stored cells affect
 * transport and storage only.
 *
 * ─── SO NOTHING HERE IS DERIVED FOR CELLS THAT ARE NOT ON SCREEN ────────────
 *
 * §6.1 says *"derive a bucket lazily, once, and cache it"* and prices the derivation at 30–80 ms.
 * That price was quoted for a `cellToParent` pass plus a dedupe. Measured on this machine at 500k
 * res-11 cells it is not the whole bill:
 *
 *   gridDisk(cell, 1) over 500k cells   1,543 ms      the bridge pass (D-232)
 *   cellToParent over 500k cells          256 ms      the dedupe
 *   cellToLatLng over 500k cells          214 ms      the projection
 *
 * 1.5 seconds of main thread on a desktop is five on a phone, for a bucket of which ~4,000 discs
 * will ever be looked at. So the laziness goes **one level deeper than a bucket**: the only thing
 * derived up front is the *index* — which cells belong to which res-6/7 group, and where each group
 * is on the map. Ids, fractions, projection and bridges are derived per group, on first sight, and
 * cached. A group is ~2,400 cells and costs ~10 ms.
 *
 * The index itself is cheap for a reason worth stating, because it looks like an O(n) pass and is
 * not. **A cell's ancestors are a prefix of its id**, so the ascending `BigUint64Array` `0054`
 * decodes is *already* grouped: every child of a group is contiguous. Finding the runs is therefore
 * a galloping binary search per group — O(G log(N/G)), about 2,300 `cellToParent` calls at 500k
 * against 500,000 — and it is what acceptance criterion 3 asserts.
 *
 * ─── THE GROUPING RESOLUTION IS NOT A FREE CHOICE ───────────────────────────
 *
 * §6.2 says to reuse *"the res-6 parent grouping that already exists in the storage partition key"*,
 * and calls it the third payoff of one decision. That arithmetic was `RES_PARENT = 6` against res-10
 * cells: 7⁴ = 2,401 children, which bounds a DynamoDB partition, bounds a viewport `Query`, and
 * bounds this. D-237 moved the cells to res 11 and a res-6 group now holds 7⁵ = **16,807** — the
 * figure `src/domain/fog.ts`'s own comment rejects. `0198` is the ticket that moves `RES_PARENT` to
 * 7 and restores all three numbers at once.
 *
 * `groupResFor` therefore asks for 2,401 children (`res - 4`) but never finer than `RES_PARENT`,
 * because the invalidation key `applyDelta` hands over is at `RES_PARENT` and a group finer than the
 * key is a group the key cannot address. Today that is res 7 for the res-11 bucket and res 6 for
 * every coarser one; once `0198` lands the two coincide again and this function becomes `RES_PARENT`
 * for every bucket. There is a test that says so.
 */

/* ─── §6.1's table ──────────────────────────────────────────────────────────── */

export interface ZoomBand {
  /** This band applies while `zoom <= maxZoom`. */
  maxZoom: number
  res: number
}

/**
 * Map zoom → render resolution. **D-238 rewrote §6.1's table** when D-237 made res 11 canonical, and
 * the rewrite is not cosmetic.
 *
 * §6.1's original table stopped at res 10 and gave it every zoom above 14. Appending res 11 above the
 * top and leaving res 10 where it was — the obvious amendment — would render the **102 m brush at the
 * zooms people actually run at**, which is precisely the zig-zag the operator rejected in `0194`: a
 * chain of centres wandering a median 28 m, painted with a disc 2.6× too wide, at 32 px of centre
 * spacing. D-237 would then be true of the data and false of the picture.
 *
 * The table's real rule is §6's *"choose the resolution so a cell is ~8–30 CSS px across"*, and each
 * H3 resolution is √7 ≈ 2.65× finer, i.e. **1.4 zoom levels**. Solving for ~15 px at 30°N:
 *
 *   res     4     5     6     7     8     9    10    11
 *   z    4.28  5.69  7.09  8.49  9.90 11.30 12.71 14.11
 *
 * Rounded to integer boundaries that is the table below, and every band lands between 14 and 32 px.
 *
 * **THE ZOOMS ARE MAPLIBRE ZOOMS, WHICH ARE NOT OSM ZOOMS.** MapLibre's world is 512 CSS px square at
 * z0, so its scale at z is the same as a 256-px-tile scheme's at z+1, and the familiar
 * `156543.03 · cos(lat) / 2^z` metres-per-pixel figure is one level out here. Getting that wrong puts
 * every boundary one level too coarse — which is a res-10 brush at z14, the exact defect above, and
 * it is how the first draft of this table was wrong.
 *
 * Res 11 therefore owns **z14 and up**, which is the whole of the ticket's *"typical running zooms
 * (z14–17)"*. z13 is res 10 and blobbier on purpose: a fully-revealed 400×800 viewport at z13 holds
 * ~2,100 res-10 cells and would hold ~14,700 res-11 ones, so the finer bucket is not available there
 * at any price. That is what a bucket ladder IS — §6.1's *"coarse buckets are the same material, just
 * larger"* — rather than a compromise this table is making reluctantly.
 *
 * Res 11 is canonical (D-237) and therefore the **finest** bucket; coarser ones are derived by
 * `cellToParent`. Rendering finer than you store means inventing ground — `0194` option C.
 */
export const ZOOM_TO_RES: readonly ZoomBand[] = [
  { maxZoom: 5, res: 4 },
  { maxZoom: 6, res: 5 },
  { maxZoom: 8, res: 6 },
  { maxZoom: 9, res: 7 },
  { maxZoom: 11, res: 8 },
  { maxZoom: 12, res: 9 },
  { maxZoom: 13, res: 10 },
  { maxZoom: Infinity, res: RES },
]

/**
 * The bucket resolution for a map zoom. **Never finer than `RES`** — which is the one property of
 * this function that is a correctness constraint rather than a tuning choice.
 *
 * MapLibre's zoom is continuous, so `z <= maxZoom` is evaluated against fractional values and a
 * pinch crosses a boundary exactly once. `NaN` — which a map mid-teardown can produce — falls
 * through to the finest bucket rather than throwing inside a move handler.
 */
export function resForZoom(zoom: number): number {
  for (const band of ZOOM_TO_RES) if (zoom <= band.maxZoom) return band.res
  return RES
}

/**
 * The resolution a bucket's cells are grouped by for step 1 of the cull. See the header: 2,401
 * children per group, never finer than `RES_PARENT` (the key `applyDelta` invalidates by), never
 * coarser than the bucket itself (or a bucket cell would span groups and its fraction would be
 * counted twice).
 */
export function groupResFor(res: number): number {
  return Math.min(res, Math.max(RES_PARENT, res - 4))
}

/** How many cells of resolution `res` an ancestor at `groupRes` holds. `02` T6's constant. */
export function childrenPerGroup(res: number, groupRes: number): number {
  return 7 ** (res - groupRes)
}

/* ─── The index: which cells are where ──────────────────────────────────────── */

/**
 * One group of the bucket: a contiguous run of the explored set's ascending cells, everything
 * derived from them, and a mercator bbox to cull it by.
 */
interface Group {
  /** The group's own H3 id, at `groupRes`. */
  id: H3Index
  /** `[lo, hi)` into the explored set's ascending cell array. */
  lo: number
  hi: number
  /** The bucket's own ids in this group, ascending, deduped. `null` until materialised. */
  ids: H3Index[] | null
  /** `ids` as a set, for the bridge pass's membership question. `null` until materialised. */
  members: Set<H3Index> | null
  /** Explored fraction per id. `null` at the canonical resolution, where every cell is 1.0. */
  fractions: Map<H3Index, number> | null
  /** Packed instance floats, cells then bridges. `null` until materialised. */
  discs: Float32Array | null
  cells: number
  bridges: number
}

/** What a derivation cost, for `0059`'s harness and for this ticket's own assertions. */
export interface DeriveEvent {
  kind: "index" | "group"
  res: number
  /** Groups in the index, or cells in the group. */
  size: number
  ms: number
}

/**
 * A bucket at one resolution: its group index, and its groups' geometry on demand.
 *
 * `cull.ts` consumes it through `CullableBucket`, which is this minus everything only this file
 * needs — so the cull is testable against a handful of hand-written bounds and never has to build an
 * `ExploredSet`.
 */
export class ZoomBucket {
  readonly res: number
  readonly groupRes: number

  #set: ExploredSet
  #groups: Group[] = []
  /** 4 floats per group: `minX, minY, maxX, maxY`, mercator, padded. §6.2's `parentBounds`. */
  #bounds = new Float64Array(0)
  #onDerive: ((event: DeriveEvent) => void) | undefined

  constructor(set: ExploredSet, res: number, onDerive?: (event: DeriveEvent) => void) {
    this.#set = set
    this.res = res
    this.groupRes = groupResFor(res)
    this.#onDerive = onDerive
    this.#reindex(null)
  }

  get groupCount(): number {
    return this.#groups.length
  }

  get groupBounds(): Float64Array {
    return this.#bounds
  }

  /** How many groups have had their geometry built. The cache-hit half of §6.4 item 5. */
  get materialisedGroups(): number {
    let n = 0
    for (const group of this.#groups) if (group.discs) n++
    return n
  }

  /** The group's H3 id, for tests and for the HUD. */
  groupId(index: number): H3Index {
    return this.#groups[index]!.id
  }

  /**
   * The group's packed instances, built on first sight and cached. Cells first, then D-232's
   * bridges — one array, because `mask.ts` draws one `drawArraysInstanced`.
   *
   * **This is the expensive call in the file** and it is the one the cull only ever makes for groups
   * that survived step 1. ~10 ms for a 2,401-cell group, dominated by `gridDisk`.
   */
  discsFor(index: number): Float32Array {
    const group = this.#groups[index]!
    if (group.discs) return group.discs

    const started = performance.now()
    const { ids } = this.#materialiseIds(index)
    const packed = packBucket(ids, {
      res: this.res,
      /**
       * THE WHOLE SET, not this group's ids. A cell at the group's border has neighbours in the next
       * group, and without them every group boundary would show as a pinch in the silhouette — the
       * string of pearls D-232 removed, reintroduced on a grid of its own. `instances.ts` gives each
       * cross-group edge to the lower id's group, exactly once.
       */
      member: (cell) => this.#isMember(cell),
      fractionOf: this.res === RES ? undefined : (cell) => this.#fractionOf(cell),
    })
    group.discs = packed.instances
    group.cells = packed.cells
    group.bridges = packed.bridges
    this.#tightenBounds(index)
    this.#onDerive?.({ kind: "group", res: this.res, size: ids.length, ms: performance.now() - started })
    return group.discs
  }

  /**
   * Replace a materialised group's estimated bbox with the exact one — the union of its discs'
   * bounding boxes, which is what the cull actually wants to test against.
   *
   * The estimate above is deliberately generous, so this is not a correction: it is the point at which
   * guessing stops being necessary. A tight bbox means fewer groups survive step 1 on later culls and
   * more of the survivors take the whole-group fast path in step 2.
   */
  #tightenBounds(index: number): void {
    const discs = this.#groups[index]!.discs
    if (!discs || discs.length === 0) return
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (let i = 0; i < discs.length; i += 4) {
      const x = discs[i]!
      const y = discs[i + 1]!
      const r = discs[i + 2]!
      if (x - r < minX) minX = x - r
      if (x + r > maxX) maxX = x + r
      if (y - r < minY) minY = y - r
      if (y + r > maxY) maxY = y + r
    }
    const at = index * 4
    this.#bounds[at + 0] = minX
    this.#bounds[at + 1] = minY
    this.#bounds[at + 2] = maxX
    this.#bounds[at + 3] = maxY
  }

  /** `{ cells, bridges }` for a materialised group; zeroes before that. For the HUD and tests. */
  groupStats(index: number): { cells: number; bridges: number } {
    const group = this.#groups[index]!
    return { cells: group.cells, bridges: group.bridges }
  }

  /**
   * The set changed in place (`applyDelta`). Rebuild the index and drop the geometry of the groups
   * the change could have touched — **and of their neighbours**, because a new cell in one group can
   * own a bridge on the far side of its boundary.
   *
   * THE INDEX IS REBUILT WHOLE AND THE GEOMETRY IS NOT, which is criterion 9 read literally. A delta
   * replaces the cell array, so every `lo`/`hi` shifts and there is nothing to patch; but the index
   * is a galloping binary search (~2 ms at 500k) and carries no projection, while the geometry is
   * the `cellToLatLng` and `gridDisk` work that actually costs — and that is recomputed only for the
   * groups named below. Rebuilding every bucket instead would be the difference between a new run
   * appearing and the whole map visibly re-rendering.
   */
  invalidate(parents: readonly H3Index[]): void {
    const stale = new Set<H3Index>()
    for (const parent of parents) {
      for (const id of this.#groupsUnder(parent)) {
        stale.add(id)
        // The neighbours own the bridges that cross into this group from the lower side.
        for (const near of gridDisk(id, 1)) stale.add(near)
      }
    }
    this.#reindex(stale)
  }

  /* ─── The index ──────────────────────────────────────────────────────────── */

  /**
   * Build (or rebuild) the group runs and their bounds, carrying over cached geometry by group id.
   * `stale` names the ids whose geometry must be dropped; `null` keeps everything that survives,
   * which is what a pure re-index after an unrelated change wants.
   */
  #reindex(stale: Set<H3Index> | null): void {
    const started = performance.now()
    const previous = new Map(this.#groups.map((group) => [group.id, group]))
    const cells = this.#set.cells
    const groups: Group[] = []

    let i = 0
    while (i < cells.length) {
      const id = this.#groupAt(cells, i)
      const end = this.#runEnd(cells, i, id)
      const carried = previous.get(id)
      /**
       * REUSED ON CELL COUNT, NOT ON `lo`. A delta inserts into the middle of the array, so every
       * group after the insertion point shifts — keying reuse on `lo` would drop the geometry of
       * every group downstream of a one-cell change, which is the whole cost this cache exists to
       * avoid. The set is append-only (D-020), so a group with the same id and the same number of
       * cells holds the same cells.
       */
      const reusable = carried && !stale?.has(id) && carried.hi - carried.lo === end - i
      groups.push(
        reusable
          ? { ...carried!, lo: i, hi: end }
          : {
              id,
              lo: i,
              hi: end,
              ids: null,
              members: null,
              fractions: null,
              discs: null,
              cells: 0,
              bridges: 0,
            },
      )
      i = end
    }

    this.#groups = groups
    this.#bounds = new Float64Array(groups.length * 4)
    for (let g = 0; g < groups.length; g++) this.#writeBounds(g)

    this.#onDerive?.({
      kind: "index",
      res: this.res,
      size: groups.length,
      ms: performance.now() - started,
    })
  }

  /** The group id of the cell at `index`. Two calls, and the only thing the index walk pays for. */
  #groupAt(cells: BigUint64Array, index: number): H3Index {
    return cellToParent(bigToCell(cells[index]!), this.groupRes)
  }

  /**
   * The first index past the run of cells belonging to `id`, starting at `from`.
   *
   * A GALLOPING SEARCH, NOT A SCAN, and that is what makes the index O(G log(N/G)) instead of O(N).
   * It is correct only because a cell's ancestors are a prefix of its id, so the ascending array is
   * already grouped — `zoom-buckets.test.ts` asserts that on a 43k-cell fixture at three grouping
   * resolutions rather than trusting it.
   */
  #runEnd(cells: BigUint64Array, from: number, id: H3Index): number {
    const n = cells.length
    let lo = from
    let step = 1
    while (lo + step < n && this.#groupAt(cells, lo + step) === id) {
      lo += step
      step *= 2
    }
    // `hi` is an index known (or assumed, at the end of the array) to be outside the run.
    let hi = Math.min(n, lo + step)
    while (lo + 1 < hi) {
      const mid = (lo + hi) >>> 1
      if (this.#groupAt(cells, mid) === id) lo = mid
      else hi = mid
    }
    return lo + 1
  }

  /**
   * One `cellToBoundary` per group — never per cell, and never per frame (§6.1).
   *
   * ─── THE MARGIN, AND THE MEASUREMENT THAT SET IT ────────────────────────
   *
   * **H3's hierarchy is not geometrically nested**, and not by a little. `cellToParent` is index
   * arithmetic, not containment: a child's centre can land well OUTSIDE the parent's drawn boundary.
   * Measured over a 60-ring disc at three latitudes, the worst overshoot as a fraction of the parent's
   * edge length was
   *
   *   groupRes      5       6       7       8
   *   Nemo          0    0.051   0.131   0.001
   *   30°N      0.066    0.107   0.050   0.063
   *   64°N          0    0.055   0.085   0.017
   *
   * — up to **184 m at res 7**, which is 6.4 child cells and 30× the margin this started out with
   * (4 disc radii, 155 m, chosen on the assumption that non-nesting was a half-cell affair). A bbox
   * short by that much drops fog at a group seam under the cull, which is a hole in the map that
   * appears and disappears as you pan.
   *
   * So the margin is **half the group's own edge length** — four times the largest number in that
   * table — plus two disc radii for the disc itself and the bridge it may own on the far side. The
   * bbox grows ~25% linearly, which costs an occasional extra group materialisation near a boundary
   * and nothing else. Over-inclusion at step 1 is a performance cost; under-inclusion is a bug.
   *
   * **AND THE BOUNDS ARE REPLACED WITH THE EXACT ONES ONCE THE GROUP IS MATERIALISED** — see
   * `#tightenBounds`. The estimate only has to be SAFE, and the moment the discs exist there is no
   * reason to keep guessing.
   */
  #writeBounds(index: number): void {
    const group = this.#groups[index]!
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    let lat = 0
    for (const [vLat, vLng] of cellToBoundary(group.id)) {
      const x = mercatorX(vLng)
      const y = mercatorY(vLat)
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
      lat = vLat
    }
    /**
     * Latitude-corrected here rather than at 0° — a mercator unit is a different number of metres at
     * every latitude, and a margin computed at the equator would be ~35% too small at 30°N. Getting
     * this wrong is invisible at home and wrong everywhere else, which is the same trap
     * `metresToMercator`'s own comment records.
     */
    const margin = metresToMercator(
      0.5 * getHexagonEdgeLengthAvg(this.groupRes, "m") + 2 * discRadiusM(this.res),
      lat,
    )
    const at = index * 4
    this.#bounds[at + 0] = minX - margin
    this.#bounds[at + 1] = minY - margin
    this.#bounds[at + 2] = maxX + margin
    this.#bounds[at + 3] = maxY + margin
    // A group whose geometry survived the re-index keeps its exact bounds rather than falling back to
    // the estimate — the discs have not moved.
    if (group.discs) this.#tightenBounds(index)
  }

  /* ─── Per-group derivation ───────────────────────────────────────────────── */

  /**
   * The group's ids at the bucket's resolution, with the explored fraction of each.
   *
   * At `RES` this is `bigToCell` over the run and nothing else — the ids *are* the stored cells and
   * every one of them is fully explored by definition (§1.1), so there is no dedupe and no fraction
   * map to build.
   *
   * Coarser than `RES` it is §6.1's `cellToParent` pass plus a dedupe, and the dedupe is a
   * comparison with the previous id rather than a `Set`, because the run is ascending and a parent's
   * children are contiguous. The run length per parent is its explored child count, which is the
   * numerator of `fraction` — **computed here rather than fetched.**
   *
   * WHY NOT `explored-agg.json`. `src/domain/explored-agg.ts` writes exactly this number to S3 per
   * generation, and `0058` was specified to read it from there. Nothing in the browser can: there is
   * no route, no transport method and no cache path for that object, and it covers res 6/7/8 while
   * this table needs 4 through 10. The client already holds every cell, and the count is a
   * by-product of a pass it is running anyway — so the number is derived from the same bytes the
   * fog is drawn from and cannot disagree with them. The S3 object stays the server-side artifact
   * for §8's statistics. Recorded as D-238.
   */
  #materialiseIds(index: number): { ids: H3Index[]; members: Set<H3Index> } {
    const group = this.#groups[index]!
    if (group.ids && group.members) return { ids: group.ids, members: group.members }

    const cells = this.#set.cells
    const ids: H3Index[] = []

    if (this.res === RES) {
      for (let i = group.lo; i < group.hi; i++) ids.push(bigToCell(cells[i]!))
    } else {
      const total = childrenPerGroup(RES, this.res)
      const fractions = new Map<H3Index, number>()
      let current: H3Index | null = null
      let seen = 0
      const flush = () => {
        if (current !== null) fractions.set(current, seen / total)
      }
      for (let i = group.lo; i < group.hi; i++) {
        const parent = cellToParent(bigToCell(cells[i]!), this.res)
        if (parent !== current) {
          flush()
          ids.push(parent)
          current = parent
          seen = 0
        }
        seen++
      }
      flush()
      group.fractions = fractions
    }

    group.ids = ids
    group.members = new Set(ids)
    return { ids, members: group.members }
  }

  /** Which group holds this id, or -1. Binary search: the group ids are ascending. */
  #indexOfGroup(id: H3Index): number {
    let lo = 0
    let hi = this.#groups.length - 1
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1
      const at = this.#groups[mid]!.id
      if (at === id) return mid
      if (at < id) lo = mid + 1
      else hi = mid - 1
    }
    return -1
  }

  /**
   * Is this cell revealed, at the bucket's resolution?
   *
   * At `RES` the explored set answers directly — O(1), no group to materialise. Coarser, the
   * question is whether any child of that parent is explored, which only the parent's own group can
   * answer; materialising it costs the dedupe pass for one group and nothing else. That is what lets
   * a border cell bridge into a group the cull never visited.
   */
  #isMember(cell: H3Index): boolean {
    if (this.res === RES) return this.#set.has(cell)
    const index = this.#indexOfGroup(cellToParent(cell, this.groupRes))
    if (index < 0) return false
    return this.#materialiseIds(index).members.has(cell)
  }

  #fractionOf(cell: H3Index): number | undefined {
    const index = this.#indexOfGroup(cellToParent(cell, this.groupRes))
    if (index < 0) return undefined
    this.#materialiseIds(index)
    return this.#groups[index]!.fractions?.get(cell)
  }

  /**
   * The groups affected by an invalidation key at `RES_PARENT`.
   *
   * Two cases, and both are live today: when the grouping is coarser than the key (every bucket
   * below res 11, grouped at res 6 against a res-6 key) it is one group, found by binary search.
   * When it is finer (the res-11 bucket, grouped at res 7) the key covers up to seven groups, and
   * they are found by a scan — there are a few hundred groups at 500k cells and this runs once per
   * delta, so a second index to make it a range query would cost more than it saves.
   */
  #groupsUnder(parent: H3Index): H3Index[] {
    if (this.groupRes <= RES_PARENT) {
      const index = this.#indexOfGroup(cellToParent(parent, this.groupRes))
      return index < 0 ? [] : [this.#groups[index]!.id]
    }
    const out: H3Index[] = []
    for (const group of this.#groups) {
      if (cellToParent(group.id, RES_PARENT) === parent) out.push(group.id)
    }
    return out
  }
}

/* ─── The cache of buckets ──────────────────────────────────────────────────── */

/**
 * One bucket per resolution, derived on first sight and kept. §6.1: *"derive a bucket lazily, once,
 * and cache it."*
 *
 * IT IS THE SET'S INVALIDATOR. `explored-set.ts` declared `BucketInvalidator` for this class before
 * it existed; `applyDelta` calls `invalidateParents` with the res-6 parents one hop touched, and
 * every cached bucket drops exactly those groups' geometry.
 *
 * NOT A DEBOUNCE. §6.1's *"re-derive only when the bucket index changes, debounced ~250 ms"* is a
 * statement about camera events, and camera events are `viewport-controller.ts`'s business. What
 * lives here is the cache that makes a re-derivation free the second time; what lives there is the
 * timer that stops a pinch from asking eight times.
 */
export class ZoomBucketStore implements BucketInvalidator {
  #set: ExploredSet
  #byRes = new Map<number, ZoomBucket>()
  #onDerive: ((event: DeriveEvent) => void) | undefined
  #indexDerivations = 0
  #groupDerivations = 0

  constructor(set: ExploredSet, options: { onDerive?: (event: DeriveEvent) => void } = {}) {
    this.#set = set
    this.#onDerive = options.onDerive
  }

  /** Criterion 2's spy: how many bucket indexes have been built, ever. */
  get indexDerivations(): number {
    return this.#indexDerivations
  }

  /** How many group geometries have been built. The screen-area-bounded half of the cost. */
  get groupDerivations(): number {
    return this.#groupDerivations
  }

  get cachedResolutions(): number[] {
    return [...this.#byRes.keys()].sort((a, b) => a - b)
  }

  /** The bucket for this resolution, built if it is new. */
  bucketFor(res: number): ZoomBucket {
    const cached = this.#byRes.get(res)
    if (cached) return cached
    const bucket = new ZoomBucket(this.#set, res, (event) => this.#record(event))
    this.#byRes.set(res, bucket)
    return bucket
  }

  /** The bucket for this map zoom. `resForZoom` picks it; §6.1's table decides. */
  bucketForZoom(zoom: number): ZoomBucket {
    return this.bucketFor(resForZoom(zoom))
  }

  invalidateParents(parents: readonly H3Index[]): void {
    if (parents.length === 0) return
    for (const bucket of this.#byRes.values()) bucket.invalidate(parents)
  }

  #record(event: DeriveEvent): void {
    if (event.kind === "index") this.#indexDerivations++
    else this.#groupDerivations++
    this.#onDerive?.(event)
  }
}
