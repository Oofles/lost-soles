import { cellToParent, gridDisk, latLngToCell } from "h3-js"
import { describe, expect, it } from "vitest"

import {
  cellToBig,
  decodeDeltaBlob,
  encodeDeltaBlob,
  encodeExploredBlob,
} from "@/src/domain/explored-blob"
import { RES, RES_PARENT } from "@/src/domain/fog"

import { ExploredSet } from "./explored-set"
import { INSTANCE_FLOATS } from "./mask"
import {
  childrenPerGroup,
  groupResFor,
  resForZoom,
  ZoomBucketStore,
  ZOOM_TO_RES,
  type DeriveEvent,
} from "./zoom-buckets"

/**
 * Ticket `0058`, criteria 1, 2, 3, 9 and 10. `05-fog-of-war.md` §6.1, §6.2; D-237, D-238.
 *
 * SYNTHETIC GEOGRAPHY, POINT NEMO (`08` §7.2, D-199) — the same origin every other fog test uses, and
 * for the same reason: this repository is public and a real trace is a home address.
 */
const NEMO = { lat: -48.876, lng: -123.393 }
const origin = latLngToCell(NEMO.lat, NEMO.lng, RES)

const sortBig = (cells: readonly string[]): bigint[] =>
  cells.map(cellToBig).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))

/** A dense disc of `3k² + 3k + 1` cells — the worst case for every count in this file. */
function disc(k: number): ExploredSet {
  return ExploredSet.fromBlob(encodeExploredBlob(sortBig(gridDisk(origin, k)), 1))
}

describe("resForZoom — criterion 1", () => {
  it("implements D-238's table exactly", () => {
    const expected: Array<[number, number]> = [
      [0, 4],
      [5, 4],
      [5.01, 5],
      [6, 5],
      [6.5, 6],
      [8, 6],
      [8.1, 7],
      [9, 7],
      [10, 8],
      [11, 8],
      [12, 9],
      [13, 10],
      [13.5, 11],
      [14, 11],
      [17, 11],
      [22, 11],
    ]
    for (const [zoom, res] of expected) expect(resForZoom(zoom)).toBe(res)
  })

  it("never renders finer than the stored resolution, at any zoom", () => {
    for (let z = 0; z <= 24; z += 0.25) expect(resForZoom(z)).toBeLessThanOrEqual(RES)
    for (const band of ZOOM_TO_RES) expect(band.res).toBeLessThanOrEqual(RES)
    // Rendering finer than you store means inventing ground: a res-11 cell does not know which of
    // its seven children the runner crossed. `0194` option C, rejected there.
    expect(resForZoom(Infinity)).toBe(RES)
  })

  it("is monotonic, so a continuous pinch crosses each boundary exactly once", () => {
    let previous = resForZoom(0)
    for (let z = 0; z <= 22; z += 0.05) {
      const res = resForZoom(z)
      expect(res).toBeGreaterThanOrEqual(previous)
      previous = res
    }
  })

  /**
   * The rule the table is derived from, checked rather than asserted by the comment alone: at 30°N —
   * the operator's latitude — every band keeps a cell between 8 and 34 CSS px across.
   *
   * MAPLIBRE ZOOMS, SO THE WORLD IS 512 px AT z0. The familiar 256-px-tile figure is one level out,
   * and using it is how the first draft of the table put res 10 at z14.
   */
  it("keeps a cell in the 8–34 px band at every zoom where a finer bucket exists, at 30°N", () => {
    const circumference = 2 * Math.PI * 6_371_008.8 * Math.cos((30.1 * Math.PI) / 180)
    const diameter: Record<number, number> = {
      4: 52_144,
      5: 19_708,
      6: 7_449,
      7: 2_813,
      8: 1_063,
      9: 402,
      10: 152,
      11: 57,
    }
    for (let z = 5; z <= 17; z++) {
      const res = resForZoom(z)
      const px = diameter[res]! / (circumference / (512 * 2 ** z))
      expect(px, `res ${res} at z${z} is ${px.toFixed(0)} px`).toBeGreaterThan(8)
      /**
       * The upper bound applies only while there is something finer to switch to. Above z14 the
       * canonical resolution IS the floor — a res-11 cell is 55 px at z16 and 111 px at z17 and there
       * is nothing to be done about it, because rendering finer than you store means inventing ground.
       * That is a property of the grid, not a fault in the table.
       */
      if (res < RES) expect(px, `res ${res} at z${z} is ${px.toFixed(0)} px`).toBeLessThan(34)
    }
  })
})

describe("groupResFor", () => {
  /**
   * The arithmetic that made `RES_PARENT = 6` right — 7⁴ = 2,401 children — restored for res-11 cells.
   * `0198` is the ticket that moves the storage key to res 7 and makes the two coincide again; when it
   * lands this becomes `RES_PARENT` for every bucket and the second assertion is what will say so.
   */
  it("asks for 2,401 children at the canonical resolution", () => {
    expect(childrenPerGroup(RES, groupResFor(RES))).toBe(2401)
  })

  it("is never finer than RES_PARENT, because that is the key a delta invalidates by", () => {
    for (let res = 4; res <= RES; res++) expect(groupResFor(res)).toBeGreaterThanOrEqual(
      Math.min(res, RES_PARENT),
    )
  })

  it("is never finer than the bucket itself, so a bucket cell lies in exactly one group", () => {
    for (let res = 4; res <= RES; res++) expect(groupResFor(res)).toBeLessThanOrEqual(res)
  })
})

/**
 * THE ASSUMPTION THE WHOLE INDEX RESTS ON, and criterion 3's first half.
 *
 * `zoom-buckets.ts` finds group runs with a galloping binary search rather than an O(n) pass, which is
 * correct only if every child of an ancestor is contiguous in ascending id order. That is true because
 * a cell's ancestors are a prefix of its 64-bit id — but "true because of the bit layout" is exactly
 * the kind of claim that should be measured rather than reasoned about, since an h3 upgrade could in
 * principle change it and the failure would be a silently incomplete map.
 */
describe("ancestors are contiguous in id order", () => {
  it("holds at three grouping resolutions over a 43k-cell disc", () => {
    const cells = sortBig(gridDisk(origin, 120)).map((big) => big.toString(16))
    expect(cells.length).toBeGreaterThan(43_000)

    for (const groupRes of [6, 7, 8]) {
      const runs: string[] = []
      let previous: string | null = null
      for (const cell of cells) {
        const group = cellToParent(cell, groupRes)
        if (group !== previous) {
          runs.push(group)
          previous = group
        }
      }
      // One run per group. A group appearing twice would mean a run of children interrupted by a
      // cell belonging elsewhere, and the galloping search would stop at the interruption.
      expect(new Set(runs).size, `groupRes ${groupRes}`).toBe(runs.length)
      expect(runs.length).toBeGreaterThan(1)
    }
  })

  it("and the ids sort the same way as the bigints they came from", () => {
    // The group index binary-searches group ids as STRINGS. H3 ids are always 15 hex digits, so
    // lexicographic order is numeric order — and that is what makes the search correct.
    const cells = sortBig(gridDisk(origin, 20)).map((big) => big.toString(16))
    for (const cell of cells) expect(cell).toHaveLength(15)
    const ascending = [...cells].sort()
    expect(ascending).toEqual(cells)
  })
})

describe("the group index — criterion 3", () => {
  const set = disc(30)
  const store = new ZoomBucketStore(set)
  const bucket = store.bucketFor(RES)

  it("covers every cell exactly once, in contiguous slices", () => {
    expect(bucket.groupCount).toBeGreaterThan(1)

    // One group per distinct ancestor, no duplicates — a group appearing twice would mean the
    // galloping search stopped inside a run.
    const ids: string[] = []
    for (let g = 0; g < bucket.groupCount; g++) ids.push(bucket.groupId(g))
    expect(new Set(ids).size).toBe(ids.length)

    const expected = new Set<string>()
    for (let i = 0; i < set.cells.length; i++) {
      expected.add(cellToParent(set.cells[i]!.toString(16), bucket.groupRes))
    }
    expect(new Set(ids)).toEqual(expected)

    // Ascending, which is what makes the group lookup a binary search.
    expect([...ids].sort()).toEqual(ids)

    // And the slices partition the set: every cell is drawn once, by exactly one group.
    let cells = 0
    for (let g = 0; g < bucket.groupCount; g++) {
      bucket.discsFor(g)
      cells += bucket.groupStats(g).cells
    }
    expect(cells).toBe(set.size)
  })

  it("groups at the resolution groupResFor asks for", () => {
    expect(bucket.groupRes).toBe(groupResFor(RES))
    for (let g = 0; g < bucket.groupCount; g++) {
      expect(cellToParent(bucket.groupId(g), bucket.groupRes)).toBe(bucket.groupId(g))
    }
  })

  /**
   * The margin claim in `#writeBounds`, checked against the geometry rather than trusted: H3's
   * hierarchy does not nest exactly, so a group's drawn boundary does not contain its children's
   * discs — and a bbox that clipped one would drop fog at a group seam under the cull.
   */
  it("bounds every disc the group will draw, before the group is materialised", () => {
    // THE ESTIMATE IS WHAT MATTERS, so it is read before `discsFor` replaces it with the exact bbox.
    // A group whose estimated bounds clip one of its own discs is a group the cull can reject while it
    // still has fog to contribute — a hole in the map that appears and disappears as you pan.
    const fresh = new ZoomBucketStore(set).bucketFor(RES)
    const estimates = Float64Array.from(fresh.groupBounds)

    for (let g = 0; g < fresh.groupCount; g++) {
      const discs = fresh.discsFor(g)
      const at = g * 4
      for (let i = 0; i < discs.length; i += INSTANCE_FLOATS) {
        const x = discs[i]!
        const y = discs[i + 1]!
        const r = discs[i + 2]!
        expect(x - r).toBeGreaterThanOrEqual(estimates[at]!)
        expect(y - r).toBeGreaterThanOrEqual(estimates[at + 1]!)
        expect(x + r).toBeLessThanOrEqual(estimates[at + 2]!)
        expect(y + r).toBeLessThanOrEqual(estimates[at + 3]!)
      }
    }
  })

  it("replaces the estimate with the exact bbox once the group is materialised", () => {
    const fresh = new ZoomBucketStore(set).bucketFor(RES)
    const before = Float64Array.from(fresh.groupBounds)
    fresh.discsFor(0)
    const after = fresh.groupBounds
    // Tighter on every side, which is what makes later culls cheap rather than merely correct.
    expect(after[0]!).toBeGreaterThan(before[0]!)
    expect(after[1]!).toBeGreaterThan(before[1]!)
    expect(after[2]!).toBeLessThan(before[2]!)
    expect(after[3]!).toBeLessThan(before[3]!)
  })
})

describe("laziness — criterion 2", () => {
  it("builds the index on construction and no geometry at all", () => {
    const events: DeriveEvent[] = []
    const store = new ZoomBucketStore(disc(30), { onDerive: (event) => events.push(event) })
    const bucket = store.bucketFor(RES)

    expect(events.map((event) => event.kind)).toEqual(["index"])
    expect(bucket.materialisedGroups).toBe(0)
    expect(store.groupDerivations).toBe(0)
    expect(bucket.groupCount).toBeGreaterThan(1)
  })

  it("materialises one group per first sight, and never twice", () => {
    const store = new ZoomBucketStore(disc(30))
    const bucket = store.bucketFor(RES)

    const first = bucket.discsFor(0)
    expect(store.groupDerivations).toBe(1)
    expect(bucket.materialisedGroups).toBe(1)
    // The same array back, not an equal one: a second derivation would be the cache not working.
    expect(bucket.discsFor(0)).toBe(first)
    expect(store.groupDerivations).toBe(1)

    bucket.discsFor(1)
    expect(store.groupDerivations).toBe(2)
    expect(bucket.materialisedGroups).toBe(2)
  })

  it("caches buckets per resolution and derives each index once", () => {
    const store = new ZoomBucketStore(disc(20))
    const a = store.bucketForZoom(16)
    const b = store.bucketForZoom(15)
    expect(b).toBe(a)
    expect(store.indexDerivations).toBe(1)

    store.bucketForZoom(9)
    expect(store.indexDerivations).toBe(2)
    expect(store.cachedResolutions).toEqual([7, RES])
  })

  /**
   * §6.1 prices a bucket derivation at 30–80 ms, and that figure was for a `cellToParent` pass plus a
   * dedupe over every cell. The index does neither: it is O(G log(N/G)) probes, so it must be
   * *dramatically* cheaper than the pass it replaces — and the number is printed because a ceiling on
   * this machine says nothing about D-124's phone.
   */
  it("builds a 150k-cell index in well under the budget for a full pass", () => {
    const set = disc(224)
    expect(set.size).toBeGreaterThan(150_000)

    const started = performance.now()
    const store = new ZoomBucketStore(set)
    const bucket = store.bucketFor(RES)
    const ms = performance.now() - started

    console.log(
      `0058 criterion 2 — index over ${set.size.toLocaleString()} cells: ` +
        `${bucket.groupCount} groups in ${ms.toFixed(1)} ms ` +
        `(this machine — NOT the target phone)`,
    )
    expect(bucket.groupCount).toBeGreaterThan(10)
    expect(ms).toBeLessThan(200)
  })
})

describe("coarse buckets carry a fraction — criterion 10", () => {
  /**
   * §6.1: *"a parent cell you've run 20% of is a dim glow, not a solid block. Without this, zooming
   * out turns a sparse city into a solid slab."*
   *
   * DERIVED IN THE BROWSER, NOT FETCHED (D-238). `src/domain/explored-agg.ts` writes exactly this
   * number to S3 per generation and `0058` was specified to read it from there — but nothing in the
   * browser can: there is no route, no transport method and no cache path for that object, and it
   * covers res 6/7/8 while this table needs 4 through 10. The client already holds every cell and the
   * count falls out of a pass it is running anyway, so the fraction is derived from the same bytes the
   * fog is drawn from and cannot disagree with them.
   */
  it("is the explored child count over 7^(RES - res), the same arithmetic as the server's", () => {
    const set = disc(12)
    const store = new ZoomBucketStore(set)
    const bucket = store.bucketFor(9)
    expect(bucket.res).toBe(9)

    const expected = new Map<string, number>()
    for (let i = 0; i < set.cells.length; i++) {
      const parent = cellToParent(set.cells[i]!.toString(16), 9)
      expected.set(parent, (expected.get(parent) ?? 0) + 1)
    }
    const total = childrenPerGroup(RES, 9)
    expect(total).toBe(49)

    let checked = 0
    for (let g = 0; g < bucket.groupCount; g++) {
      const discs = bucket.discsFor(g)
      const { cells } = bucket.groupStats(g)
      for (let c = 0; c < cells; c++) {
        const fraction = discs[c * INSTANCE_FLOATS + 3]!
        // Every fraction is a real count over 49, and at least one is a partial one — a disc that
        // covers the whole parent and a disc that covers a sliver of it must not look the same.
        expect(fraction).toBeGreaterThan(0)
        expect(fraction).toBeLessThanOrEqual(1)
        checked++
      }
    }
    expect(checked).toBe(expected.size)
    expect([...expected.values()].some((n) => n < total)).toBe(true)
  })

  it("gives every cell at the canonical resolution a fraction of exactly 1", () => {
    const store = new ZoomBucketStore(disc(6))
    const bucket = store.bucketFor(RES)
    for (let g = 0; g < bucket.groupCount; g++) {
      const discs = bucket.discsFor(g)
      for (let i = 0; i < discs.length; i += INSTANCE_FLOATS) expect(discs[i + 3]).toBe(1)
    }
  })
})

/**
 * A GROUP BOUNDARY MUST NOT BE VISIBLE. D-232's bridges fill the waist between adjacent discs, and the
 * cull packs one group at a time — so without cross-group membership the last cell before every
 * boundary would find no neighbour on the far side, and the string of pearls would come back on a grid
 * of the renderer's own making.
 */
describe("cross-group bridges", () => {
  it("bridges a pair that straddles a group boundary", () => {
    const set = disc(30)
    const store = new ZoomBucketStore(set)
    const bucket = store.bucketFor(RES)
    expect(bucket.groupCount).toBeGreaterThan(1)

    let bridges = 0
    let cells = 0
    for (let g = 0; g < bucket.groupCount; g++) {
      bucket.discsFor(g)
      const stats = bucket.groupStats(g)
      bridges += stats.bridges
      cells += stats.cells
    }
    expect(cells).toBe(set.size)

    /**
     * The count is the proof. Every adjacent revealed pair not interior-to-interior is bridged
     * exactly once, whichever groups the two cells are in — so the total must match a bridge count
     * computed over the whole set with no groups at all. A missing cross-group bridge shows up here
     * as a shortfall of a few hundred.
     */
    const ids = new Set<string>()
    for (let i = 0; i < set.cells.length; i++) ids.add(set.cells[i]!.toString(16))
    const degree = new Map<string, number>()
    for (const id of ids) {
      let n = 0
      for (const near of gridDisk(id, 1)) if (near !== id && ids.has(near)) n++
      degree.set(id, n)
    }
    let expected = 0
    for (const id of ids) {
      for (const near of gridDisk(id, 1)) {
        if (near <= id || !ids.has(near)) continue
        if (degree.get(id) === 6 && degree.get(near) === 6) continue
        expected++
      }
    }
    expect(bridges).toBe(expected)
  })
})

/**
 * CRITERION 9. `05` §7.4: *"invalidate only what changed. This is why cells are grouped by res-6
 * parent."* One run touches one or two parents, so a mid-session update must be a handful of groups
 * of work — not a bucket, and certainly not every bucket.
 */
describe("delta invalidation — criterion 9", () => {
  it("drops only the touched parents' groups, and keeps the rest", () => {
    // A wide disc, so there are groups under res-6 parents far from where the delta lands. The
    // invalidation key is at `RES_PARENT` (6) and the groups are at res 7, so one key covers up to
    // seven groups plus their neighbours — a small disc is entirely inside one key and nothing
    // survives, which would make this test pass for the wrong reason.
    const set = disc(120)
    const store = new ZoomBucketStore(set)
    const bucket = store.bucketFor(RES)
    for (let g = 0; g < bucket.groupCount; g++) bucket.discsFor(g)
    const before = bucket.materialisedGroups
    expect(before).toBe(bucket.groupCount)
    expect(before).toBeGreaterThan(3)

    const unsubscribe = set.addInvalidator(store)
    // One new cell, just outside the disc — which is one res-6 parent, whichever one it lands in.
    const added = gridDisk(origin, 121).find((cell) => !set.has(cell))
    expect(added).toBeDefined()
    const applied = set.applyDelta(decodeDeltaBlob(encodeDeltaBlob([cellToBig(added!)], 1, 2)))
    expect(applied.parents).toHaveLength(1)
    unsubscribe()

    const after = store.bucketFor(RES)
    expect(after.materialisedGroups).toBeGreaterThan(0)
    expect(after.materialisedGroups).toBeLessThan(before)
    // And the new cell is actually drawn — an invalidation that dropped nothing would be worse than
    // one that dropped everything.
    let cells = 0
    for (let g = 0; g < after.groupCount; g++) {
      after.discsFor(g)
      cells += after.groupStats(g).cells
    }
    expect(cells).toBe(set.size)
  })

  it("does nothing for an empty delta, which is a real and common answer", () => {
    const set = disc(10)
    const store = new ZoomBucketStore(set)
    const bucket = store.bucketFor(RES)
    for (let g = 0; g < bucket.groupCount; g++) bucket.discsFor(g)
    const before = bucket.materialisedGroups

    set.addInvalidator(store)
    set.applyDelta(decodeDeltaBlob(encodeDeltaBlob([], 1, 2)))
    expect(store.bucketFor(RES).materialisedGroups).toBe(before)
    expect(store.indexDerivations).toBe(1)
  })
})
